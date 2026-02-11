/**
 * Procedural Animations for VRM models
 *
 * These are programmatically generated motion clips that work on any VRM model
 * without needing external FBX files. They serve as:
 * 1. Immediate fallback when FBX files aren't available
 * 2. Lightweight alternatives for low-end devices
 *
 * Each animation targets VRM humanoid bones by their normalized names.
 *
 * IMPORTANT — Arm Rest Pose
 * VRM T-pose has arms extended horizontally (Z rotation ≈ 0).
 * We define a "natural rest" with arms at sides:
 *   leftUpperArm:  euler (0.2, 0,  1.15)  → arms at sides, slightly forward
 *   rightUpperArm: euler (0.2, 0, -1.15)  → mirror
 *   leftLowerArm:  euler (0, 0, 0.08)     → slight relaxation bend
 *   rightLowerArm: euler (0, 0, -0.08)
 *
 * All arm rotations in procedural clips use ABSOLUTE Euler values so they
 * look correct regardless of whether a rest pose has been applied.
 */
import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/* ───── Constants: Natural Rest Pose ───── */

/** Arms-down rest pose rotations (Euler XYZ radians) */
export const REST_POSE = {
  leftUpperArm:  [0.2, 0, 1.15] as [number, number, number],
  rightUpperArm: [0.2, 0, -1.15] as [number, number, number],
  leftLowerArm:  [0, 0, 0.08] as [number, number, number],
  rightLowerArm: [0, 0, -0.08] as [number, number, number],
} as const;

/** Shorthand aliases */
const L_UP = REST_POSE.leftUpperArm;
const R_UP = REST_POSE.rightUpperArm;
const L_LO = REST_POSE.leftLowerArm;
const R_LO = REST_POSE.rightLowerArm;

/* ───── Helpers ───── */

function getBone(vrm: VRM, name: string): THREE.Object3D | null {
  return vrm.humanoid?.getNormalizedBoneNode(name as VRMHumanBoneName) ?? null;
}

/** Create a quaternion keyframe track from Euler angles (ABSOLUTE, not delta). */
function quatTrack(bone: THREE.Object3D, times: number[], eulers: [number, number, number][]): THREE.QuaternionKeyframeTrack {
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const values: number[] = [];
  for (const [x, y, z] of eulers) {
    e.set(x, y, z);
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
}

function posTrack(bone: THREE.Object3D, times: number[], offsets: [number, number, number][]): THREE.VectorKeyframeTrack {
  const values: number[] = [];
  for (const [dx, dy, dz] of offsets) {
    values.push(bone.position.x + dx, bone.position.y + dy, bone.position.z + dz);
  }
  return new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values);
}

/** Helper: add small offsets to a base Euler */
function addEuler(base: readonly [number, number, number], dx: number, dy: number, dz: number): [number, number, number] {
  return [base[0] + dx, base[1] + dy, base[2] + dz];
}

/* ───── Apply rest pose to VRM bones directly ───── */

/**
 * Apply the natural arms-down rest pose to a VRM model.
 * Call this after loading the VRM and before starting any animations.
 * @param vrm  The VRM to apply rest pose to
 * @param armAngle  Z-rotation angle for upper arms (default 1.15 ≈ arms at sides)
 * @param armPitch  Forward pitch on upper arms (default 0.2)
 */
export function applyRestPose(vrm: VRM, armAngle?: number, armPitch?: number): void {
  const angle = armAngle ?? REST_POSE.leftUpperArm[2];
  const pitch = armPitch ?? REST_POSE.leftUpperArm[0];
  const customPose: [string, [number, number, number]][] = [
    ['leftUpperArm',  [pitch, 0, angle]],
    ['rightUpperArm', [pitch, 0, -angle]],
    ['leftLowerArm',  REST_POSE.leftLowerArm as unknown as [number, number, number]],
    ['rightLowerArm', REST_POSE.rightLowerArm as unknown as [number, number, number]],
  ];
  for (const [name, euler] of customPose) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(name as VRMHumanBoneName);
    if (bone) bone.rotation.set(euler[0], euler[1], euler[2]);
  }
}

/* ───── Procedural Clips ───── */

export function createProceduralClip(vrm: VRM, motionId: string): THREE.AnimationClip | null {
  const fn = PROCEDURAL_CLIPS[motionId];
  if (!fn) return null;
  return fn(vrm);
}

/**
 * Registry of all procedural animation generators.
 * Key = motion id (must match MOTION_LIBRARY ids)
 */
const PROCEDURAL_CLIPS: Record<string, (vrm: VRM) => THREE.AnimationClip | null> = {
  /* ═══ Idles ═══ */

  idle_breathe: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const dur = 4.0;

    const spine = getBone(vrm, 'spine');
    const chest = getBone(vrm, 'chest');
    const head = getBone(vrm, 'head');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const hips = getBone(vrm, 'hips');

    // Spine breathing
    if (spine) {
      tracks.push(posTrack(spine, [0, 1.3, 2.6, dur], [
        [0, 0, 0], [0, 0.003, 0], [0, 0.001, 0], [0, 0, 0],
      ]));
    }

    // Chest tilt
    if (chest) {
      tracks.push(quatTrack(chest, [0, 1.3, 2.6, dur], [
        [0, 0, 0], [0.015, 0, 0], [0.005, 0, 0], [0, 0, 0],
      ]));
    }

    // Head micro-look
    if (head) {
      tracks.push(quatTrack(head, [0, 1.2, 2.0, 3.2, dur], [
        [0.02, 0.01, 0],
        [-0.01, -0.02, 0],
        [0.015, 0.02, 0.005],
        [-0.01, -0.01, -0.005],
        [0.02, 0.01, 0],
      ]));
    }

    // Hips weight shift
    if (hips) {
      tracks.push(posTrack(hips, [0, 2.0, dur], [
        [0, 0, 0], [0.003, 0, 0], [0, 0, 0],
      ]));
    }

    // Arms — natural rest pose with gentle sway (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 1.5, 3.0, dur], [
        L_UP, addEuler(L_UP, 0, 0, -0.02), addEuler(L_UP, 0, 0, 0.015), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 1.5, 3.0, dur], [
        R_UP, addEuler(R_UP, 0, 0, 0.02), addEuler(R_UP, 0, 0, -0.015), R_UP,
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('idle_breathe', dur, tracks) : null;
  },

  idle_happy: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const dur = 3.0;

    const spine = getBone(vrm, 'spine');
    const head = getBone(vrm, 'head');
    const hips = getBone(vrm, 'hips');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');

    // Bouncy weight shift
    if (hips) {
      tracks.push(posTrack(hips, [0, 0.5, 1.0, 1.5, 2.0, 2.5, dur], [
        [0, 0, 0], [0.004, 0.005, 0], [-0.004, 0, 0],
        [0.004, 0.005, 0], [-0.004, 0, 0], [0.004, 0.005, 0], [0, 0, 0],
      ]));
    }

    // Head tilt (cheerful)
    if (head) {
      tracks.push(quatTrack(head, [0, 0.75, 1.5, 2.25, dur], [
        [-0.05, 0.02, 0.04],
        [-0.03, -0.03, -0.04],
        [-0.05, 0.02, 0.04],
        [-0.03, -0.03, -0.04],
        [-0.05, 0.02, 0.04],
      ]));
    }

    // Spine — slight lean back (happy posture)
    if (spine) {
      tracks.push(quatTrack(spine, [0, 1.5, dur], [
        [-0.02, 0, 0], [-0.03, 0, 0], [-0.02, 0, 0],
      ]));
    }

    // Arms — slightly out from rest, relaxed sway (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 1.0, 2.0, dur], [
        addEuler(L_UP, 0.05, 0, -0.08), addEuler(L_UP, 0.02, 0, -0.05),
        addEuler(L_UP, 0.05, 0, -0.08), addEuler(L_UP, 0.05, 0, -0.08),
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 1.0, 2.0, dur], [
        addEuler(R_UP, 0.05, 0, 0.08), addEuler(R_UP, 0.02, 0, 0.05),
        addEuler(R_UP, 0.05, 0, 0.08), addEuler(R_UP, 0.05, 0, 0.08),
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('idle_happy', dur, tracks) : null;
  },

  idle_sad: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const dur = 5.0;

    const head = getBone(vrm, 'head');
    const spine = getBone(vrm, 'spine');
    const chest = getBone(vrm, 'chest');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');

    // Head drooping
    if (head) {
      tracks.push(quatTrack(head, [0, 2.5, dur], [
        [0.12, -0.02, 0], [0.14, 0.02, 0], [0.12, -0.02, 0],
      ]));
    }

    // Spine slumped
    if (spine) {
      tracks.push(quatTrack(spine, [0, 2.5, dur], [
        [0.06, 0, 0], [0.07, 0, 0.01], [0.06, 0, 0],
      ]));
    }

    // Chest concave
    if (chest) {
      tracks.push(quatTrack(chest, [0, 2.5, dur], [
        [0.04, 0, 0], [0.05, 0, 0], [0.04, 0, 0],
      ]));
    }

    // Arms hanging lower, limp (absolute — arms more forward and down)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 2.5, dur], [
        addEuler(L_UP, 0.15, 0, 0.05), addEuler(L_UP, 0.16, 0, 0.06), addEuler(L_UP, 0.15, 0, 0.05),
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 2.5, dur], [
        addEuler(R_UP, 0.15, 0, -0.05), addEuler(R_UP, 0.16, 0, -0.06), addEuler(R_UP, 0.15, 0, -0.05),
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('idle_sad', dur, tracks) : null;
  },

  /* ═══ Gestures (one-shot) ═══ */

  nod: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const head = getBone(vrm, 'head');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    if (!head) return null;

    tracks.push(quatTrack(head, [0, 0.2, 0.5, 0.7, 1.0, 1.2], [
      [0, 0, 0], [-0.18, 0, 0], [0.02, 0, 0], [-0.12, 0, 0], [0.01, 0, 0], [0, 0, 0],
    ]));
    // Keep arms in rest pose during head motion
    if (lArm) tracks.push(quatTrack(lArm, [0, 1.2], [L_UP, L_UP]));
    if (rArm) tracks.push(quatTrack(rArm, [0, 1.2], [R_UP, R_UP]));

    return new THREE.AnimationClip('nod', 1.2, tracks);
  },

  shake: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const head = getBone(vrm, 'head');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    if (!head) return null;

    tracks.push(quatTrack(head, [0, 0.15, 0.35, 0.55, 0.75, 1.0], [
      [0, 0, 0], [0, 0.15, 0], [0, -0.15, 0], [0, 0.1, 0], [0, -0.08, 0], [0, 0, 0],
    ]));
    if (lArm) tracks.push(quatTrack(lArm, [0, 1.0], [L_UP, L_UP]));
    if (rArm) tracks.push(quatTrack(rArm, [0, 1.0], [R_UP, R_UP]));

    return new THREE.AnimationClip('shake', 1.0, tracks);
  },

  thinking: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const head = getBone(vrm, 'head');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const rForearm = getBone(vrm, 'rightLowerArm');
    const rHand = getBone(vrm, 'rightHand');

    if (head) {
      tracks.push(quatTrack(head, [0, 0.5, 2.5, 3.0], [
        [0, 0, 0], [0.1, 0.06, 0.03], [0.1, -0.04, -0.02], [0, 0, 0],
      ]));
    }

    // Right hand to chin — arm comes up from rest
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.5, 2.5, 3.0], [
        R_UP, [-0.6, 0.3, -0.3], [-0.6, 0.3, -0.3], R_UP,
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, 0.5, 2.5, 3.0], [
        R_LO, [-1.2, 0, 0], [-1.2, 0, 0], R_LO,
      ]));
    }
    if (rHand) {
      tracks.push(quatTrack(rHand, [0, 0.5, 2.5, 3.0], [
        [0, 0, 0], [0.2, 0, 0.1], [0.2, 0, 0.1], [0, 0, 0],
      ]));
    }

    // Left arm stays at rest
    if (lArm) tracks.push(quatTrack(lArm, [0, 3.0], [L_UP, L_UP]));

    return tracks.length > 0 ? new THREE.AnimationClip('thinking', 3.0, tracks) : null;
  },

  point: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const rForearm = getBone(vrm, 'rightLowerArm');

    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.3, 1.2, 1.5], [
        R_UP, [-0.4, 0, -1.0], [-0.4, 0, -1.0], R_UP,
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, 0.3, 1.2, 1.5], [
        R_LO, [-0.3, 0, 0], [-0.3, 0, 0], R_LO,
      ]));
    }
    if (lArm) tracks.push(quatTrack(lArm, [0, 1.5], [L_UP, L_UP]));

    return tracks.length > 0 ? new THREE.AnimationClip('point', 1.5, tracks) : null;
  },

  shrug: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const lForearm = getBone(vrm, 'leftLowerArm');
    const rForearm = getBone(vrm, 'rightLowerArm');
    const head = getBone(vrm, 'head');
    const lShoulder = getBone(vrm, 'leftShoulder');
    const rShoulder = getBone(vrm, 'rightShoulder');

    const times = [0, 0.3, 1.0, 1.3];

    // Shoulders up
    if (lShoulder) {
      tracks.push(quatTrack(lShoulder, times, [
        [0, 0, 0], [0, 0, 0.15], [0, 0, 0.15], [0, 0, 0],
      ]));
    }
    if (rShoulder) {
      tracks.push(quatTrack(rShoulder, times, [
        [0, 0, 0], [0, 0, -0.15], [0, 0, -0.15], [0, 0, 0],
      ]));
    }

    // Arms out from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, times, [
        L_UP, addEuler(L_UP, 0, 0, 0.3), addEuler(L_UP, 0, 0, 0.3), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, times, [
        R_UP, addEuler(R_UP, 0, 0, -0.3), addEuler(R_UP, 0, 0, -0.3), R_UP,
      ]));
    }

    // Forearms up (absolute)
    if (lForearm) {
      tracks.push(quatTrack(lForearm, times, [
        L_LO, addEuler(L_LO, -0.5, 0, 0), addEuler(L_LO, -0.5, 0, 0), L_LO,
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, times, [
        R_LO, addEuler(R_LO, -0.5, 0, 0), addEuler(R_LO, -0.5, 0, 0), R_LO,
      ]));
    }

    // Head tilt
    if (head) {
      tracks.push(quatTrack(head, times, [
        [0, 0, 0], [0, 0.05, 0.08], [0, 0.05, 0.08], [0, 0, 0],
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('shrug', 1.3, tracks) : null;
  },

  wave: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const rForearm = getBone(vrm, 'rightLowerArm');
    const rHand = getBone(vrm, 'rightHand');

    // Arm up (absolute)
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.3, 1.8, 2.1], [
        R_UP, [-0.2, 0, -1.5], [-0.2, 0, -1.5], R_UP,
      ]));
    }

    // Forearm bent (absolute)
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, 0.3, 1.8, 2.1], [
        R_LO, addEuler(R_LO, -1.0, 0, 0), addEuler(R_LO, -1.0, 0, 0), R_LO,
      ]));
    }
    if (lArm) tracks.push(quatTrack(lArm, [0, 2.1], [L_UP, L_UP]));

    // Hand waving
    if (rHand) {
      tracks.push(quatTrack(rHand, [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1], [
        [0, 0, 0],
        [0, 0, 0.3],
        [0, 0, -0.3],
        [0, 0, 0.3],
        [0, 0, -0.3],
        [0, 0, 0.3],
        [0, 0, -0.3],
        [0, 0, 0],
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('wave', 2.1, tracks) : null;
  },

  clap: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const lForearm = getBone(vrm, 'leftLowerArm');
    const rForearm = getBone(vrm, 'rightLowerArm');

    const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6];
    const clapAngles = [0, 0.15, 0, 0.15, 0, 0.15, 0, 0.1, 0];

    // Arms forward from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.15, 1.5, 1.6], [
        L_UP, addEuler(L_UP, -0.6, 0.4, -0.85), addEuler(L_UP, -0.6, 0.4, -0.85), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.15, 1.5, 1.6], [
        R_UP, addEuler(R_UP, -0.6, -0.4, 0.85), addEuler(R_UP, -0.6, -0.4, 0.85), R_UP,
      ]));
    }

    // Forearm clapping (absolute)
    if (lForearm) {
      const vals: [number, number, number][] = clapAngles.map(a => addEuler(L_LO, -0.8, a, 0));
      tracks.push(quatTrack(lForearm, times, vals));
    }
    if (rForearm) {
      const vals: [number, number, number][] = clapAngles.map(a => addEuler(R_LO, -0.8, -a, 0));
      tracks.push(quatTrack(rForearm, times, vals));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('clap', 1.6, tracks) : null;
  },

  bow: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const spine = getBone(vrm, 'spine');
    const chest = getBone(vrm, 'chest');
    const head = getBone(vrm, 'head');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');

    const times = [0, 0.5, 1.5, 2.0];

    if (spine) {
      tracks.push(quatTrack(spine, times, [
        [0, 0, 0], [0.25, 0, 0], [0.25, 0, 0], [0, 0, 0],
      ]));
    }
    if (chest) {
      tracks.push(quatTrack(chest, times, [
        [0, 0, 0], [0.15, 0, 0], [0.15, 0, 0], [0, 0, 0],
      ]));
    }
    if (head) {
      tracks.push(quatTrack(head, times, [
        [0, 0, 0], [0.15, 0, 0], [0.15, 0, 0], [0, 0, 0],
      ]));
    }
    // Arms at rest (absolute)
    if (lArm) tracks.push(quatTrack(lArm, [0, 2.0], [L_UP, L_UP]));
    if (rArm) tracks.push(quatTrack(rArm, [0, 2.0], [R_UP, R_UP]));

    return tracks.length > 0 ? new THREE.AnimationClip('bow', 2.0, tracks) : null;
  },

  cheer: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const lForearm = getBone(vrm, 'leftLowerArm');
    const rForearm = getBone(vrm, 'rightLowerArm');
    const hips = getBone(vrm, 'hips');

    // Arms up from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8], [
        L_UP, [0, 0, 1.8], [0, 0, 1.6], [0, 0, 1.8],
        [0, 0, 1.6], [0, 0, 1.8], L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8], [
        R_UP, [0, 0, -1.8], [0, 0, -1.6], [0, 0, -1.8],
        [0, 0, -1.6], [0, 0, -1.8], R_UP,
      ]));
    }

    if (lForearm) {
      tracks.push(quatTrack(lForearm, [0, 0.3, 1.5, 1.8], [
        L_LO, addEuler(L_LO, -0.4, 0, 0), addEuler(L_LO, -0.4, 0, 0), L_LO,
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, 0.3, 1.5, 1.8], [
        R_LO, addEuler(R_LO, -0.4, 0, 0), addEuler(R_LO, -0.4, 0, 0), R_LO,
      ]));
    }

    // Bounce
    if (hips) {
      tracks.push(posTrack(hips, [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8], [
        [0, 0, 0], [0, 0.01, 0], [0, 0, 0], [0, 0.01, 0],
        [0, 0, 0], [0, 0.01, 0], [0, 0, 0],
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('cheer', 1.8, tracks) : null;
  },

  surprised_back: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const spine = getBone(vrm, 'spine');
    const head = getBone(vrm, 'head');
    const hips = getBone(vrm, 'hips');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');

    // Lean back
    if (spine) {
      tracks.push(quatTrack(spine, [0, 0.15, 0.5, 0.8], [
        [0, 0, 0], [-0.1, 0, 0], [-0.06, 0, 0], [0, 0, 0],
      ]));
    }

    // Head back
    if (head) {
      tracks.push(quatTrack(head, [0, 0.12, 0.5, 0.8], [
        [0, 0, 0], [-0.15, 0, 0], [-0.08, 0, 0], [0, 0, 0],
      ]));
    }

    // Step back
    if (hips) {
      tracks.push(posTrack(hips, [0, 0.15, 0.5, 0.8], [
        [0, 0, 0], [0, 0.008, -0.02], [0, 0.004, -0.01], [0, 0, 0],
      ]));
    }

    // Arms up/out from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.15, 0.5, 0.8], [
        L_UP, addEuler(L_UP, -0.2, 0, -0.55), addEuler(L_UP, -0.1, 0, -0.85), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.15, 0.5, 0.8], [
        R_UP, addEuler(R_UP, -0.2, 0, 0.55), addEuler(R_UP, -0.1, 0, 0.85), R_UP,
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('surprised_back', 0.8, tracks) : null;
  },

  happy_jump: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const hips = getBone(vrm, 'hips');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const head = getBone(vrm, 'head');

    // Jump
    if (hips) {
      tracks.push(posTrack(hips, [0, 0.2, 0.4, 0.6, 0.8, 1.0], [
        [0, 0, 0], [0, -0.01, 0], [0, 0.025, 0],
        [0, 0.02, 0], [0, -0.005, 0], [0, 0, 0],
      ]));
    }

    // Arms up from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.2, 0.5, 0.8, 1.0], [
        L_UP, addEuler(L_UP, 0, 0, -0.85), [0, 0, 1.6], addEuler(L_UP, 0, 0, -0.65), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.2, 0.5, 0.8, 1.0], [
        R_UP, addEuler(R_UP, 0, 0, 0.85), [0, 0, -1.6], addEuler(R_UP, 0, 0, 0.65), R_UP,
      ]));
    }

    // Head tilt back (happy)
    if (head) {
      tracks.push(quatTrack(head, [0, 0.3, 0.6, 1.0], [
        [0, 0, 0], [-0.1, 0, 0], [-0.05, 0, 0], [0, 0, 0],
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('happy_jump', 1.0, tracks) : null;
  },

  sad_cry: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const head = getBone(vrm, 'head');
    const spine = getBone(vrm, 'spine');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const lForearm = getBone(vrm, 'leftLowerArm');
    const rForearm = getBone(vrm, 'rightLowerArm');

    // Head down and shaking slightly
    if (head) {
      tracks.push(quatTrack(head, [0, 0.3, 0.8, 1.3, 1.8, 2.5], [
        [0, 0, 0], [0.2, 0, 0], [0.2, 0.04, 0],
        [0.2, -0.04, 0], [0.2, 0.02, 0], [0, 0, 0],
      ]));
    }

    // Spine hunched
    if (spine) {
      tracks.push(quatTrack(spine, [0, 0.3, 2.0, 2.5], [
        [0, 0, 0], [0.1, 0, 0], [0.1, 0, 0], [0, 0, 0],
      ]));
    }

    // Hands to face from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.3, 2.0, 2.5], [
        L_UP, addEuler(L_UP, -0.5, 0.3, -0.85), addEuler(L_UP, -0.5, 0.3, -0.85), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.3, 2.0, 2.5], [
        R_UP, addEuler(R_UP, -0.5, -0.3, 0.85), addEuler(R_UP, -0.5, -0.3, 0.85), R_UP,
      ]));
    }
    if (lForearm) {
      tracks.push(quatTrack(lForearm, [0, 0.3, 2.0, 2.5], [
        L_LO, addEuler(L_LO, -1.4, 0, 0), addEuler(L_LO, -1.4, 0, 0), L_LO,
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, 0.3, 2.0, 2.5], [
        R_LO, addEuler(R_LO, -1.4, 0, 0), addEuler(R_LO, -1.4, 0, 0), R_LO,
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('sad_cry', 2.5, tracks) : null;
  },

  angry_stomp: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const head = getBone(vrm, 'head');
    const spine = getBone(vrm, 'spine');
    const hips = getBone(vrm, 'hips');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const lForearm = getBone(vrm, 'leftLowerArm');
    const rForearm = getBone(vrm, 'rightLowerArm');

    // Head forward (aggressive)
    if (head) {
      tracks.push(quatTrack(head, [0, 0.2, 0.6, 1.0], [
        [0, 0, 0], [0.08, 0, 0], [0.05, 0, 0], [0, 0, 0],
      ]));
    }

    // Spine lean forward
    if (spine) {
      tracks.push(quatTrack(spine, [0, 0.2, 0.6, 1.0], [
        [0, 0, 0], [0.06, 0, 0], [0.03, 0, 0], [0, 0, 0],
      ]));
    }

    // Stomp
    if (hips) {
      tracks.push(posTrack(hips, [0, 0.15, 0.3, 0.45, 0.6, 1.0], [
        [0, 0, 0], [0, -0.008, 0], [0, 0, 0],
        [0, -0.008, 0], [0, 0, 0], [0, 0, 0],
      ]));
    }

    // Fists clenched from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.2, 0.8, 1.0], [
        L_UP, addEuler(L_UP, -0.3, 0.3, -0.95), addEuler(L_UP, -0.3, 0.3, -0.95), L_UP,
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.2, 0.8, 1.0], [
        R_UP, addEuler(R_UP, -0.3, -0.3, 0.95), addEuler(R_UP, -0.3, -0.3, 0.95), R_UP,
      ]));
    }
    if (lForearm) {
      tracks.push(quatTrack(lForearm, [0, 0.2, 0.8, 1.0], [
        L_LO, addEuler(L_LO, -1.2, 0, 0), addEuler(L_LO, -1.2, 0, 0), L_LO,
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, 0.2, 0.8, 1.0], [
        R_LO, addEuler(R_LO, -1.2, 0, 0), addEuler(R_LO, -1.2, 0, 0), R_LO,
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('angry_stomp', 1.0, tracks) : null;
  },

  /* ═══ Dance ═══ */

  dance_happy: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const dur = 4.0;
    const hips = getBone(vrm, 'hips');
    const spine = getBone(vrm, 'spine');
    const head = getBone(vrm, 'head');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');
    const lForearm = getBone(vrm, 'leftLowerArm');
    const rForearm = getBone(vrm, 'rightLowerArm');

    // Hip bounce + sway
    if (hips) {
      const t = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, dur];
      tracks.push(posTrack(hips, t, [
        [0, 0, 0], [0.008, 0.01, 0], [-0.008, 0, 0],
        [0.008, 0.01, 0], [-0.008, 0, 0], [0.008, 0.01, 0],
        [-0.008, 0, 0], [0.008, 0.01, 0], [0, 0, 0],
      ]));
      tracks.push(quatTrack(hips, t, [
        [0, 0, 0], [0, 0, 0.03], [0, 0, -0.03],
        [0, 0, 0.03], [0, 0, -0.03], [0, 0, 0.03],
        [0, 0, -0.03], [0, 0, 0.03], [0, 0, 0],
      ]));
    }

    // Spine sway
    if (spine) {
      tracks.push(quatTrack(spine, [0, 1.0, 2.0, 3.0, dur], [
        [0, 0, 0.02], [0, 0, -0.03], [0, 0, 0.03],
        [0, 0, -0.03], [0, 0, 0.02],
      ]));
    }

    // Head bop
    if (head) {
      const t = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, dur];
      tracks.push(quatTrack(head, t, [
        [0, 0, 0.04], [-0.04, 0, -0.04], [0, 0, 0.04],
        [-0.04, 0, -0.04], [0, 0, 0.04], [-0.04, 0, -0.04],
        [0, 0, 0.04], [-0.04, 0, -0.04], [0, 0, 0.04],
      ]));
    }

    // Arms alternating from rest (absolute)
    if (lArm) {
      tracks.push(quatTrack(lArm, [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, dur], [
        addEuler(L_UP, 0, 0, -0.85), [-0.2, 0, 1.0], addEuler(L_UP, 0, 0, -0.85),
        [-0.2, 0, 1.0], addEuler(L_UP, 0, 0, -0.85), [-0.2, 0, 1.0],
        addEuler(L_UP, 0, 0, -0.85), [-0.2, 0, 1.0], addEuler(L_UP, 0, 0, -0.85),
      ]));
    }
    if (rArm) {
      tracks.push(quatTrack(rArm, [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, dur], [
        [-0.2, 0, -1.0], addEuler(R_UP, 0, 0, 0.85), [-0.2, 0, -1.0],
        addEuler(R_UP, 0, 0, 0.85), [-0.2, 0, -1.0], addEuler(R_UP, 0, 0, 0.85),
        [-0.2, 0, -1.0], addEuler(R_UP, 0, 0, 0.85), [-0.2, 0, -1.0],
      ]));
    }

    // Forearms bent (absolute)
    if (lForearm) {
      tracks.push(quatTrack(lForearm, [0, dur], [
        addEuler(L_LO, -0.6, 0, 0), addEuler(L_LO, -0.6, 0, 0),
      ]));
    }
    if (rForearm) {
      tracks.push(quatTrack(rForearm, [0, dur], [
        addEuler(R_LO, -0.6, 0, 0), addEuler(R_LO, -0.6, 0, 0),
      ]));
    }

    return tracks.length > 0 ? new THREE.AnimationClip('dance_happy', dur, tracks) : null;
  },

  dance_hiphop: (vrm) => {
    // Reuse happy dance with more aggressive values
    const clip = PROCEDURAL_CLIPS.dance_happy(vrm);
    if (clip) clip.name = 'dance_hiphop';
    return clip;
  },

  /* ═══ Special ═══ */

  sleeping: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const dur = 6.0;
    const head = getBone(vrm, 'head');
    const spine = getBone(vrm, 'spine');
    const chest = getBone(vrm, 'chest');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');

    // Head drooping slowly
    if (head) {
      tracks.push(quatTrack(head, [0, 2, 4, dur], [
        [0.15, -0.05, 0], [0.18, 0.03, 0.02], [0.15, -0.03, -0.02], [0.15, -0.05, 0],
      ]));
    }

    // Spine very slow breathing
    if (spine) {
      tracks.push(quatTrack(spine, [0, 3, dur], [
        [0.08, 0, 0], [0.09, 0, 0], [0.08, 0, 0],
      ]));
    }

    // Chest slow rise/fall
    if (chest) {
      tracks.push(quatTrack(chest, [0, 3, dur], [
        [0.04, 0, 0], [0.06, 0, 0], [0.04, 0, 0],
      ]));
    }
    // Arms at rest (absolute)
    if (lArm) tracks.push(quatTrack(lArm, [0, dur], [L_UP, L_UP]));
    if (rArm) tracks.push(quatTrack(rArm, [0, dur], [R_UP, R_UP]));

    return tracks.length > 0 ? new THREE.AnimationClip('sleeping', dur, tracks) : null;
  },

  sitting: (vrm) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const dur = 4.0;
    const head = getBone(vrm, 'head');
    const spine = getBone(vrm, 'spine');
    const hips = getBone(vrm, 'hips');
    const lArm = getBone(vrm, 'leftUpperArm');
    const rArm = getBone(vrm, 'rightUpperArm');

    if (hips) {
      tracks.push(posTrack(hips, [0, dur], [
        [0, -0.15, 0.02], [0, -0.15, 0.02],
      ]));
    }

    if (spine) {
      tracks.push(quatTrack(spine, [0, 2, dur], [
        [-0.05, 0, 0], [-0.04, 0, 0], [-0.05, 0, 0],
      ]));
    }

    if (head) {
      tracks.push(quatTrack(head, [0, 1.5, 3.0, dur], [
        [0.02, 0.02, 0], [0, -0.02, 0], [0.02, 0.01, 0], [0.02, 0.02, 0],
      ]));
    }
    // Arms at rest (absolute)
    if (lArm) tracks.push(quatTrack(lArm, [0, dur], [L_UP, L_UP]));
    if (rArm) tracks.push(quatTrack(rArm, [0, dur], [R_UP, R_UP]));

    return tracks.length > 0 ? new THREE.AnimationClip('sitting', dur, tracks) : null;
  },
};

/** Get list of all procedural motion IDs */
export function getProceduralMotionIds(): string[] {
  return Object.keys(PROCEDURAL_CLIPS);
}
