/**
 * VRM Interaction System
 *
 * 1. Head/Eye Mouse Tracking (LookAt with angle constraints)
 * 2. Jelly Click Effect (Spring Physics on Bone Scale)
 * 3. IK Arm Drag (Simplified CCD Inverse Kinematics)
 *
 * All interactions work on any VRM humanoid model.
 */
import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/* ═══════════════════════════════════════════════════════
   1. HEAD / EYE MOUSE TRACKING
   ═══════════════════════════════════════════════════════ */

export class HeadTracker {
  private vrm: VRM | null = null;
  private headBone: THREE.Object3D | null = null;
  private neckBone: THREE.Object3D | null = null;
  private leftEyeBone: THREE.Object3D | null = null;
  private rightEyeBone: THREE.Object3D | null = null;

  // Target rotation
  private targetHeadQuat = new THREE.Quaternion();
  private targetNeckQuat = new THREE.Quaternion();
  private restHeadQuat = new THREE.Quaternion();
  private restNeckQuat = new THREE.Quaternion();

  // Tracking parameters
  private readonly limitYaw = THREE.MathUtils.degToRad(35);   // left-right
  private readonly limitPitch = THREE.MathUtils.degToRad(25);  // up-down
  private readonly lerpSpeed = 3.0; // smoothing factor
  private enabled = true;

  // Mouse position in NDC (-1 to 1)
  private mouseNDC = new THREE.Vector2(0, 0);
  private isMouseOver = false;

  bind(vrm: VRM) {
    this.vrm = vrm;
    const hum = vrm.humanoid;
    if (!hum) return;

    this.headBone = hum.getNormalizedBoneNode('head');
    this.neckBone = hum.getNormalizedBoneNode('neck');
    this.leftEyeBone = hum.getNormalizedBoneNode('leftEye');
    this.rightEyeBone = hum.getNormalizedBoneNode('rightEye');

    // Store rest rotations
    if (this.headBone) this.restHeadQuat.copy(this.headBone.quaternion);
    if (this.neckBone) this.restNeckQuat.copy(this.neckBone.quaternion);

    // Disable VRM's built-in lookAt if present, we handle it manually
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
    if (!this.enabled || !this.headBone) return;

    let yaw = 0;
    let pitch = 0;

    if (this.isMouseOver) {
      // Map mouse NDC to angle ranges
      yaw = -this.mouseNDC.x * this.limitYaw;   // invert X: mouse right → look right
      pitch = this.mouseNDC.y * this.limitPitch; // mouse up → look up

      // Clamp angles
      yaw = THREE.MathUtils.clamp(yaw, -this.limitYaw, this.limitYaw);
      pitch = THREE.MathUtils.clamp(pitch, -this.limitPitch, this.limitPitch);
    }

    const t = 1 - Math.exp(-this.lerpSpeed * delta);

    // Neck gets ~40% of the rotation, head gets ~60%
    this.applyBoneTracking(this.neckBone, this.restNeckQuat, yaw * 0.4, pitch * 0.4, t);
    this.applyBoneTracking(this.headBone, this.restHeadQuat, yaw * 0.6, pitch * 0.6, t);

    // Eyes get subtle additional rotation
    if (this.leftEyeBone) {
      this.applyEyeTracking(this.leftEyeBone, yaw * 0.3, pitch * 0.2, t);
    }
    if (this.rightEyeBone) {
      this.applyEyeTracking(this.rightEyeBone, yaw * 0.3, pitch * 0.2, t);
    }
  }

  private applyBoneTracking(
    bone: THREE.Object3D | null,
    restQuat: THREE.Quaternion,
    yaw: number,
    pitch: number,
    t: number
  ) {
    if (!bone) return;

    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    const targetQ = restQuat.clone().multiply(qYaw).multiply(qPitch);

    bone.quaternion.slerp(targetQ, t);
  }

  private applyEyeTracking(bone: THREE.Object3D, yaw: number, pitch: number, t: number) {
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    const target = qYaw.multiply(qPitch);
    bone.quaternion.slerp(target, t);
  }

  dispose() {
    this.vrm = null;
    this.headBone = null;
    this.neckBone = null;
    this.leftEyeBone = null;
    this.rightEyeBone = null;
  }
}

/* ═══════════════════════════════════════════════════════
   2. JELLY CLICK EFFECT (Spring Physics on Bone Scale)
   ═══════════════════════════════════════════════════════ */

interface SpringBoneState {
  bone: THREE.Object3D;
  velocity: THREE.Vector3;
  targetScale: THREE.Vector3;
  /** Delay before impulse propagates to this bone (seconds) */
  delay: number;
  /** Remaining delay countdown */
  delayRemaining: number;
}

export class JellyEffect {
  private springs: Map<string, SpringBoneState> = new Map();
  private tension = 180;   // spring stiffness
  private damping = 12;    // friction / damping
  private active = false;

  /** Bone names that support jelly effect (VRM humanoid names) */
  private readonly JELLY_BONES: VRMHumanBoneName[] = [
    'hips', 'spine', 'chest', 'upperChest',
    'head', 'neck',
    'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  ];

  /** Parent→child chain for wave propagation */
  private readonly BONE_CHAIN: Record<string, string[]> = {
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
    this.springs.clear();

    for (const boneName of this.JELLY_BONES) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        this.springs.set(boneName, {
          bone,
          velocity: new THREE.Vector3(0, 0, 0),
          targetScale: new THREE.Vector3(1, 1, 1),
          delay: 0,
          delayRemaining: 0,
        });
      }
    }
  }

  /**
   * Trigger jelly impulse on a bone (and propagate wave to neighbors).
   * @param boneName  VRM humanoid bone name, or 'all' for full body
   * @param intensity Impulse strength (default 3)
   */
  triggerImpulse(boneName: string, intensity = 3) {
    this.active = true;

    if (boneName === 'all') {
      // Full-body jiggle from hips
      this.triggerBoneWithWave('hips', intensity, 0);
      return;
    }

    this.triggerBoneWithWave(boneName, intensity, 0);
  }

  private triggerBoneWithWave(boneName: string, intensity: number, delay: number) {
    const spring = this.springs.get(boneName);
    if (!spring) return;

    spring.velocity.set(
      intensity * (0.8 + Math.random() * 0.4),
      intensity * (0.8 + Math.random() * 0.4),
      intensity * (0.8 + Math.random() * 0.4),
    );
    spring.delay = delay;
    spring.delayRemaining = delay;

    // Propagate to children with increasing delay and reduced intensity
    const children = this.BONE_CHAIN[boneName];
    if (children) {
      for (const child of children) {
        this.triggerBoneWithWave(child, intensity * 0.65, delay + 0.04);
      }
    }
  }

  update(delta: number) {
    if (!this.active) return;

    let anyActive = false;

    for (const [, state] of this.springs) {
      // Wait for propagation delay
      if (state.delayRemaining > 0) {
        state.delayRemaining -= delta;
        anyActive = true;
        continue;
      }

      // Hooke's law: F = -k * (x - target) - d * velocity
      const displacement = state.bone.scale.clone().sub(state.targetScale);
      const springForce = displacement.multiplyScalar(-this.tension);
      const dampingForce = state.velocity.clone().multiplyScalar(-this.damping);
      const acceleration = springForce.add(dampingForce);

      state.velocity.add(acceleration.clone().multiplyScalar(delta));
      state.bone.scale.add(state.velocity.clone().multiplyScalar(delta));

      // Check if settled (velocity and displacement both near zero)
      const vel = state.velocity.length();
      const disp = state.bone.scale.distanceTo(state.targetScale);

      if (vel > 0.001 || disp > 0.001) {
        anyActive = true;
      } else {
        // Snap to target and zero velocity
        state.bone.scale.copy(state.targetScale);
        state.velocity.set(0, 0, 0);
      }
    }

    if (!anyActive) {
      this.active = false;
    }
  }

  dispose() {
    this.springs.clear();
    this.active = false;
  }
}

/* ═══════════════════════════════════════════════════════
   3. IK ARM DRAG (Simplified Two-Bone IK)
   ═══════════════════════════════════════════════════════ */

interface IKChain {
  shoulder: THREE.Object3D;
  upperArm: THREE.Object3D;
  lowerArm: THREE.Object3D;
  hand: THREE.Object3D;
  side: 'left' | 'right';
  restUpperArmQuat: THREE.Quaternion;
  restLowerArmQuat: THREE.Quaternion;
}

export class ArmDragIK {
  private vrm: VRM | null = null;
  private leftChain: IKChain | null = null;
  private rightChain: IKChain | null = null;

  private isDragging = false;
  private activeChain: IKChain | null = null;
  private targetWorldPos = new THREE.Vector3();

  // Blend back to animation
  private blendBack = false;
  private blendBackT = 0;
  private readonly blendBackSpeed = 2.0;

  // Affection-based interaction
  private affection = 50;

  bind(vrm: VRM) {
    this.vrm = vrm;
    const hum = vrm.humanoid;
    if (!hum) return;

    this.leftChain = this.buildChain(hum, 'left');
    this.rightChain = this.buildChain(hum, 'right');
  }

  setAffection(value: number) {
    this.affection = value;
  }

  private buildChain(
    hum: NonNullable<VRM['humanoid']>,
    side: 'left' | 'right'
  ): IKChain | null {
    const prefix = side === 'left' ? 'left' : 'right';
    const shoulder = hum.getNormalizedBoneNode(`${prefix}Shoulder` as VRMHumanBoneName);
    const upperArm = hum.getNormalizedBoneNode(`${prefix}UpperArm` as VRMHumanBoneName);
    const lowerArm = hum.getNormalizedBoneNode(`${prefix}LowerArm` as VRMHumanBoneName);
    const hand = hum.getNormalizedBoneNode(`${prefix}Hand` as VRMHumanBoneName);

    if (!shoulder || !upperArm || !lowerArm || !hand) return null;

    return {
      shoulder,
      upperArm,
      lowerArm,
      hand,
      side,
      restUpperArmQuat: upperArm.quaternion.clone(),
      restLowerArmQuat: lowerArm.quaternion.clone(),
    };
  }

  /**
   * Start dragging a hand.
   * @returns 'accept' if affection allows, 'reject' if too low
   */
  startDrag(side: 'left' | 'right', worldPos: THREE.Vector3): 'accept' | 'reject' {
    const chain = side === 'left' ? this.leftChain : this.rightChain;
    if (!chain) return 'reject';

    // Low affection: reject the drag
    if (this.affection < 25) {
      return 'reject';
    }

    this.activeChain = chain;
    this.isDragging = true;
    this.blendBack = false;
    this.targetWorldPos.copy(worldPos);

    // Store current rotations as rest
    chain.restUpperArmQuat.copy(chain.upperArm.quaternion);
    chain.restLowerArmQuat.copy(chain.lowerArm.quaternion);

    return 'accept';
  }

  updateDrag(worldPos: THREE.Vector3) {
    if (!this.isDragging || !this.activeChain) return;
    this.targetWorldPos.copy(worldPos);
  }

  endDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.blendBack = true;
    this.blendBackT = 0;
  }

  getIsDragging(): boolean {
    return this.isDragging;
  }

  update(delta: number) {
    if (this.isDragging && this.activeChain) {
      this.solveTwoBoneIK(this.activeChain, this.targetWorldPos);
    }

    // Blend back to animation pose
    if (this.blendBack && this.activeChain) {
      this.blendBackT += delta * this.blendBackSpeed;
      if (this.blendBackT >= 1) {
        this.blendBack = false;
        this.activeChain = null;
      }
      // The animation system will naturally take over as we stop setting IK rotations
    }
  }

  /**
   * Simplified Two-Bone IK:
   * Given target position, compute upperArm and lowerArm rotations
   * so the hand reaches the target.
   */
  private solveTwoBoneIK(chain: IKChain, targetWorld: THREE.Vector3) {
    const { upperArm, lowerArm, hand } = chain;

    // Get bone positions in world space
    const shoulderPos = new THREE.Vector3();
    const elbowPos = new THREE.Vector3();
    const handPos = new THREE.Vector3();

    upperArm.getWorldPosition(shoulderPos);
    lowerArm.getWorldPosition(elbowPos);
    hand.getWorldPosition(handPos);

    // Bone lengths
    const upperLen = shoulderPos.distanceTo(elbowPos);
    const lowerLen = elbowPos.distanceTo(handPos);
    const totalLen = upperLen + lowerLen;

    // Direction and distance to target
    const toTarget = targetWorld.clone().sub(shoulderPos);
    let targetDist = toTarget.length();

    // Clamp target distance to reachable range
    targetDist = Math.min(targetDist, totalLen * 0.98);
    targetDist = Math.max(targetDist, Math.abs(upperLen - lowerLen) + 0.01);

    // Direction from shoulder to target (in world space)
    const dir = toTarget.normalize();

    // Law of cosines for elbow angle
    const cosAngle = (upperLen * upperLen + lowerLen * lowerLen - targetDist * targetDist)
                     / (2 * upperLen * lowerLen);
    const elbowAngle = Math.acos(THREE.MathUtils.clamp(cosAngle, -1, 1));

    // Rotate upper arm to point toward target
    const worldToUpper = new THREE.Quaternion();
    upperArm.parent?.getWorldQuaternion(worldToUpper);
    worldToUpper.invert();

    const localDir = dir.clone().applyQuaternion(worldToUpper);
    const currentDir = new THREE.Vector3(0, -1, 0); // default bone direction

    const rotQ = new THREE.Quaternion().setFromUnitVectors(currentDir, localDir);
    upperArm.quaternion.copy(rotQ);

    // Apply elbow bend
    const bendAxis = new THREE.Vector3(1, 0, 0); // bend forward
    const bendQ = new THREE.Quaternion().setFromAxisAngle(bendAxis, Math.PI - elbowAngle);
    lowerArm.quaternion.copy(bendQ);
  }

  dispose() {
    this.vrm = null;
    this.leftChain = null;
    this.rightChain = null;
    this.activeChain = null;
  }
}

/* ═══════════════════════════════════════════════════════
   4. RAYCASTING HELPER — detects which bone was clicked
   ═══════════════════════════════════════════════════════ */

export class VRMRaycaster {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  /**
   * Cast a ray from mouse position and find the closest VRM bone.
   * @returns Bone name and world hit position, or null
   */
  cast(
    event: MouseEvent | Touch,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    vrm: VRM,
  ): { boneName: string; worldPos: THREE.Vector3 } | null {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);

    // Raycast against VRM meshes
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
      const bone = humanoid.getNormalizedBoneNode(name);
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
   * Get 3D world position from mouse position on a plane at given depth.
   */
  getWorldPosition(
    event: MouseEvent | Touch,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    planeZ = 0,
  ): THREE.Vector3 {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const pos = new THREE.Vector3(ndcX, ndcY, 0.5);
    pos.unproject(camera);

    // Project onto a plane at planeZ
    const dir = pos.sub(camera.position).normalize();
    const t = (planeZ - camera.position.z) / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(t));
  }

  /**
   * Get NDC coordinates from mouse event on canvas.
   */
  getNDC(event: MouseEvent | Touch, canvas: HTMLCanvasElement): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }
}

/* ═══════════════════════════════════════════════════════
   5. INTERACTION MANAGER — orchestrates all systems
   ═══════════════════════════════════════════════════════ */

export class InteractionManager {
  public headTracker = new HeadTracker();
  public jellyEffect = new JellyEffect();
  public armDragIK = new ArmDragIK();
  public raycaster = new VRMRaycaster();

  private vrm: VRM | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private camera: THREE.Camera | null = null;

  // Callbacks for UI notifications
  public onAffectionChange?: (delta: number, reason: string) => void;
  public onReject?: () => void;

  bind(vrm: VRM, canvas: HTMLCanvasElement, camera: THREE.Camera) {
    this.vrm = vrm;
    this.canvas = canvas;
    this.camera = camera;

    this.headTracker.bind(vrm);
    this.jellyEffect.bind(vrm);
    this.armDragIK.bind(vrm);

    this.setupEventListeners();
  }

  setAffection(value: number) {
    this.armDragIK.setAffection(value);
  }

  private setupEventListeners() {
    if (!this.canvas) return;

    // Mouse move → head tracking
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);

    // Click → jelly effect
    this.canvas.addEventListener('click', this.onClick);

    // Drag → IK arm drag
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
    if (this.armDragIK.getIsDragging()) return;

    const hit = this.raycaster.cast(e, this.canvas, this.camera, this.vrm);
    if (!hit) return;

    // Trigger jelly on clicked bone
    this.jellyEffect.triggerImpulse(hit.boneName, 3);

    // Affection boost for head pats
    if (hit.boneName === 'head') {
      this.onAffectionChange?.(2, 'head pat 💕');
    }
  };

  private dragStartBone: string | null = null;

  private onPointerDown = (e: PointerEvent) => {
    if (!this.vrm || !this.canvas || !this.camera) return;
    if (e.button !== 0) return; // left click only

    const hit = this.raycaster.cast(e, this.canvas, this.camera, this.vrm);
    if (!hit) return;

    // Check if we're clicking a hand for drag
    if (hit.boneName === 'leftHand' || hit.boneName === 'rightHand') {
      const side = hit.boneName === 'leftHand' ? 'left' : 'right';
      const result = this.armDragIK.startDrag(side as 'left' | 'right', hit.worldPos);

      if (result === 'reject') {
        // Play rejection — trigger jelly shake and notify
        this.jellyEffect.triggerImpulse(hit.boneName, 5);
        this.onReject?.();
        this.onAffectionChange?.(-1, 'rejected hand grab');
      } else {
        this.dragStartBone = hit.boneName;
        this.canvas?.setPointerCapture(e.pointerId);
        // Disable orbit controls while dragging
        this.onAffectionChange?.(1, 'holding hand 💗');
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.armDragIK.getIsDragging() || !this.canvas || !this.camera) return;

    const worldPos = this.raycaster.getWorldPosition(e, this.canvas, this.camera, 0);
    this.armDragIK.updateDrag(worldPos);
  };

  private onPointerUp = (_e: PointerEvent) => {
    if (this.armDragIK.getIsDragging()) {
      this.armDragIK.endDrag();
      this.dragStartBone = null;
    }
  };

  update(delta: number) {
    this.headTracker.update(delta);
    this.jellyEffect.update(delta);
    this.armDragIK.update(delta);
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
    this.armDragIK.dispose();
    this.vrm = null;
    this.canvas = null;
    this.camera = null;
  }
}
