/**
 * Mixamo FBX → VRM Animation Retargeting
 * Based on pixiv/three-vrm official example
 * Maps Mixamo skeleton bone names to VRM humanoid bone names
 * and converts rotation/position keyframe tracks accordingly.
 *
 * Arm Penetration Fix:
 * Mixamo animations are authored for T-pose (arms out). When we apply a
 * rest-pose with arms down (Z ≈ ±1.15 rad), the animation's arm rotations
 * conflict because they assume T-pose as zero. To fix this, we compose
 * our rest-pose rotation INTO the retargeted keyframes for upper-arm bones.
 * This ensures the animation's "arms at sides" maps to our model's "arms
 * at sides" rather than fighting the rest-pose.
 */
import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/* ───── Mixamo → VRM Bone Name Mapping ───── */

export const MIXAMO_VRM_RIG_MAP: Record<string, string> = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',
  // Left arm
  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  // Left fingers
  mixamorigLeftHandThumb1: 'leftThumbMetacarpal',
  mixamorigLeftHandThumb2: 'leftThumbProximal',
  mixamorigLeftHandThumb3: 'leftThumbDistal',
  mixamorigLeftHandIndex1: 'leftIndexProximal',
  mixamorigLeftHandIndex2: 'leftIndexIntermediate',
  mixamorigLeftHandIndex3: 'leftIndexDistal',
  mixamorigLeftHandMiddle1: 'leftMiddleProximal',
  mixamorigLeftHandMiddle2: 'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3: 'leftMiddleDistal',
  mixamorigLeftHandRing1: 'leftRingProximal',
  mixamorigLeftHandRing2: 'leftRingIntermediate',
  mixamorigLeftHandRing3: 'leftRingDistal',
  mixamorigLeftHandPinky1: 'leftLittleProximal',
  mixamorigLeftHandPinky2: 'leftLittleIntermediate',
  mixamorigLeftHandPinky3: 'leftLittleDistal',
  // Right arm
  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  // Right fingers
  mixamorigRightHandThumb1: 'rightThumbMetacarpal',
  mixamorigRightHandThumb2: 'rightThumbProximal',
  mixamorigRightHandThumb3: 'rightThumbDistal',
  mixamorigRightHandIndex1: 'rightIndexProximal',
  mixamorigRightHandIndex2: 'rightIndexIntermediate',
  mixamorigRightHandIndex3: 'rightIndexDistal',
  mixamorigRightHandMiddle1: 'rightMiddleProximal',
  mixamorigRightHandMiddle2: 'rightMiddleIntermediate',
  mixamorigRightHandMiddle3: 'rightMiddleDistal',
  mixamorigRightHandRing1: 'rightRingProximal',
  mixamorigRightHandRing2: 'rightRingIntermediate',
  mixamorigRightHandRing3: 'rightRingDistal',
  mixamorigRightHandPinky1: 'rightLittleProximal',
  mixamorigRightHandPinky2: 'rightLittleIntermediate',
  mixamorigRightHandPinky3: 'rightLittleDistal',
  // Left leg
  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  // Right leg
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes',
};

/**
 * Load a Mixamo FBX animation file and retarget it onto a VRM model.
 * Returns a THREE.AnimationClip that can be played on the VRM's mixer.
 */
export async function loadMixamoAnimation(
  url: string,
  vrm: VRM,
  clipName?: string,
  armSpreadBiasDeg: number = 20,
): Promise<THREE.AnimationClip> {
  const loader = new FBXLoader();
  const asset = await loader.loadAsync(url);

  // Mixamo FBX clips are usually named "mixamo.com"
  const sourceClip =
    asset.animations.find((c) => c.name === 'mixamo.com') ??
    asset.animations[0];

  if (!sourceClip) {
    throw new Error(`No animation clip found in FBX: ${url}`);
  }

  const tracks: THREE.KeyframeTrack[] = [];

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();

  // Pre-compute arm-spread bias quaternions.
  // Mixamo animations are authored for T-pose (arms out). VRM anime models
  // often have wider torsos, causing arm–body penetration. This bias pushes
  // upper-arm rotations outward by the configured amount.
  //
  // In VRM normalized bone space:
  //   leftUpperArm:  NEGATIVE Z = outward (away from body)
  //   rightUpperArm: POSITIVE Z = outward (away from body)
  //
  // armSpreadBiasDeg is in degrees; positive = outward, negative = inward.
  const ARM_SPREAD_BIAS_RAD = (armSpreadBiasDeg * Math.PI) / 180;
  const armBiasQuats: Record<string, THREE.Quaternion> = {};
  if (Math.abs(ARM_SPREAD_BIAS_RAD) > 0.001) {
    const e = new THREE.Euler();
    // Left upper arm: negative Z = push outward
    e.set(0, 0, -ARM_SPREAD_BIAS_RAD);
    armBiasQuats['leftUpperArm'] = new THREE.Quaternion().setFromEuler(e);
    // Right upper arm: positive Z = push outward
    e.set(0, 0, ARM_SPREAD_BIAS_RAD);
    armBiasQuats['rightUpperArm'] = new THREE.Quaternion().setFromEuler(e);
  }

  // Hip height ratio for position scaling
  const motionHipsNode = asset.getObjectByName('mixamorigHips');
  const motionHipsHeight = motionHipsNode ? motionHipsNode.position.y : 1;
  const vrmHipsY = vrm.humanoid?.getNormalizedBoneNode('hips')
    ? vrm.humanoid.normalizedRestPose.hips?.position?.[1] ?? 1
    : 1;
  const hipsPositionScale = vrmHipsY / motionHipsHeight;

  const isVRM0 = (vrm.meta as { metaVersion?: string })?.metaVersion === '0';

  for (const track of sourceClip.tracks) {
    const [mixamoRigName, propertyName] = track.name.split('.');
    const vrmBoneName = MIXAMO_VRM_RIG_MAP[mixamoRigName];

    if (!vrmBoneName) continue;

    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName as VRMHumanBoneName);
    if (!vrmNode) continue;

    const vrmNodeName = vrmNode.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (!mixamoRigNode) continue;

    // Get rest-pose rotations for retargeting
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    if (mixamoRigNode.parent) {
      mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
    } else {
      parentRestWorldRotation.identity();
    }

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // Clone values so we don't mutate the original
      const values = new Float32Array(track.values);

      for (let i = 0; i < values.length; i += 4) {
        _quatA.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
        _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);

        // VRM0 axis flip
        if (isVRM0) {
          _quatA.set(-_quatA.x, _quatA.y, -_quatA.z, _quatA.w);
        }

        // Apply arm-spread bias for upper arm bones to prevent body penetration.
        // This adds a small outward rotation to each frame so the arms
        // maintain clearance from the torso.
        const biasQ = armBiasQuats[vrmBoneName];
        if (biasQ) {
          _quatA.premultiply(biasQ);
        }

        values[i] = _quatA.x;
        values[i + 1] = _quatA.y;
        values[i + 2] = _quatA.z;
        values[i + 3] = _quatA.w;
      }

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${vrmNodeName}.${propertyName}`,
          Array.from(track.times),
          Array.from(values),
        ),
      );
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      // Only hips typically have position tracks
      const values = new Float32Array(track.values);
      for (let i = 0; i < values.length; i += 3) {
        if (isVRM0) {
          values[i] = -values[i] * hipsPositionScale;
          values[i + 1] = values[i + 1] * hipsPositionScale;
          values[i + 2] = -values[i + 2] * hipsPositionScale;
        } else {
          values[i] = values[i] * hipsPositionScale;
          values[i + 1] = values[i + 1] * hipsPositionScale;
          values[i + 2] = values[i + 2] * hipsPositionScale;
        }
      }

      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${vrmNodeName}.${propertyName}`,
          Array.from(track.times),
          Array.from(values),
        ),
      );
    }
  }

  const name = clipName ?? sourceClip.name ?? 'mixamoAnimation';
  return new THREE.AnimationClip(name, sourceClip.duration, tracks);
}
