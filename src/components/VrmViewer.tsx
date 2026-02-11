'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { ensureMotionLibrary, type MotionCategory, type MotionDef } from '@/lib/vrm/animation-manager';
import type { HdriBgConfig } from '@/lib/vrm/viewer';
import { assetPath } from '@/lib/utils/asset-path';
import { Heart, Image as ImageIcon, Globe, X, RotateCcw, Trash2 } from 'lucide-react';

/* ───── Category Mapping ───── */

const CATEGORY_ICONS: Record<MotionCategory, string> = {
  idle: '🧘',
  emotion: '💖',
  gesture: '👋',
  dance: '💃',
  special: '✨',
  exercise: '🏋️',
};

const CATEGORY_LABELS: Record<MotionCategory, string> = {
  idle: 'Idle',
  emotion: 'Emotion',
  gesture: 'Gesture',
  dance: 'Dance',
  special: 'Special',
  exercise: 'Exercise',
};

const EMOTION_ICONS: Record<string, string> = {
  happy: '😊', angry: '😠', sad: '😢', surprised: '😲', neutral: '😐',
};

function getEmotionLabel(es: { happy: number; angry: number; sad: number; surprised: number }): string {
  const entries = Object.entries(es);
  const max = entries.reduce((a, b) => (b[1] > a[1] ? b : a), ['neutral', 0]);
  return (max[1] as number) > 0.3 ? max[0] : 'neutral';
}

/* ───── Component ───── */

export default function VrmViewerComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewer = useAppStore(s => s.viewer);
  const vrmLoaded = useAppStore(s => s.vrmLoaded);
  const activeCharacterId = useAppStore(s => s.activeCharacterId);
  const characters = useAppStore(s => s.characters);
  const setupDone = useRef(false);

  const [motionPanelOpen, setMotionPanelOpen] = useState(false);
  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<MotionCategory>('gesture');
  const [playingMotion, setPlayingMotion] = useState<string | null>(null);
  const [motionLibrary, setMotionLibrary] = useState<MotionDef[]>([]);

  /* ── Background state ── */
  const [bgMode, setBgMode] = useState<'2d' | 'hdri'>('2d');
  const [bgFiles, setBgFiles] = useState<string[]>([]);

  /* ── VRM avatar selection ── */
  const [vrmFiles, setVrmFiles] = useState<string[]>([]);

  // 2D background (CSS layer behind canvas)
  const [bg2dUrl, setBg2dUrl] = useState<string | null>(null);
  const [bg2dLabel, setBg2dLabel] = useState('');
  const [bg2dFilename, setBg2dFilename] = useState('');
  const [bg2dScale, setBg2dScale] = useState(1);
  const [bg2dX, setBg2dX] = useState(0);
  const [bg2dY, setBg2dY] = useState(0);

  // HDRI background (Three.js sky sphere)
  const [activeBg, setActiveBg] = useState<HdriBgConfig | null>(null);
  const [hdriX, setHdriX] = useState(0);
  const [hdriY, setHdriY] = useState(0);
  const [hdriIntensity, setHdriIntensity] = useState(1);
  const [hdriScale, setHdriScale] = useState(1);

  const activeChar = characters.find(c => c.id === activeCharacterId);
  const emotionLabel = activeChar ? getEmotionLabel(activeChar.emotionState) : 'neutral';

  useEffect(() => {
    if (canvasRef.current && !setupDone.current) {
      setupDone.current = true;
      viewer.setup(canvasRef.current);
    }
  }, [viewer]);

  // Scan background folders on mount
  useEffect(() => {
    scanBackgroundFiles();
  }, [bgMode]);

  // Scan VRM files on mount
  useEffect(() => {
    scanVrmFiles();
  }, []);

  // Load motion library dynamically
  useEffect(() => {
    ensureMotionLibrary().then(lib => setMotionLibrary(lib));
  }, []);

  const scanBackgroundFiles = async () => {
    try {
      const res = await fetch(assetPath('/manifest/files.json'));
      if (res.ok) {
        const manifest = await res.json();
        const files = bgMode === 'hdri'
          ? (manifest.files?.backgrounds?.hdri || [])
          : (manifest.files?.backgrounds?.['2D'] || []);
        setBgFiles(files);
      }
    } catch { /* manifest not found */ }
  };

  const scanVrmFiles = async () => {
    try {
      const res = await fetch(assetPath('/manifest/files.json'));
      if (res.ok) {
        const manifest = await res.json();
        setVrmFiles(manifest.files?.vrm || []);
      }
    } catch { /* manifest not found */ }
  };

  // Handle VRM / animation / image file drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const url = URL.createObjectURL(file);

    if (name.endsWith('.vrm')) {
      viewer.loadVRM(url);
    } else if (name.endsWith('.fbx') && viewer.model) {
      const clip = await viewer.model.animationManager.loadCustomAnimation(url, 'fbx', file.name);
      if (clip) {
        viewer.model.animationManager.playClipLoop(clip);
        setPlayingMotion(file.name);
      }
    } else if (name.endsWith('.vrma') && viewer.model) {
      const clip = await viewer.model.animationManager.loadCustomAnimation(url, 'vrma', file.name);
      if (clip) {
        viewer.model.animationManager.playClipLoop(clip);
        setPlayingMotion(file.name);
      }
    } else if (/\.(png|jpe?g|webp|gif|bmp|hdr|exr)$/.test(name)) {
      // Dropped image → use current mode
      if (bgMode === 'hdri') {
        // HDRI sky sphere
        viewer.clearBackground();
        const config: HdriBgConfig = {
          url, label: file.name, offsetX: 0, offsetY: 0, intensity: 1, scale: 1,
        };
        await viewer.setHdriBackground(config);
        setActiveBg(config);
        setBg2dUrl(null);
        setHdriX(0); setHdriY(0); setHdriIntensity(1); setHdriScale(1);
      } else {
        // 2D flat layer
        viewer.clearBackground();
        setActiveBg(null);
        setBg2dUrl(url); setBg2dLabel(file.name); setBg2dFilename('');
        setBg2dScale(1); setBg2dX(0); setBg2dY(0);
      }
    }
  }, [viewer]);

  // Play a motion
  const handlePlayMotion = useCallback(async (motionId: string) => {
    if (!viewer.model) return;
    setPlayingMotion(motionId);
    const success = await viewer.model.playMotion(motionId);
    if (!success) console.warn('Motion not available:', motionId);
    setTimeout(() => setPlayingMotion(null), 1500);
  }, [viewer]);

  // Load VRM from dropdown selection
  const handleSelectVrm = async (filename: string) => {
    if (!filename) return;
    const url = assetPath(`/vrm/${filename}`);
    try {
      await viewer.loadVRM(url);
    } catch (err) {
      console.error('Failed to load VRM:', err);
    }
  };

  // ── Background handlers ──
  const handleSelectBg = async (filename: string) => {
    const folder = bgMode === '2d' ? '2D' : 'hdri';
    const url = assetPath(`/${folder}/${filename}`);
    if (bgMode === 'hdri') {
      viewer.clearBackground();
      const config: HdriBgConfig = {
        url, label: filename, offsetX: 0, offsetY: 0, intensity: 1, scale: 1,
      };
      await viewer.setHdriBackground(config);
      setActiveBg(config);
      setBg2dUrl(null);
      setHdriX(0); setHdriY(0); setHdriIntensity(1); setHdriScale(1);
    } else {
      viewer.clearBackground();
      setActiveBg(null);
      setBg2dUrl(url); setBg2dLabel(filename); setBg2dFilename(filename);
      setBg2dScale(1); setBg2dX(0); setBg2dY(0);
    }
  };

  const handleUploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const name = file.name.toLowerCase();
    if (!/\.(png|jpe?g|webp|gif|bmp|hdr|exr)$/.test(name)) return;

    if (bgMode === 'hdri') {
      viewer.clearBackground();
      const config: HdriBgConfig = {
        url, label: file.name, offsetX: 0, offsetY: 0, intensity: 1, scale: 1,
      };
      await viewer.setHdriBackground(config);
      setActiveBg(config);
      setBg2dUrl(null);
      setHdriX(0); setHdriY(0); setHdriIntensity(1); setHdriScale(1);
    } else {
      viewer.clearBackground();
      setActiveBg(null);
      setBg2dUrl(url); setBg2dLabel(file.name); setBg2dFilename('');
      setBg2dScale(1); setBg2dX(0); setBg2dY(0);
    }
  };

  // Live-update HDRI offsets + intensity + scale
  useEffect(() => {
    if (activeBg) {
      viewer.updateHdriBackground({ offsetX: hdriX, offsetY: hdriY, intensity: hdriIntensity, scale: hdriScale });
    }
  }, [hdriX, hdriY, hdriIntensity, hdriScale, viewer, activeBg]);

  const handleClearBg = () => {
    viewer.clearBackground();
    setActiveBg(null);
    setBg2dUrl(null);
    setBg2dLabel('');
    setBg2dFilename('');
  };

  const hasBgActive = !!activeBg || !!bg2dUrl;

  const motionsInCategory = motionLibrary.filter(m => m.category === activeCategory);
  const categories = Object.keys(CATEGORY_ICONS) as MotionCategory[];

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)' }}
    >
      {/* ═══════ 2D Background Layer (behind canvas, viewport-independent) ═══════ */}
      {bg2dUrl && (
        <div
          className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
          style={{ willChange: 'transform' }}
        >
          <img
            src={bg2dUrl}
            alt="2D Background"
            draggable={false}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              minWidth: '100%',
              minHeight: '100%',
              objectFit: 'cover',
              transform: `translate(-50%, -50%) translate(${bg2dX * 100}px, ${bg2dY * 100}px) scale(${bg2dScale})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full relative z-[1]"
        style={{ touchAction: 'none' }}
      />

      {/* ═══════ Floating Affection / Emotion Overlay (bottom-left) ═══════ */}
      {vrmLoaded && activeChar && (
        <div
          className="absolute bottom-5 left-3 z-10 animate-fade-in"
          style={{
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(12px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(12px) saturate(1.2)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            padding: '10px 14px',
            minWidth: 140,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Character name */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">{activeChar.icon}</span>
            <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)', maxWidth: 100 }}>
              {activeChar.name}
            </span>
          </div>

          {/* Emotion */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-sm">{EMOTION_ICONS[emotionLabel] || '😐'}</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {emotionLabel}
            </span>
          </div>

          {/* Affection bar */}
          <div className="flex items-center gap-1.5">
            <Heart size={11} style={{ color: 'var(--accent-peach-dark)' }} />
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--border-medium)', minWidth: 70 }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${activeChar.affection}%`,
                  background: 'var(--accent-peach-dark)',
                }}
              />
            </div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)', minWidth: 26, textAlign: 'right' }}>
              {activeChar.affection}%
            </span>
          </div>
        </div>
      )}

      {/* VRM Avatar selection moved to CharacterEditor */}

      {/* ═══════ Right-side buttons ═══════ */}
      {vrmLoaded && (
        <div className="absolute bottom-20 right-3 z-10 flex flex-col gap-2">
          {/* Background settings button */}
          <button
            onClick={() => { setBgPanelOpen(!bgPanelOpen); setMotionPanelOpen(false); }}
            style={{
              background: bgPanelOpen ? 'var(--accent)' : 'var(--bg-card)',
              color: bgPanelOpen ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              border: '1px solid var(--border-light)',
              width: 36, height: 36,
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-card)',
              transition: 'all 150ms ease',
            }}
            title="Background settings"
          >
            🖼️
          </button>

          {/* Motion picker button */}
          <button
            onClick={() => { setMotionPanelOpen(!motionPanelOpen); setBgPanelOpen(false); }}
            style={{
              background: motionPanelOpen ? 'var(--accent)' : 'var(--bg-card)',
              color: motionPanelOpen ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              border: '1px solid var(--border-light)',
              width: 36, height: 36,
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-card)',
              transition: 'all 150ms ease',
            }}
            title="Motion picker"
          >
            🎭
          </button>
        </div>
      )}

      {/* ═══════ Background Settings Panel (2D / HDRI tabs) ═══════ */}
      {bgPanelOpen && vrmLoaded && (
        <div
          className="absolute bottom-20 right-12 z-10 animate-fade-in"
          style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-popup)',
            width: 270,
            maxHeight: 460,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Background</span>
            <button
              onClick={() => setBgPanelOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex" style={{ borderBottom: '1px solid var(--border-light)' }}>
            {(['2d', 'hdri'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setBgMode(mode)}
                className="flex items-center justify-center gap-1.5 flex-1 py-2 text-[11px] font-semibold transition-colors"
                style={{
                  background: bgMode === mode ? 'var(--accent-light)' : 'transparent',
                  color: bgMode === mode ? 'var(--accent)' : 'var(--text-tertiary)',
                  border: 'none',
                  borderBottom: bgMode === mode ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {mode === '2d' ? <ImageIcon size={13} /> : <Globe size={13} />}
                {mode === '2d' ? '2D Image' : 'HDRI Sphere'}
              </button>
            ))}
          </div>

          <div style={{ padding: 8, overflowY: 'auto', maxHeight: 350 }}>
            {/* ── 2D Mode ── */}
            {bgMode === '2d' && (
              <>
                {/* Dropdown file selector */}
                {bgFiles.length > 0 && (
                  <div className="mb-2">
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                      Select from folder
                    </label>
                    <select
                      value={bg2dFilename}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          handleSelectBg(val);
                        } else {
                          handleClearBg();
                          setBg2dFilename('');
                        }
                      }}
                      className="w-full text-xs rounded"
                      style={{
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-medium)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      <option value="">— None —</option>
                      {bgFiles.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Upload */}
                <label
                  className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    border: '1px dashed var(--border-medium)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    marginBottom: 8,
                  }}
                >
                  <ImageIcon size={12} />
                  Upload Image
                  <input type="file" className="hidden" accept="image/*" onChange={handleUploadBg} />
                </label>

                {/* 2D controls */}
                {bg2dUrl && (
                  <div className="space-y-2 mt-1" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                    <div className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                      Settings — {bg2dLabel || '2D Image'}
                    </div>
                    <BgSlider label="Scale (Zoom)" value={bg2dScale} min={0.5} max={4} step={0.05}
                      onChange={setBg2dScale} />
                    <BgSlider label="X (Horizontal)" value={bg2dX} min={-5} max={5} step={0.05}
                      onChange={setBg2dX} />
                    <BgSlider label="Y (Vertical)" value={bg2dY} min={-5} max={5} step={0.05}
                      onChange={setBg2dY} />

                    <button
                      onClick={handleClearBg}
                      className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium rounded transition-colors"
                      style={{ color: '#EF4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      <Trash2 size={11} /> Remove Background
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── HDRI Mode ── */}
            {bgMode === 'hdri' && (
              <>
                {/* Dropdown file selector */}
                {bgFiles.length > 0 && (
                  <div className="mb-2">
                    <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                      Select from folder
                    </label>
                    <select
                      value={activeBg?.label || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          handleSelectBg(val);
                        } else {
                          handleClearBg();
                        }
                      }}
                      className="w-full text-xs rounded"
                      style={{
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-medium)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      <option value="">— None —</option>
                      {bgFiles.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Upload */}
                <label
                  className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    border: '1px dashed var(--border-medium)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    marginBottom: 8,
                  }}
                >
                  <Globe size={12} />
                  Upload HDRI / Image
                  <input type="file" className="hidden" accept="image/*,.hdr,.exr" onChange={handleUploadBg} />
                </label>

                {/* HDRI controls */}
                {activeBg && (
                  <div className="space-y-2 mt-1" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                    <div className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                      Settings — {activeBg.label}
                    </div>
                    <BgSlider label="Brightness" value={hdriIntensity} min={0} max={3} step={0.05}
                      onChange={setHdriIntensity} />
                    <BgSlider label="Scale (Zoom)" value={hdriScale} min={0.2} max={4} step={0.05}
                      onChange={setHdriScale} />
                    <BgSlider label="X (Horizontal)" value={hdriX} min={-3.14} max={3.14} step={0.02}
                      onChange={setHdriX} />
                    <BgSlider label="Y (Vertical)" value={hdriY} min={-0.5} max={0.5} step={0.01}
                      onChange={setHdriY} />

                    <button
                      onClick={handleClearBg}
                      className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium rounded transition-colors"
                      style={{ color: '#EF4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      <Trash2 size={11} /> Remove Background
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Drag-drop hint */}
            <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-tertiary)' }}>
              Drag &amp; drop an image onto the viewer to apply as {bgMode === '2d' ? '2D' : 'HDRI'} background
            </p>
          </div>
        </div>
      )}

      {/* ═══════ Motion Picker Panel ═══════ */}
      {motionPanelOpen && vrmLoaded && (
        <div
          className="absolute bottom-20 right-12 z-10 animate-fade-in"
          style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-popup)',
            width: 220,
            maxHeight: 340,
            overflow: 'hidden',
          }}
        >
          {/* Category tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-light)',
              padding: '4px',
              gap: '2px',
            }}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                title={CATEGORY_LABELS[cat]}
                style={{
                  flex: 1,
                  padding: '4px 2px',
                  fontSize: '14px',
                  background: activeCategory === cat ? 'var(--accent-light)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'var(--transition-fast)',
                  opacity: activeCategory === cat ? 1 : 0.6,
                }}
              >
                {CATEGORY_ICONS[cat]}
              </button>
            ))}
          </div>

          {/* Motion list */}
          <div
            style={{
              padding: '4px',
              overflowY: 'auto',
              maxHeight: 280,
            }}
          >
            {motionsInCategory.map((motion) => (
              <button
                key={motion.id}
                onClick={() => handlePlayMotion(motion.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '12px',
                  fontWeight: 500,
                  background: playingMotion === motion.id ? 'var(--accent-light)' : 'transparent',
                  color: 'var(--text-primary)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'var(--transition-fast)',
                  textAlign: 'left',
                  gap: '6px',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.background = 'var(--bg-secondary)';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.background =
                    playingMotion === motion.id ? 'var(--accent-light)' : 'transparent';
                }}
              >
                <span style={{ opacity: 0.7, fontSize: '10px' }}>
                  {motion.playMode === 'loop' ? '🔁' : '▶'}
                </span>
                <span>{motion.label}</span>
              </button>
            ))}
            {motionsInCategory.length === 0 && (
              <div style={{ padding: '12px', fontSize: '12px', opacity: 0.5, textAlign: 'center' }}>
                No motions in this category
              </div>
            )}
          </div>

          {/* Reset button */}
          <div style={{ borderTop: '1px solid var(--border-light)', padding: '4px' }}>
            <button
              onClick={() => {
                viewer.model?.resetToIdle();
                setPlayingMotion(null);
              }}
              className="w-full flex items-center justify-center gap-1"
              style={{
                padding: '6px',
                fontSize: '11px',
                fontWeight: 500,
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'var(--transition-fast)',
              }}
            >
              <RotateCcw size={11} /> Reset to Idle
            </button>
          </div>
        </div>
      )}

      {/* Gradient overlay at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{
          background: 'linear-gradient(transparent, var(--bg-primary))',
        }}
      />
    </div>
  );
}

/* ───── Background Slider ───── */

function BgSlider({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--accent)', height: 4 }}
      />
    </div>
  );
}
