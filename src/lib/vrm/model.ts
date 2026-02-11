/**
 * VRM Model — expression controller (emote + blink) + motion integration.
 *
 * Blink uses a smooth ease-in-out curve (not a snap) and natural random intervals.
 * Expression transitions use cubic smoothing for organic face movement.
 * Body animations are delegated to AnimationManager.
 */
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { AnimationManager } from './animation-manager';
import { applyRestPose } from './procedural-animations';
import type { VrmSettings } from '@/lib/db/schema';

/* ───── Emote Controller ───── */

export type EmotionName = 'neutral' | 'happy' | 'angry' | 'sad' | 'surprised';
export type GestureName =
  | 'none' | 'nod' | 'shake' | 'thinking'
  | 'clap' | 'cheer' | 'shrug' | 'point'
  | 'surprise' | 'wave' | 'bow';

const EXPRESSION_NAMES: EmotionName[] = ['happy', 'angry', 'sad', 'surprised'];

/**
 * Manages VRM facial expressions with smooth blending and natural auto-blink.
 *
 * Key improvements over the original:
 * - Blink uses a sinusoidal ease curve (≈150ms close + 120ms open, total ~270ms)
 * - Expression lerp uses exponential smoothing with lower speed for softer transitions
 * - Random micro-expressions between blinks for liveliness
 */
export class EmoteController {
  private vrm: VRM;
  private currentEmotion: EmotionName = 'neutral';

  /* Expression blending */
  private targetEmotions: Record<string, number> = {};
  private currentEmotions: Record<string, number> = {};
  /** Base lerp speed (units/sec). Lower = smoother. */
  private lerpSpeed = 2.0;

  /* Blink system */
  private blinkPhase: 'waiting' | 'closing' | 'closed' | 'opening' = 'waiting';
  private blinkTimer = 0; // countdown to next blink
  private blinkT = 0;     // current phase progress (0→1)
  /** Duration of the closing phase (seconds) */
  private blinkCloseTime = 0.08;
  /** Duration of the closed (hold) phase */
  private blinkHoldTime = 0.04;
  /** Duration of the opening phase */
  private blinkOpenTime = 0.10;

  /* Micro-expression */
  private microTimer = 0;
  private microTarget: Record<string, number> = {};

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.blinkTimer = this.nextBlinkInterval();
  }

  /** Set target emotion weights. Transitions happen smoothly over time. */
  setEmotion(emotions: { happy?: number; angry?: number; sad?: number; surprised?: number }) {
    this.targetEmotions = {
      happy: Math.min(1, Math.max(0, emotions.happy ?? 0)),
      angry: Math.min(1, Math.max(0, emotions.angry ?? 0)),
      sad: Math.min(1, Math.max(0, emotions.sad ?? 0)),
      surprised: Math.min(1, Math.max(0, emotions.surprised ?? 0)),
    };

    // Determine dominant emotion label
    let maxVal = 0;
    let maxName: EmotionName = 'neutral';
    for (const [name, val] of Object.entries(this.targetEmotions)) {
      if (val > maxVal) {
        maxVal = val;
        maxName = name as EmotionName;
      }
    }
    this.currentEmotion = maxVal > 0.25 ? maxName : 'neutral';
  }

  getCurrentEmotion(): EmotionName {
    return this.currentEmotion;
  }

  update(delta: number) {
    const em = this.vrm.expressionManager;
    if (!em) return;

    // 1. Smooth expression blending
    this.updateExpressions(delta, em);

    // 2. Natural blink
    this.updateBlink(delta, em);

    // 3. Micro-expressions (subtle random twitches for liveliness)
    this.updateMicroExpressions(delta, em);
  }

  /* ── Expression blending ── */

  private updateExpressions(delta: number, em: { setValue: (name: string, value: number) => void }) {
    const t = 1 - Math.exp(-this.lerpSpeed * delta); // exponential smoothing

    for (const name of EXPRESSION_NAMES) {
      const target = (this.targetEmotions[name] ?? 0) + (this.microTarget[name] ?? 0);
      const current = this.currentEmotions[name] ?? 0;
      const next = current + (Math.min(1, target) - current) * t;
      this.currentEmotions[name] = next;
      em.setValue(name, next);
    }
  }

  /* ── Natural blink ── */

  private updateBlink(delta: number, em: { setValue: (name: string, value: number) => void }) {
    switch (this.blinkPhase) {
      case 'waiting':
        this.blinkTimer -= delta;
        if (this.blinkTimer <= 0) {
          this.blinkPhase = 'closing';
          this.blinkT = 0;
          // Vary timing slightly each blink for naturalness
          this.blinkCloseTime = 0.06 + Math.random() * 0.04; // 60-100ms
          this.blinkHoldTime = 0.02 + Math.random() * 0.04;  // 20-60ms
          this.blinkOpenTime = 0.08 + Math.random() * 0.06;  // 80-140ms
        }
        break;

      case 'closing':
        this.blinkT += delta / this.blinkCloseTime;
        if (this.blinkT >= 1) {
          this.blinkT = 0;
          this.blinkPhase = 'closed';
          em.setValue('blink', 1);
        } else {
          // Ease-in (accelerate shut)
          em.setValue('blink', this.easeInQuad(this.blinkT));
        }
        break;

      case 'closed':
        this.blinkT += delta / this.blinkHoldTime;
        if (this.blinkT >= 1) {
          this.blinkT = 0;
          this.blinkPhase = 'opening';
        }
        em.setValue('blink', 1);
        break;

      case 'opening':
        this.blinkT += delta / this.blinkOpenTime;
        if (this.blinkT >= 1) {
          em.setValue('blink', 0);
          this.blinkPhase = 'waiting';
          this.blinkTimer = this.nextBlinkInterval();

          // 15% chance of double-blink
          if (Math.random() < 0.15) {
            this.blinkTimer = 0.15 + Math.random() * 0.1;
          }
        } else {
          // Ease-out (decelerate open)
          em.setValue('blink', 1 - this.easeOutQuad(this.blinkT));
        }
        break;
    }
  }

  /* ── Micro-expressions ── */

  private updateMicroExpressions(delta: number, _em: { setValue: (name: string, value: number) => void }) {
    this.microTimer -= delta;
    if (this.microTimer <= 0) {
      this.microTimer = 3 + Math.random() * 5; // every 3-8 seconds

      // Subtle random twitch on a random expression
      const target = EXPRESSION_NAMES[Math.floor(Math.random() * EXPRESSION_NAMES.length)];
      this.microTarget = {};

      // Only add micro-expression if current emotion is low for that channel
      if ((this.targetEmotions[target] ?? 0) < 0.3) {
        this.microTarget[target] = 0.05 + Math.random() * 0.08; // very subtle: 0.05-0.13
        // Clear after a short while
        setTimeout(() => {
          this.microTarget = {};
        }, 800 + Math.random() * 1200);
      }
    }
  }

  /* ── Easing helpers ── */

  private easeInQuad(t: number): number {
    return t * t;
  }

  private easeOutQuad(t: number): number {
    return t * (2 - t);
  }

  private nextBlinkInterval(): number {
    // Natural blink interval: 2-6 seconds with occasional longer pauses
    const base = 2.5 + Math.random() * 3.5;
    // 10% chance of a longer pause (staring)
    return Math.random() < 0.1 ? base + 3 + Math.random() * 4 : base;
  }
}

/* ───── VRM Model ───── */

export class VRMModel {
  public vrm: VRM | null = null;
  public emoteController: EmoteController | null = null;
  public animationManager: AnimationManager;

  constructor() {
    this.animationManager = new AnimationManager();
  }

  async loadVRM(url: string, vrmSettings?: VrmSettings): Promise<VRM> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;
    vrm.scene.name = 'VRMRoot';

    VRMUtils.rotateVRM0(vrm);

    // Combine skeletons for better animation support
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);

    this.vrm = vrm;
    this.emoteController = new EmoteController(vrm);

    // Apply spring-bone settings if provided
    if (vrmSettings && vrm.springBoneManager) {
      for (const joint of vrm.springBoneManager.joints) {
        joint.settings.stiffness = (joint.settings.stiffness ?? 1) * vrmSettings.springBoneStiffness;
        joint.settings.gravityPower = (joint.settings.gravityPower ?? 1) * vrmSettings.springBoneGravity;
      }
    }

    // Set arms to natural rest pose (down) instead of T-pose
    applyRestPose(vrm, vrmSettings?.armRestAngle, vrmSettings?.armForwardPitch);

    // Configure arm spread bias for animation retargeting
    this.animationManager.setArmSpreadBias(vrmSettings?.armSpreadBias ?? 20);

    // Bind animation manager → creates mixer + fallback idle
    await this.animationManager.bind(vrm);

    // Load a real idle animation from the library to replace the procedural fallback.
    // Try neutral idle motions in order until one loads.
    const idleCandidates = ['Idle1', 'Idle2', 'Idle3', 'Idle4', 'Idle5'];
    let idleLoaded = false;
    for (const idleId of idleCandidates) {
      idleLoaded = await this.animationManager.playMotionWithFallback(idleId);
      if (idleLoaded) break;
    }
    // If none loaded, procedural fallback idle from bind() is already running.

    return vrm;
  }

  /**
   * Play a gesture/motion by name.
   * First tries the AnimationManager's FBX library; if unavailable, falls through.
   */
  async playGesture(gesture: GestureName): Promise<void> {
    if (!this.vrm || gesture === 'none') return;

    // Map old gesture names to motion library ids
    const gestureMotionMap: Record<string, string> = {
      nod: 'Nod1',
      shake: 'Shake_Head_No1',
      thinking: 'Think1',
      clap: 'Clapping',
      cheer: 'Cheering1',
      shrug: 'Shrugging',
      point: 'Pointing1',
      surprise: 'Surprised1',
      wave: 'Hi',
      bow: 'Bowing',
    };

    const motionId = gestureMotionMap[gesture];
    if (motionId) {
      await this.animationManager.playMotionWithFallback(motionId);
    }
  }

  /**
   * Play a motion by its library id (e.g. "dance_happy", "sleeping").
   */
  async playMotion(motionId: string): Promise<boolean> {
    return this.animationManager.playMotionWithFallback(motionId);
  }

  /**
   * Switch to the best idle animation for current emotion.
   */
  async setEmotionIdle(emotion: EmotionName): Promise<void> {
    await this.animationManager.playEmotionIdle(emotion);
  }

  /** Reset to default idle animation */
  resetToIdle(): void {
    this.animationManager.resetToIdle();
  }

  update(delta: number) {
    this.emoteController?.update(delta);
    this.animationManager.update(delta);
    this.vrm?.update(delta);
  }

  dispose() {
    this.animationManager.dispose();
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
    this.emoteController = null;
  }
}
