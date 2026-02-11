/**
 * VRM Interaction System
 *
 * 1. Head/Eye Mouse Tracking — eyes + head follow cursor (angle-constrained)
 * 2. Jelly Click Effect — spring-physics scale bounce on click
 * 3. Bone Drag — drag any body part, camera-aware direction
 *
 * All interactions work on any VRM humanoid model.
 *
 * IMPORTANT: interactions.update(delta) MUST be called AFTER model.update(delta)
 * so that our bone modifications happen after the animation mixer + VRM update.
 * We apply visual effects to RAW bones (the actual rendered skeleton) so they
 * aren't overwritten by VRM's normalized→raw pipeline.
 */
import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/* ═══════════════════════════════════════════════════════
   1. HEAD / EYE MOUSE TRACKING
   ═══════════════════════════════════════════════════════ */

export class HeadTracker {
  private vrm: VRM | null = null;

  // Raw bone references (rendered bones, not normalized)
  private headRaw: THREE.Object3D | null = null;
  private neckRaw: THREE.Object3D | null = null;
  private leftEyeRaw: THREE.Object3D | null = null;
  private rightEyeRaw: THREE.Object3D | null = null;

  // Smoothed current rotation offset (yaw, pitch in radians)
  private currentYaw = 0;
  private currentPitch = 0;

  // Tracking parameters
  private readonly headLimitYaw = THREE.MathUtils.degToRad(20);    // head max ±20°
  private readonly headLimitPitch = THREE.MathUtils.degToRad(15);  // head max ±15°
  private readonly eyeLimitYaw = THREE.MathUtils.degToRad(25);     // eyes max ±25°
  private readonly eyeLimitPitch = THREE.MathUtils.degToRad(20);   // eyes max ±20°
  private readonly smoothSpeed = 2.5; // exponential smoothing factor
  private enabled = true;

  // Mouse position in NDC (-1 to 1)
  private mouseNDC = new THREE.Vector2(0, 0);
  private isMouseOver = false;

  bind(vrm: VRM) {
    this.vrm = vrm;
    const hum = vrm.humanoid;
    if (!hum) return;

    // Use RAW bones — these are the actual rendered bones
    this.headRaw = hum.getRawBoneNode('head');
    this.neckRaw = hum.getRawBoneNode('neck');
    this.leftEyeRaw = hum.getRawBoneNode('leftEye');
    this.rightEyeRaw = hum.getRawBoneNode('rightEye');

    // Disable VRM's built-in lookAt so we handle it manually
    if (vrm.lookAt) {
      vrm.lookAt.target = undefined;
    }
  }

  setMousePosition(ndcX: number, ndcY: number) {
    this.mouseNDC.set(ndcX, ndcY);
    this.isMouseOver = true;
  }

  setMouseLeave() {
    this.isMouseOver = false;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  update(delta: number) {
    if (!this.enabled) return;

    // Compute target yaw/pitch from mouse position
    let targetYaw = 0;
    let targetPitch = 0;

    if (this.isMouseOver) {
      // VRM faces camera (Z+). Mouse right → character looks to its LEFT from
      // our perspective, but looks toward the mouse, which means:
      //   mouseNDC.x > 0 (right) → positive Y-axis rotation → head turns right
      targetYaw = this.mouseNDC.x * this.headLimitYaw;
      targetPitch = this.mouseNDC.y * this.headLimitPitch;
    }

    // Smooth interpolation
    const t = 1 - Math.exp(-this.smoothSpeed * delta);
    this.currentYaw += (targetYaw - this.currentYaw) * t;
    this.currentPitch += (targetPitch - this.currentPitch) * t;

    // ── Apply to neck (40% of head rotation) ──
    if (this.neckRaw) {
      const neckYaw = this.currentYaw * 0.4;
      const neckPitch = this.currentPitch * 0.4;
      const qY = _qTemp1.setFromAxisAngle(_yAxis, neckYaw);
      const qP = _qTemp2.setFromAxisAngle(_xAxis, neckPitch);
      // Post-multiply: animation pose × our tracking rotation
      this.neckRaw.quaternion.multiply(qY).multiply(qP);
    }

    // ── Apply to head (60% of head rotation) ──
    if (this.headRaw) {
      const headYaw = this.currentYaw * 0.6;
      const headPitch = this.currentPitch * 0.6;
      const qY = _qTemp1.setFromAxisAngle(_yAxis, headYaw);
      const qP = _qTemp2.setFromAxisAngle(_xAxis, headPitch);
      this.headRaw.quaternion.multiply(qY).multiply(qP);
    }

    // ── Eyes: follow mouse with wider range, more directly ──
    const eyeTargetYaw = this.isMouseOver
      ? THREE.MathUtils.clamp(this.mouseNDC.x * this.eyeLimitYaw, -this.eyeLimitYaw, this.eyeLimitYaw)
      : 0;
    const eyeTargetPitch = this.isMouseOver
      ? THREE.MathUtils.clamp(this.mouseNDC.y * this.eyeLimitPitch, -this.eyeLimitPitch, this.eyeLimitPitch)
      : 0;

    if (this.leftEyeRaw) {
      const qY = _qTemp1.setFromAxisAngle(_yAxis, eyeTargetYaw);
      const qP = _qTemp2.setFromAxisAngle(_xAxis, eyeTargetPitch);
      this.leftEyeRaw.quaternion.multiply(qY).multiply(qP);
    }
    if (this.rightEyeRaw) {
      const qY = _qTemp1.setFromAxisAngle(_yAxis, eyeTargetYaw);
      const qP = _qTemp2.setFromAxisAngle(_xAxis, eyeTargetPitch);
      this.rightEyeRaw.quaternion.multiply(qY).multiply(qP);
    }
  }

  dispose() {
    this.vrm = null;
    this.headRaw = null;
    this.neckRaw = null;
    this.leftEyeRaw = null;
    this.rightEyeRaw = null;
    this.currentYaw = 0;
    this.currentPitch = 0;
  }
}

// Shared temp quaternions to avoid per-frame allocations
const _qTemp1 = new THREE.Quaternion();
const _qTemp2 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);

/* ═══════════════════════════════════════════════════════
   2. JELLY CLICK EFFECT (Spring Physics on Bone Scale)
   ═══════════════════════════════════════════════════════ */

interface SpringState {
  boneName: string;
  /** scale offset from (1,1,1) — the spring displacement */
  offset: THREE.Vector3;
  velocity: THREE.Vector3;
  /** propagation delay (seconds) */
  delay: number;
  /** remaining delay */
  delayLeft: number;
  /** Whether this spring has been activated */
  activated: boolean;
}

export class JellyEffect {
  private vrm: VRM | null = null;
  private springs: Map<string, SpringState> = new Map();

  // Tuning — stiffer spring, moderate damping for juicy bounce
  private readonly tension = 300;
  private readonly damping = 8;
  private readonly maxDisplacement = 0.35;
  private active = false;

  /** Bones that support jelly (VRM humanoid names) */
  private static readonly JELLY_BONES: VRMHumanBoneName[] = [
    'hips', 'spine', 'chest', 'upperChest',
    'head', 'neck',
    'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  ];

  /** Parent→children for wave propagation */
  private static readonly BONE_CHAIN: Record<string, string[]> = {
    hips: ['spine'],
    spine: ['chest', 'leftUpperLeg', 'rightUpperLeg'],
    chest: ['upperChest'],
    upperChest: ['neck', 'leftUpperArm', 'rightUpperArm'],
    neck: ['head'],
    leftUpperArm: ['leftLowerArm'],
    leftLowerArm: ['leftHand'],
    rightUpperArm: ['rightLowerArm'],
    rightLowerArm: ['rightHand'],
    leftUpperLeg: ['leftLowerLeg'],
    leftLowerLeg: ['leftFoot'],
    rightUpperLeg: ['rightLowerLeg'],
    rightLowerLeg: ['rightFoot'],
  };

  bind(vrm: VRM) {
    this.vrm = vrm;
    this.springs.clear();

    for (const boneName of JellyEffect.JELLY_BONES) {
      const raw = vrm.humanoid?.getRawBoneNode(boneName);
      if (raw) {
        this.springs.set(boneName, {
          boneName,
          offset: new THREE.Vector3(0, 0, 0),
          velocity: new THREE.Vector3(0, 0, 0),
          delay: 0,
          delayLeft: 0,
          activated: false,
        });
      }
    }
  }

  /**
   * Trigger a jelly impulse on a bone, with wave propagation to children.
   */
  triggerImpulse(boneName: string, intensity = 3) {
    this.active = true;
    if (boneName === 'all') {
      this.triggerWithWave('hips', intensity, 0);
    } else {
      this.triggerWithWave(boneName, intensity, 0);
    }
  }

  private triggerWithWave(boneName: string, intensity: number, delay: number) {
    const spring = this.springs.get(boneName);
    if (!spring) return;

    // Initial impulse: squish in X/Z, stretch in Y (or vice versa) for a bounce effect
    spring.velocity.set(
      -intensity * (0.6 + Math.random() * 0.8),
       intensity * (0.6 + Math.random() * 0.8),
      -intensity * (0.6 + Math.random() * 0.8),
    );
    spring.delay = delay;
    spring.delayLeft = delay;
    spring.activated = true;

    // Propagate to children with delay and reduced intensity
    const children = JellyEffect.BONE_CHAIN[boneName];
    if (children) {
      for (const child of children) {
        this.triggerWithWave(child, intensity * 0.6, delay + 0.06);
      }
    }
  }

  update(delta: number) {
    if (!this.active || !this.vrm) return;

    const hum = this.vrm.humanoid;
    if (!hum) return;

    let anyActive = false;
    const dt = Math.min(delta, 0.05); // cap timestep for stability

    for (const [boneName, state] of this.springs) {
      if (!state.activated) continue;

      // Wait for wave propagation delay
      if (state.delayLeft > 0) {
        state.delayLeft -= dt;
        anyActive = true;
        continue;
      }

      // Spring physics: F = -k * offset - d * velocity (Hooke + damping)
      const springF = state.offset.clone().multiplyScalar(-this.tension);
      const dampF = state.velocity.clone().multiplyScalar(-this.damping);
      const accel = springF.add(dampF);

      state.velocity.add(accel.clone().multiplyScalar(dt));
      state.offset.add(state.velocity.clone().multiplyScalar(dt));

      // Clamp to avoid extreme distortion
      state.offset.clampScalar(-this.maxDisplacement, this.maxDisplacement);

      // Apply scale offset to the RAW bone (not normalized — won't be overwritten)
      const rawBone = hum.getRawBoneNode(boneName as VRMHumanBoneName);
      if (rawBone) {
        rawBone.scale.set(
          1 + state.offset.x,
          1 + state.offset.y,
          1 + state.offset.z,
        );
      }

      // Check if settled
      const vel = state.velocity.length();
      const disp = state.offset.length();
      if (vel > 0.005 || disp > 0.005) {
        anyActive = true;
      } else {
        state.offset.set(0, 0, 0);
        state.velocity.set(0, 0, 0);
        state.activated = false;
        if (rawBone) rawBone.scale.set(1, 1, 1);
      }
    }

    if (!anyActive) {
      this.active = false;
    }
  }

  dispose() {
    // Reset all bone scales to 1
    if (this.vrm) {
      const hum = this.vrm.humanoid;
      for (const [boneName] of this.springs) {
        const raw = hum?.getRawBoneNode(boneName as VRMHumanBoneName);
        if (raw) raw.scale.set(1, 1, 1);
      }
    }
    this.springs.clear();
    this.active = false;
    this.vrm = null;
  }
}

/* ═══════════════════════════════════════════════════════
   3. BONE DRAG — drag any body part (camera-aware)
   ═══════════════════════════════════════════════════════ */

interface DragState {
  boneName: string;
  rawBone: THREE.Object3D;
  /** The bone's world position when drag started */
  startBoneWorldPos: THREE.Vector3;
  /** Current smoothed offset in world space */
  currentOffset: THREE.Vector3;
}

export class BoneDragger {
  private vrm: VRM | null = null;
  private camera: THREE.Camera | null = null;

  private dragState: DragState | null = null;
  private isDragging = false;

  // Drag target (mouse world pos projected onto bone-depth plane)
  private dragTargetWorld = new THREE.Vector3();

  // Blend back after release
  private blendingBack = false;
  private blendBackAlpha = 0;
  private readonly blendBackSpeed = 3.0;

  // Affection for accept/reject (hand grabs)
  private affection = 50;

  // Limits
  private readonly maxDragAngle = THREE.MathUtils.degToRad(60);
  private readonly dragSmooth = 8;

  bind(vrm: VRM) {
    this.vrm = vrm;
  }

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  setAffection(value: number) {
    this.affection = value;
  }

  /**
   * Start drag on any bone.
   * @returns 'accept' or 'reject'
   */
  startDrag(boneName: string, worldHitPos: THREE.Vector3): 'accept' | 'reject' {
    if (!this.vrm) return 'reject';

    // Reject hand grabs if affection is too low
    if ((boneName === 'leftHand' || boneName === 'rightHand') && this.affection < 25) {
      return 'reject';
    }

    const hum = this.vrm.humanoid;
    if (!hum) return 'reject';

    const rawBone = hum.getRawBoneNode(boneName as VRMHumanBoneName);
    if (!rawBone) return 'reject';

    const boneWorldPos = new THREE.Vector3();
    rawBone.getWorldPosition(boneWorldPos);

    this.dragState = {
      boneName,
      rawBone,
      startBoneWorldPos: boneWorldPos.clone(),
      currentOffset: new THREE.Vector3(0, 0, 0),
    };
    this.isDragging = true;
    this.blendingBack = false;
    this.dragTargetWorld.copy(worldHitPos);

    return 'accept';
  }

  updateDragTarget(worldPos: THREE.Vector3) {
    if (!this.isDragging) return;
    this.dragTargetWorld.copy(worldPos);
  }

  endDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.blendingBack = true;
    this.blendBackAlpha = 0;
  }

  getIsDragging(): boolean {
    return this.isDragging;
  }

  update(delta: number) {
    if (!this.dragState) return;

    const { rawBone } = this.dragState;

    if (this.isDragging) {
      // Compute desired offset from bone start to mouse world position
      const desiredOffset = this.dragTargetWorld.clone().sub(this.dragState.startBoneWorldPos);

      // Smooth interpolation
      const t = 1 - Math.exp(-this.dragSmooth * delta);
      this.dragState.currentOffset.lerp(desiredOffset, t);

      const offsetLen = this.dragState.currentOffset.length();
      if (offsetLen < 0.001) return;

      // Get the parent's world quaternion to convert world offset → local rotation
      const parentWorldQuat = new THREE.Quaternion();
      if (rawBone.parent) {
        rawBone.parent.getWorldQuaternion(parentWorldQuat);
      }

      // The bone naturally points along local Y in VRM rest pose
      // Get the bone's current up direction in world space
      const boneUp = new THREE.Vector3(0, 1, 0).applyQuaternion(parentWorldQuat).normalize();

      // Target direction: where the bone should point after being dragged
      const targetDir = boneUp.clone().add(
        this.dragState.currentOffset.clone().multiplyScalar(3),
      ).normalize();

      // Quaternion from current direction to target direction (world space)
      const worldRot = new THREE.Quaternion().setFromUnitVectors(boneUp, targetDir);

      // Clamp rotation angle to maxDragAngle
      const angle = 2 * Math.acos(Math.min(1, Math.abs(worldRot.w)));
      if (angle > this.maxDragAngle) {
        const clampRatio = this.maxDragAngle / angle;
        worldRot.slerp(_identityQuat, 1 - clampRatio);
      }

      // Convert world-space rotation to local-space:
      // localRot = parentInv * worldRot * parent
      const parentInv = parentWorldQuat.clone().invert();
      const localRot = parentInv.clone().multiply(worldRot).multiply(parentWorldQuat);

      // Post-multiply onto the bone's current animation quaternion
      rawBone.quaternion.multiply(localRot);
    }

    // Blend back after release — animation naturally takes over
    if (this.blendingBack) {
      this.blendBackAlpha += delta * this.blendBackSpeed;
      if (this.blendBackAlpha >= 1) {
        this.blendingBack = false;
        this.dragState = null;
      }
    }
  }

  dispose() {
    this.vrm = null;
    this.dragState = null;
    this.isDragging = false;
    this.blendingBack = false;
    this.camera = null;
  }
}

const _identityQuat = new THREE.Quaternion();

/* ═══════════════════════════════════════════════════════
   4. RAYCASTING HELPER — detects which bone was clicked
   ═══════════════════════════════════════════════════════ */

export class VRMRaycaster {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  /**
   * Cast a ray from mouse position and find the closest VRM bone.
   */
  cast(
    event: MouseEvent | PointerEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    vrm: VRM,
  ): { boneName: string; worldPos: THREE.Vector3 } | null {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);

    // Collect all meshes
    const meshes: THREE.Mesh[] = [];
    vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        meshes.push(obj as THREE.Mesh);
      }
    });

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    const hitPoint = hits[0].point;

    // Find closest bone to hit point
    const humanoid = vrm.humanoid;
    if (!humanoid) return null;

    const boneNames: VRMHumanBoneName[] = [
      'head', 'neck', 'chest', 'upperChest', 'spine', 'hips',
      'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
    ];

    let closestBone = '';
    let closestDist = Infinity;
    const boneWorldPos = new THREE.Vector3();

    for (const name of boneNames) {
      const bone = humanoid.getRawBoneNode(name);
      if (!bone) continue;
      bone.getWorldPosition(boneWorldPos);
      const dist = boneWorldPos.distanceTo(hitPoint);
      if (dist < closestDist) {
        closestDist = dist;
        closestBone = name;
      }
    }

    return closestBone ? { boneName: closestBone, worldPos: hitPoint } : null;
  }

  /**
   * Project screen coordinates onto a plane perpendicular to camera,
   * passing through a given world point (at the bone's depth).
   * This ensures dragging is camera-rotation-aware.
   */
  screenToWorldOnPlane(
    event: MouseEvent | PointerEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    planePoint: THREE.Vector3,
  ): THREE.Vector3 {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Unproject a point at NDC z=0 (near plane)
    const near = new THREE.Vector3(ndcX, ndcY, 0);
    near.unproject(camera);

    // Ray from camera through unprojected point
    const rayDir = near.sub(camera.position).normalize();

    // Build plane: perpendicular to camera forward, passing through planePoint
    const cameraFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const planeN = cameraFwd.clone().normalize();
    const planeDot = planeN.dot(planePoint);

    // Ray-plane intersection: t = (planeDot - planeN · rayOrigin) / (planeN · rayDir)
    const denom = planeN.dot(rayDir);
    if (Math.abs(denom) < 1e-6) return planePoint.clone();

    const t = (planeDot - planeN.dot(camera.position)) / denom;
    return camera.position.clone().add(rayDir.multiplyScalar(t));
  }
}

/* ═══════════════════════════════════════════════════════
   5. INTERACTION MANAGER — orchestrates all systems
   ═══════════════════════════════════════════════════════ */

export class InteractionManager {
  public headTracker = new HeadTracker();
  public jellyEffect = new JellyEffect();
  public boneDragger = new BoneDragger();
  public raycaster = new VRMRaycaster();

  private vrm: VRM | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private camera: THREE.Camera | null = null;

  // Callbacks for UI
  public onAffectionChange?: (delta: number, reason: string) => void;
  public onReject?: () => void;

  // For depth-plane projection during drag
  private dragBoneWorldPos = new THREE.Vector3();

  bind(vrm: VRM, canvas: HTMLCanvasElement, camera: THREE.Camera) {
    this.vrm = vrm;
    this.canvas = canvas;
    this.camera = camera;

    this.headTracker.bind(vrm);
    this.jellyEffect.bind(vrm);
    this.boneDragger.bind(vrm);
    this.boneDragger.setCamera(camera);

    this.setupEventListeners();
  }

  setAffection(value: number) {
    this.boneDragger.setAffection(value);
  }

  private setupEventListeners() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.headTracker.setMousePosition(ndcX, ndcY);
  };

  private onMouseLeave = () => {
    this.headTracker.setMouseLeave();
  };

  private onClick = (e: MouseEvent) => {
    if (!this.vrm || !this.canvas || !this.camera) return;
    if (this.boneDragger.getIsDragging()) return;

    const hit = this.raycaster.cast(e, this.canvas, this.camera, this.vrm);
    if (!hit) return;

    // Trigger jelly on the clicked bone
    this.jellyEffect.triggerImpulse(hit.boneName, 4);

    // Head pats give affection
    if (hit.boneName === 'head') {
      this.onAffectionChange?.(2, 'head pat 💕');
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.vrm || !this.canvas || !this.camera) return;
    if (e.button !== 0) return;

    const hit = this.raycaster.cast(e, this.canvas, this.camera, this.vrm);
    if (!hit) return;

    // Start drag on ANY bone
    const result = this.boneDragger.startDrag(hit.boneName, hit.worldPos);

    if (result === 'reject') {
      this.jellyEffect.triggerImpulse(hit.boneName, 5);
      this.onReject?.();
      this.onAffectionChange?.(-1, 'rejected grab');
    } else {
      this.dragBoneWorldPos.copy(hit.worldPos);
      this.canvas?.setPointerCapture(e.pointerId);

      if (hit.boneName === 'leftHand' || hit.boneName === 'rightHand') {
        this.onAffectionChange?.(1, 'holding hand 💗');
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.boneDragger.getIsDragging() || !this.canvas || !this.camera) return;

    // Project mouse onto camera-perpendicular plane at bone depth
    const worldPos = this.raycaster.screenToWorldOnPlane(
      e, this.canvas, this.camera, this.dragBoneWorldPos,
    );
    this.boneDragger.updateDragTarget(worldPos);
  };

  private onPointerUp = (_e: PointerEvent) => {
    if (this.boneDragger.getIsDragging()) {
      this.boneDragger.endDrag();
    }
  };

  update(delta: number) {
    this.headTracker.update(delta);
    this.jellyEffect.update(delta);
    this.boneDragger.update(delta);
  }

  dispose() {
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.onMouseMove);
      this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
      this.canvas.removeEventListener('click', this.onClick);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    }
    this.headTracker.dispose();
    this.jellyEffect.dispose();
    this.boneDragger.dispose();
    this.vrm = null;
    this.canvas = null;
    this.camera = null;
  }
}
