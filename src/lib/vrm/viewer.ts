/**
 * Three.js VRM Viewer — manages scene, camera, renderer, HDRI backgrounds
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMModel } from './model';
import type { VrmSettings } from '@/lib/db/schema';

/* ───── HDRI Background Config ───── */

export interface HdriBgConfig {
  url: string;
  label: string;
  offsetX: number;   // horizontal rotation offset in radians
  offsetY: number;   // vertical shift via UV offset
  intensity: number; // brightness multiplier (0..3, default 1)
  scale: number;     // sphere scale multiplier (0.1..5, default 1) — smaller = closer
}

export class VRMViewer {
  public isReady = false;
  public model: VRMModel | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private clock: THREE.Clock;
  private animationId: number | null = null;

  /* ── HDRI Background ── */
  private hdriBgMesh: THREE.Mesh | null = null;
  private hdriTexture: THREE.Texture | null = null;
  private currentHdriConfig: HdriBgConfig | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    this.clock.start();

    // Lighting — slightly warmer for character rendering
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1.2, 1.8, 1.5).normalize();
    this.scene.add(dirLight);

    // Soft fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0xc0d0ff, 0.3);
    fillLight.position.set(-1, 0.8, -0.5).normalize();
    this.scene.add(fillLight);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambLight);
  }

  setup(canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || canvas.width;
    const h = parent?.clientHeight || canvas.height;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(20, w / h, 0.1, 200);
    this.camera.position.set(0, 1.3, 1.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.3, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.update();

    window.addEventListener('resize', this.resize);
    this.isReady = true;
    this.animate();
  }

  async loadVRM(url: string, vrmSettings?: VrmSettings) {
    this.unloadVRM();

    const model = new VRMModel();
    const vrm = await model.loadVRM(url, vrmSettings);

    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    this.scene.add(vrm.scene);
    this.model = model;

    // Adjust camera to head
    requestAnimationFrame(() => this.resetCamera());
  }

  unloadVRM() {
    if (this.model?.vrm) {
      this.scene.remove(this.model.vrm.scene);
      this.model.dispose();
      this.model = null;
    }
  }

  resetCamera() {
    const head = this.model?.vrm?.humanoid?.getNormalizedBoneNode('head');
    if (head && this.camera && this.controls) {
      const pos = head.getWorldPosition(new THREE.Vector3());
      this.camera.position.set(0, pos.y, 1.5);
      this.controls.target.set(0, pos.y, 0);
      this.controls.update();
    }
  }

  resize = () => {
    if (!this.renderer) return;
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;

    this.renderer.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  };

  /** Capture current frame as data URL */
  captureFrame(): string | null {
    if (!this.renderer) return null;
    this.renderer.render(this.scene, this.camera!);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /* ═══════════════ HDRI Background ═══════════════ */

  getHdriConfig(): HdriBgConfig | null {
    return this.currentHdriConfig;
  }

  /** Remove current HDRI background */
  clearBackground() {
    if (this.hdriBgMesh) {
      this.scene.remove(this.hdriBgMesh);
      this.hdriBgMesh.geometry?.dispose();
      if (this.hdriBgMesh.material instanceof THREE.Material) this.hdriBgMesh.material.dispose();
      this.hdriBgMesh = null;
    }
    if (this.hdriTexture) {
      this.hdriTexture.dispose();
      this.hdriTexture = null;
    }
    this.currentHdriConfig = null;

    // Restore transparent background
    if (this.renderer) {
      this.renderer.setClearColor(0x000000, 0);
    }
  }

  /** Set HDRI (equirectangular) image as a sky-sphere background.
   *  Uses MeshStandardMaterial with emissiveMap so texture scaling works
   *  via UV repeat/offset instead of sphere geometry scaling. */
  async setHdriBackground(config: HdriBgConfig): Promise<void> {
    this.clearBackground();
    this.currentHdriConfig = { ...config };

    const texture = await new THREE.TextureLoader().loadAsync(config.url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.hdriTexture = texture;

    // Create a large fixed-size sphere rendered from the inside (BackSide)
    const geo = new THREE.SphereGeometry(80, 64, 32);

    const intensity = config.intensity ?? 1;
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: intensity,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });

    this.hdriBgMesh = new THREE.Mesh(geo, mat);
    this.hdriBgMesh.renderOrder = -1;
    this.hdriBgMesh.rotation.y = config.offsetX;

    // Apply scale (texture zoom) and Y offset via UV
    this.applyHdriTextureTransform(config.scale ?? 1, config.offsetY ?? 0);

    this.scene.add(this.hdriBgMesh);
  }

  /** Apply texture zoom (scale) and vertical offset via UV repeat/offset */
  private applyHdriTextureTransform(scale: number, offsetY: number) {
    if (!this.hdriTexture) return;
    // scale > 1 = zoom in (closer), < 1 = zoom out
    const zoom = 1 / Math.max(0.1, scale);
    this.hdriTexture.repeat.set(zoom, zoom);
    // Center the zoom + apply Y offset
    this.hdriTexture.offset.set(
      (1 - zoom) / 2,
      (1 - zoom) / 2 + offsetY,
    );
  }

  /** Update HDRI rotation offsets, intensity and scale */
  updateHdriBackground(patch: Partial<Pick<HdriBgConfig, 'offsetX' | 'offsetY' | 'intensity' | 'scale'>>) {
    if (!this.currentHdriConfig || !this.hdriBgMesh) return;
    if (patch.offsetX !== undefined) this.currentHdriConfig.offsetX = patch.offsetX;
    if (patch.offsetY !== undefined) this.currentHdriConfig.offsetY = patch.offsetY;
    if (patch.intensity !== undefined) this.currentHdriConfig.intensity = patch.intensity;
    if (patch.scale !== undefined) this.currentHdriConfig.scale = patch.scale;

    // Horizontal rotation via mesh rotation
    this.hdriBgMesh.rotation.y = this.currentHdriConfig.offsetX;

    // Scale (texture zoom) and Y offset via UV repeat/offset
    this.applyHdriTextureTransform(
      this.currentHdriConfig.scale,
      this.currentHdriConfig.offsetY,
    );

    // Update brightness via emissive intensity
    const mat = this.hdriBgMesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = this.currentHdriConfig.intensity;
  }

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();

    this.model?.update(delta);
    this.controls?.update();

    if (this.renderer && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.resize);
    this.unloadVRM();
    this.renderer?.dispose();
    this.controls?.dispose();
  }
}
