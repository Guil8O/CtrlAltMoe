/**
 * Animation Manager for VRM models
 *
 * Loads motion metadata from /motions/motion-tags.json,
 * handles smooth crossfading, alt-group rotation (no repeat ≥3),
 * motion history tracking, emotion-based hobby mode,
 * and per-character hobby preferences from conversation keywords.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMLookAtQuaternionProxy,
} from '@pixiv/three-vrm-animation';
import { loadMixamoAnimation } from './mixamo-retarget';
import { createProceduralClip, REST_POSE } from './procedural-animations';

/* ───── Motion Types ───── */

export type MotionCategory = 'idle' | 'emotion' | 'gesture' | 'dance' | 'special' | 'exercise';

export interface MotionDef {
  id: string;
  label: string;
  category: MotionCategory;
  playMode: 'loop' | 'once';
  url: string;
  format: 'vrma' | 'fbx';
  fadeDuration: number;
  moodTags: string[];
  altGroup: string;
  keywords: string[];
}

/* ───── Motion Tag JSON structure ───── */
interface MotionTagEntry {
  id: string;
  file: string;
  format: 'vrma' | 'fbx';
  category: MotionCategory;
  playMode: 'loop' | 'once';
  fadeDuration?: number;
  moodTags?: string[];
  altGroup?: string;
  keywords?: string[];
}

interface MotionTagsFile {
  version: number;
  motions: MotionTagEntry[];
}

/* ───── Dynamic Motion Library ───── */

let _motionLibrary: MotionDef[] = [];
let _libraryLoaded = false;
let _libraryPromise: Promise<void> | null = null;

/** Load motion library from /motions/motion-tags.json */
async function loadMotionLibrary(): Promise<void> {
  if (_libraryLoaded) return;
  if (_libraryPromise) return _libraryPromise;

  _libraryPromise = (async () => {
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const res = await fetch(`${basePath}/motions/motion-tags.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MotionTagsFile = await res.json();

      _motionLibrary = data.motions.map(m => ({
        id: m.id,
        label: m.id.replace(/_/g, ' '),
        category: m.category,
        playMode: m.playMode,
        url: `${basePath}/motions/${m.file}`,
        format: m.format,
        fadeDuration: m.fadeDuration ?? 0.5,
        moodTags: m.moodTags ?? ['neutral'],
        altGroup: m.altGroup ?? m.id,
        keywords: m.keywords ?? [],
      }));
      _libraryLoaded = true;
      console.info(`[AnimationManager] Loaded ${_motionLibrary.length} motions from motion-tags.json`);
    } catch (err) {
      console.warn('[AnimationManager] Failed to load motion-tags.json, library is empty:', err);
      _motionLibrary = [];
      _libraryLoaded = true;
    }
  })();

  return _libraryPromise;
}

/** Get the current motion library (may be empty until loaded) */
export function getMotionLibrary(): MotionDef[] {
  return [..._motionLibrary];
}

/** Ensure the library is loaded, then return it */
export async function ensureMotionLibrary(): Promise<MotionDef[]> {
  await loadMotionLibrary();
  return getMotionLibrary();
}

/* ───── Motion History Tracker ───── */

const MAX_HISTORY = 10;
const MAX_SAME_MOTION_USES = 2;

class MotionHistory {
  private history: string[] = [];
  private altGroupUsage = new Map<string, string[]>();

  record(motionId: string, altGroup: string): void {
    this.history.push(motionId);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    const groupList = this.altGroupUsage.get(altGroup) ?? [];
    groupList.push(motionId);
    if (groupList.length > 10) groupList.shift();
    this.altGroupUsage.set(altGroup, groupList);
  }

  recentCount(motionId: string): number {
    return this.history.filter(id => id === motionId).length;
  }

  getRecent(n = 5): string[] {
    return this.history.slice(-n);
  }

  /**
   * Pick from pool with rotation:
   * - Block motions used ≥ MAX_SAME_MOTION_USES in recent history
   * - Weighted random (less recently used = higher weight)
   */
  pickWithRotation(candidates: MotionDef[], preferAltGroup?: string): MotionDef | null {
    if (candidates.length === 0) return null;

    const eligible = candidates.filter(m => this.recentCount(m.id) < MAX_SAME_MOTION_USES);
    const pool = eligible.length > 0 ? eligible : candidates;

    const weights = pool.map(m => {
      const count = this.recentCount(m.id);
      let w = Math.max(1, MAX_SAME_MOTION_USES + 1 - count);
      if (preferAltGroup && m.altGroup === preferAltGroup) w *= 1.5;
      return w;
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /** Get next alt in a group (round-robin, skip recently used) */
  getNextAlt(altGroup: string): string | null {
    const groupMotions = _motionLibrary.filter(m => m.altGroup === altGroup);
    if (groupMotions.length <= 1) return groupMotions[0]?.id ?? null;

    const used = this.altGroupUsage.get(altGroup) ?? [];
    const lastUsed = used[used.length - 1];

    const candidates = groupMotions.filter(
      m => m.id !== lastUsed && this.recentCount(m.id) < MAX_SAME_MOTION_USES,
    );

    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)].id;
    }
    const any = groupMotions.filter(m => m.id !== lastUsed);
    return any.length > 0 ? any[Math.floor(Math.random() * any.length)].id : groupMotions[0].id;
  }

  clear(): void {
    this.history = [];
    this.altGroupUsage.clear();
  }
}

/* ───── Animation Manager ───── */

export class AnimationManager {
  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private gltfLoader: GLTFLoader;

  private clipCache = new Map<string, THREE.AnimationClip>();

  private activeLoopAction: THREE.AnimationAction | null = null;
  private activeLoopMotionId: string | null = null;

  private activeShotAction: THREE.AnimationAction | null = null;
  private fallbackIdleAction: THREE.AnimationAction | null = null;
  private defaultFade = 0.5;

  /* ── Motion history ── */
  private motionHistory = new MotionHistory();

  /* ── Hobby / idle timer ── */
  private idleSeconds = 0;
  private hobbyIdleThreshold = 600; // 10 minutes fixed
  private hobbyPlaying = false;

  /* ── Character hobby preferences ── */
  private hobbyKeywords: string[] = [];
  private currentEmotion: string = 'neutral';

  /* ── Arm spread bias (degrees, passed to mixamo retarget) ── */
  private armSpreadBiasDeg: number = 20;

  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  }

  /** Bind to a VRM model. Creates mixer. */
  async bind(vrm: VRM): Promise<THREE.AnimationMixer> {
    this.dispose();
    await loadMotionLibrary();

    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.clipCache.clear();
    this.motionHistory.clear();

    if (vrm.lookAt) {
      const existingProxy = vrm.scene.getObjectByName('VRMLookAtQuaternionProxy');
      if (!existingProxy) {
        const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
        proxy.name = 'VRMLookAtQuaternionProxy';
        vrm.scene.add(proxy);
      }
    }

    this.mixer.addEventListener('finished', this.onAnimationFinished);
    this.createFallbackIdle();

    return this.mixer;
  }

  /** Set hobby keywords from character conversation for preference weighting */
  setHobbyKeywords(keywords: string[]): void {
    this.hobbyKeywords = keywords;
  }

  /** Set current emotion for hobby weighting */
  setCurrentEmotion(emotion: string): void {
    this.currentEmotion = emotion;
  }

  /** Set arm spread bias in degrees (positive = outward, negative = inward) */
  setArmSpreadBias(deg: number): void {
    this.armSpreadBiasDeg = deg;
  }

  /** Load a motion by ID */
  async loadMotion(motionId: string): Promise<THREE.AnimationClip | null> {
    if (!this.vrm || !this.mixer) return null;

    if (this.clipCache.has(motionId)) {
      return this.clipCache.get(motionId)!;
    }

    const def = _motionLibrary.find(m => m.id === motionId);

    if (def) {
      try {
        let clip: THREE.AnimationClip;
        if (def.format === 'vrma') {
          clip = await this.loadVRMA(def.url, motionId);
        } else {
          clip = await loadMixamoAnimation(def.url, this.vrm, motionId, this.armSpreadBiasDeg);
        }
        this.clipCache.set(motionId, clip);
        return clip;
      } catch {
        console.info(`[AnimationManager] File not available for "${motionId}", trying procedural fallback`);
      }
    }

    const proceduralClip = createProceduralClip(this.vrm, motionId);
    if (proceduralClip) {
      this.clipCache.set(motionId, proceduralClip);
      return proceduralClip;
    }

    console.warn(`[AnimationManager] No animation available for: ${motionId}`);
    return null;
  }

  /** Play a motion by ID with crossfading */
  async playMotion(motionId: string): Promise<void> {
    if (!this.mixer) return;

    const def = _motionLibrary.find(m => m.id === motionId);
    const fadeDuration = def?.fadeDuration ?? this.defaultFade;
    const playMode = def?.playMode ?? 'once';

    const clip = await this.loadMotion(motionId);
    if (!clip) {
      console.warn(`[AnimationManager] No animation available for: ${motionId}`);
      return;
    }

    if (def) this.motionHistory.record(motionId, def.altGroup);

    if (playMode === 'loop') {
      this.playLoop(clip, motionId, fadeDuration);
    } else {
      this.playOneShot(clip, fadeDuration);
    }
  }

  async loadCustomAnimation(url: string, format: 'vrma' | 'fbx', name?: string): Promise<THREE.AnimationClip | null> {
    if (!this.vrm) return null;
    try {
      if (format === 'vrma') return await this.loadVRMA(url, name ?? 'custom');
      return await loadMixamoAnimation(url, this.vrm, name ?? 'custom', this.armSpreadBiasDeg);
    } catch (err) {
      console.warn(`[AnimationManager] Failed to load custom animation: ${url}`, err);
      return null;
    }
  }

  playClipOnce(clip: THREE.AnimationClip, fadeDuration = 0.3) { this.playOneShot(clip, fadeDuration); }
  playClipLoop(clip: THREE.AnimationClip, fadeDuration = 0.5) { this.playLoop(clip, clip.name, fadeDuration); }

  resetToIdle() {
    if (!this.mixer) return;
    if (this.activeLoopAction) this.activeLoopAction.fadeOut(0.5);
    if (this.activeShotAction) this.activeShotAction.fadeOut(0.3);
    this.activeLoopAction = null;
    this.activeLoopMotionId = null;
    this.activeShotAction = null;

    if (this.fallbackIdleAction) {
      this.fallbackIdleAction.reset().fadeIn(0.5).play();
      this.activeLoopAction = this.fallbackIdleAction;
      this.activeLoopMotionId = '__fallback_idle';
    }
  }

  async playMotionWithFallback(motionId: string): Promise<boolean> {
    if (!this.mixer) return false;
    try {
      await this.playMotion(motionId);
      return true;
    } catch {
      console.info(`[AnimationManager] Motion "${motionId}" unavailable, skipping`);
      return false;
    }
  }

  /**
   * Pick the best idle for current emotion using alt rotation & history.
   */
  async playEmotionIdle(emotion: string): Promise<void> {
    const moodMap: Record<string, string[]> = {
      happy: ['happy'],
      sad: ['sad'],
      angry: ['angry'],
      surprised: ['neutral'],
      neutral: ['neutral'],
    };
    const tags = moodMap[emotion] ?? ['neutral'];

    const candidates = _motionLibrary.filter(
      m => m.category === 'idle' && m.moodTags.some(t => tags.includes(t)),
    );
    const pool = candidates.length > 0
      ? candidates
      : _motionLibrary.filter(m => m.category === 'idle');

    if (pool.length === 0) { this.resetToIdle(); return; }

    const pick = this.motionHistory.pickWithRotation(pool);
    if (!pick || pick.id === this.activeLoopMotionId) {
      const currentDef = _motionLibrary.find(m => m.id === this.activeLoopMotionId);
      if (currentDef) {
        const altId = this.motionHistory.getNextAlt(currentDef.altGroup);
        if (altId && altId !== this.activeLoopMotionId) {
          const success = await this.playMotionWithFallback(altId);
          if (success) return;
        }
      }
      return;
    }

    if (this.activeLoopMotionId === pick.id) return;

    const success = await this.playMotionWithFallback(pick.id);
    if (!success) this.resetToIdle();
  }

  getActiveLoopMotionId(): string | null { return this.activeLoopMotionId; }
  getMixer(): THREE.AnimationMixer | null { return this.mixer; }
  getMotionsByCategory(category: MotionCategory): MotionDef[] { return _motionLibrary.filter(m => m.category === category); }

  findMotionsByKeyword(keyword: string): MotionDef[] {
    const kw = keyword.toLowerCase();
    return _motionLibrary.filter(m =>
      m.keywords.some(k => k.includes(kw) || kw.includes(k)),
    );
  }

  getMotionHistory(): string[] { return this.motionHistory.getRecent(MAX_HISTORY); }

  update(delta: number) {
    this.mixer?.update(delta);

    if (!this.hobbyPlaying && !this.activeShotAction) {
      const isIdle = this.activeLoopMotionId === '__fallback_idle' ||
        _motionLibrary.some(m => m.id === this.activeLoopMotionId && m.category === 'idle');

      if (isIdle) {
        this.idleSeconds += delta;
        if (this.idleSeconds >= this.hobbyIdleThreshold) {
          this.triggerHobbyMotion();
          this.idleSeconds = 0;
        }
      }
    }
  }

  resetIdleTimer(): void {
    this.idleSeconds = 0;
    this.hobbyPlaying = false;
  }

  /**
   * Pick a hobby motion weighted by emotion + character hobby keywords.
   * happy/neutral → dance 70% exercise 30%
   * sad/bored     → exercise 60% dance 40%
   * angry         → exercise 90% dance 10%
   * Character hobby keyword match → 2× weight boost.
   */
  private async triggerHobbyMotion(): Promise<void> {
    const danceMotions = _motionLibrary.filter(m => m.category === 'dance');
    const exerciseMotions = _motionLibrary.filter(m => m.category === 'exercise');
    const allHobbies = [...danceMotions, ...exerciseMotions];
    if (allHobbies.length === 0) return;

    let danceWeight = 0.5, exerciseWeight = 0.5;
    switch (this.currentEmotion) {
      case 'happy': danceWeight = 0.7; exerciseWeight = 0.3; break;
      case 'sad': danceWeight = 0.4; exerciseWeight = 0.6; break;
      case 'angry': danceWeight = 0.1; exerciseWeight = 0.9; break;
    }

    const weighted = allHobbies.map(m => {
      let w = m.category === 'dance' ? danceWeight : exerciseWeight;
      const recentCount = this.motionHistory.recentCount(m.id);
      if (recentCount >= MAX_SAME_MOTION_USES) w *= 0.1;
      else w *= Math.max(0.3, 1 - recentCount * 0.3);
      if (this.hobbyKeywords.length > 0) {
        const hasMatch = m.keywords.some(kw =>
          this.hobbyKeywords.some(hk => kw.includes(hk) || hk.includes(kw)),
        );
        if (hasMatch) w *= 2;
      }
      return { motion: m, weight: w };
    });

    const totalWeight = weighted.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * totalWeight;
    let pick = weighted[0].motion;
    for (const entry of weighted) {
      r -= entry.weight;
      if (r <= 0) { pick = entry.motion; break; }
    }

    this.hobbyPlaying = true;
    const success = await this.playMotionWithFallback(pick.id);
    if (!success) { this.hobbyPlaying = false; return; }

    if (pick.playMode === 'loop') {
      const duration = 20_000 + Math.random() * 20_000;
      setTimeout(() => {
        if (this.hobbyPlaying) { this.hobbyPlaying = false; this.resetToIdle(); }
      }, duration);
    } else {
      const checkDone = () => {
        if (!this.activeShotAction) this.hobbyPlaying = false;
        else setTimeout(checkDone, 500);
      };
      setTimeout(checkDone, 1000);
    }
  }

  dispose() {
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onAnimationFinished);
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.mixer = null;
    this.vrm = null;
    this.clipCache.clear();
    this.activeLoopAction = null;
    this.activeLoopMotionId = null;
    this.activeShotAction = null;
    this.fallbackIdleAction = null;
    this.motionHistory.clear();
  }

  /* ───── Private ───── */

  private async loadVRMA(url: string, name: string): Promise<THREE.AnimationClip> {
    if (!this.vrm) throw new Error('No VRM bound');
    const gltf = await this.gltfLoader.loadAsync(url);
    const vrmAnimations = gltf.userData.vrmAnimations;
    if (!vrmAnimations || vrmAnimations.length === 0) throw new Error(`No VRM animations found in: ${url}`);
    const clip = createVRMAnimationClip(vrmAnimations[0], this.vrm);
    clip.name = name;
    return clip;
  }

  private playLoop(clip: THREE.AnimationClip, motionId: string, fadeDuration: number) {
    if (!this.mixer) return;
    if (this.activeLoopMotionId === motionId && this.activeLoopAction?.isRunning()) return;
    const newAction = this.mixer.clipAction(clip);
    newAction.setLoop(THREE.LoopRepeat, Infinity);
    newAction.clampWhenFinished = false;
    if (this.activeLoopAction && this.activeLoopAction !== newAction) {
      newAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
      this.activeLoopAction.crossFadeTo(newAction, fadeDuration, true);
      newAction.play();
    } else {
      newAction.reset().fadeIn(fadeDuration).play();
    }
    this.activeLoopAction = newAction;
    this.activeLoopMotionId = motionId;
  }

  private playOneShot(clip: THREE.AnimationClip, fadeDuration: number) {
    if (!this.mixer) return;
    if (this.activeShotAction) this.activeShotAction.fadeOut(fadeDuration * 0.5);
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (this.activeLoopAction) this.activeLoopAction.setEffectiveWeight(0.2);
    action.fadeIn(fadeDuration).play();
    this.activeShotAction = action;
  }

  private onAnimationFinished = (e: { action: THREE.AnimationAction }) => {
    const action = e.action;
    if (action === this.activeShotAction) {
      action.fadeOut(0.4);
      this.activeShotAction = null;
      if (this.activeLoopAction) this.activeLoopAction.setEffectiveWeight(1);
    }
  };

  private createFallbackIdle() {
    if (!this.vrm || !this.mixer) return;
    const hips = this.vrm.humanoid?.getNormalizedBoneNode('hips');
    const spine = this.vrm.humanoid?.getNormalizedBoneNode('spine');
    const chest = this.vrm.humanoid?.getNormalizedBoneNode('chest');
    const head = this.vrm.humanoid?.getNormalizedBoneNode('head');
    const leftArm = this.vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const rightArm = this.vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');

    const tracks: THREE.KeyframeTrack[] = [];
    const duration = 4.0;
    const times4 = [0, 1.5, 3, duration];
    const times3 = [0, 2, duration];

    if (spine) {
      const y = spine.position.y;
      tracks.push(new THREE.VectorKeyframeTrack(`${spine.name}.position`, times4, [
        spine.position.x, y, spine.position.z, spine.position.x, y + 0.003, spine.position.z,
        spine.position.x, y + 0.001, spine.position.z, spine.position.x, y, spine.position.z,
      ]));
    }
    if (chest) {
      const q = new THREE.Quaternion(); const e = new THREE.Euler(); const vals: number[] = [];
      for (const pitch of [0, 0.012, 0.004, 0]) { e.set(pitch, 0, 0); q.setFromEuler(e); vals.push(q.x, q.y, q.z, q.w); }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${chest.name}.quaternion`, times4, vals));
    }
    if (head) {
      const q = new THREE.Quaternion(); const e = new THREE.Euler();
      const headTimes = [0, 1.5, 2.5, 3.5, duration]; const vals: number[] = [];
      for (const [pitch, yaw] of [[0.02, 0.01], [-0.01, -0.015], [0.01, 0.02], [-0.015, -0.01], [0.02, 0.01]] as [number, number][]) {
        e.set(pitch, yaw, 0); q.setFromEuler(e); vals.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${head.name}.quaternion`, headTimes, vals));
    }
    if (hips) {
      const y = hips.position.y; const x = hips.position.x;
      tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times3, [
        x, y, hips.position.z, x + 0.002, y, hips.position.z, x, y, hips.position.z,
      ]));
    }
    if (leftArm) {
      const q = new THREE.Quaternion(); const e = new THREE.Euler(); const vals: number[] = [];
      for (const dz of [0, 0.015, -0.01, 0]) { e.set(REST_POSE.leftUpperArm[0], REST_POSE.leftUpperArm[1], REST_POSE.leftUpperArm[2] + dz); q.setFromEuler(e); vals.push(q.x, q.y, q.z, q.w); }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${leftArm.name}.quaternion`, times4, vals));
    }
    if (rightArm) {
      const q = new THREE.Quaternion(); const e = new THREE.Euler(); const vals: number[] = [];
      for (const dz of [0, -0.015, 0.01, 0]) { e.set(REST_POSE.rightUpperArm[0], REST_POSE.rightUpperArm[1], REST_POSE.rightUpperArm[2] + dz); q.setFromEuler(e); vals.push(q.x, q.y, q.z, q.w); }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${rightArm.name}.quaternion`, times4, vals));
    }

    if (tracks.length === 0) return;
    const clip = new THREE.AnimationClip('fallback_idle', duration, tracks);
    this.fallbackIdleAction = this.mixer.clipAction(clip);
    this.fallbackIdleAction.setLoop(THREE.LoopRepeat, Infinity);
    this.fallbackIdleAction.play();
    this.activeLoopAction = this.fallbackIdleAction;
    this.activeLoopMotionId = '__fallback_idle';
  }
}
