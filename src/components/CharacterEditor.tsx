'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/app-store';
import { X, Sparkles, Upload, Settings2, RotateCcw } from 'lucide-react';
import { sendChat } from '@/lib/chat/engine';
import { DEFAULT_VRM_SETTINGS, type VrmSettings } from '@/lib/db/schema';
import { assetPath } from '@/lib/utils/asset-path';

const ICON_OPTIONS = ['✨', '💖', '🌸', '🎀', '🐱', '🦊', '🐰', '🌟', '🔮', '🎭', '🌈', '🍓'];
const COLOR_OPTIONS = ['#A7F3D0', '#DDD6FE', '#FECDD3', '#FDE68A', '#BAE6FD', '#FCA5A5', '#D9F99D', '#E9D5FF'];

export default function CharacterEditor() {
  const { characterEditId, setCharacterEditId, characters, updateCharacter, settings } = useAppStore();
  const char = characters.find(c => c.id === characterEditId);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [speakingStyle, setSpeakingStyle] = useState('');
  const [personality, setPersonality] = useState('');
  const [likes, setLikes] = useState('');
  const [dislikes, setDislikes] = useState('');
  const [personaText, setPersonaText] = useState('');
  const [color, setColor] = useState('#A7F3D0');
  const [icon, setIcon] = useState('✨');
  const [enhancing, setEnhancing] = useState(false);
  const [showVrmSettings, setShowVrmSettings] = useState(false);
  const [vrmSettings, setVrmSettings] = useState<VrmSettings>({ ...DEFAULT_VRM_SETTINGS });
  const [vrmFiles, setVrmFiles] = useState<string[]>([]);
  const [selectedVrmUrl, setSelectedVrmUrl] = useState('');
  const [selectedVrmSource, setSelectedVrmSource] = useState<'url' | 'file'>('url');

  // Load VRM file list from pre-built manifest
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(assetPath('/manifest/files.json'));
        if (res.ok) {
          const manifest = await res.json();
          setVrmFiles(manifest.files?.vrm || []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Only load character data when the editor first opens (characterEditId changes),
  // NOT on every char update — otherwise selecting a VRM model resets local state.
  useEffect(() => {
    if (char) {
      setName(char.name);
      setAge(char.age?.toString() || '');
      setSpeakingStyle(char.speakingStyle);
      setPersonality(char.personality);
      setLikes(char.likes);
      setDislikes(char.dislikes);
      setPersonaText(char.personaText);
      setColor(char.color);
      setIcon(char.icon);
      setVrmSettings(char.vrmSettings ?? { ...DEFAULT_VRM_SETTINGS });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterEditId]);

  if (!characterEditId || !char) return null;

  const handleSave = () => {
    updateCharacter(char.id, {
      name,
      age: age ? parseInt(age) : undefined,
      speakingStyle,
      personality,
      likes,
      dislikes,
      personaText,
      color,
      icon,
      vrmSettings,
      vrmModelUrl: selectedVrmUrl || undefined,
      vrmModelSource: selectedVrmSource,
    });
    setCharacterEditId(null);
  };

  const handleEnhance = async () => {
    if (!settings.apiKey && settings.provider !== 'ollama') return;
    setEnhancing(true);
    try {
      const { getAdapter } = await import('@/lib/providers');
      const adapter = getAdapter(settings.provider as any);
      const prompt = `Given these character traits, write a detailed persona description for a roleplay character. Be creative and expand on the details.

Name: ${name}
${age ? `Age: ${age}` : ''}
Speaking style: ${speakingStyle}
Personality: ${personality}
Likes: ${likes}
Dislikes: ${dislikes}

Write a 2-3 paragraph persona description. Output ONLY the persona text, nothing else.`;

      const stream = await adapter.chat(
        { messages: [{ role: 'user', content: prompt }], model: settings.model, stream: true, max_tokens: 600, temperature: 0.8 },
        settings.apiKey,
        settings.baseUrl || undefined,
      );

      let result = '';
      const reader = stream.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        result += value.content;
        setPersonaText(result);
        if (value.done) break;
      }
    } catch (err) {
      console.error('Enhance error:', err);
    } finally {
      setEnhancing(false);
    }
  };

  const handleVrmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSelectedVrmUrl(url);
    setSelectedVrmSource('file');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div
        className="glass-card w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 mx-4 animate-fade-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Edit Character</h2>
          <button className="btn-icon" onClick={() => setCharacterEditId(null)}>
            <X size={18} />
          </button>
        </div>

        {/* Icon & Color */}
        <div className="mb-5">
          <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>Icon & Color</label>
          <div className="flex gap-2 flex-wrap mb-2">
            {ICON_OPTIONS.map(ic => (
              <button
                key={ic}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all"
                style={{
                  background: icon === ic ? 'var(--accent-light)' : 'var(--bg-secondary)',
                  border: icon === ic ? '2px solid var(--accent)' : '1px solid var(--border-light)',
                }}
                onClick={() => setIcon(ic)}
              >
                {ic}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                className="w-7 h-7 rounded-full transition-all"
                style={{
                  background: c,
                  border: color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                  transform: color === c ? 'scale(1.1)' : 'scale(1)',
                }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Age" value={age} onChange={setAge} type="number" />
          <Field label="Speaking Style" value={speakingStyle} onChange={setSpeakingStyle} placeholder="e.g. friendly and casual" />
          <Field label="Personality" value={personality} onChange={setPersonality} placeholder="e.g. kind, curious, playful" />
          <Field label="Likes" value={likes} onChange={setLikes} placeholder="e.g. music, cats, rain" />
          <Field label="Dislikes" value={dislikes} onChange={setDislikes} placeholder="e.g. loud noises, spiders" />

          {/* Persona Text */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Persona Text</label>
              <button
                className="btn text-xs py-1 px-3"
                style={{ background: 'var(--accent-light)', fontSize: 12 }}
                onClick={handleEnhance}
                disabled={enhancing}
              >
                <Sparkles size={12} />
                {enhancing ? 'Generating...' : 'Enhance'}
              </button>
            </div>
            <textarea
              className="input-pill"
              style={{ borderRadius: 'var(--radius-md)', minHeight: 100, resize: 'vertical' }}
              value={personaText}
              onChange={e => setPersonaText(e.target.value)}
              placeholder="Detailed persona (auto-generated or custom)..."
            />
          </div>

          {/* VRM Model Selector */}
          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>VRM Model</label>
            {/* Dropdown from /public/vrm/ folder */}
            <select
              value={selectedVrmUrl}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedVrmUrl(val);
                setSelectedVrmSource('url');
              }}
              className="w-full text-xs"
              style={{
                padding: '10px 12px',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                outline: 'none',
                marginBottom: 8,
              }}
            >
              <option value="">Select a model...</option>
              {vrmFiles.map(f => (
                <option key={f} value={assetPath(`/vrm/${f}`)}>{f.replace('.vrm', '')}</option>
              ))}
            </select>
            {/* Custom upload */}
            <label
              className="btn btn-ghost w-full justify-center cursor-pointer text-xs"
              style={{ border: '1px dashed var(--border-medium)', padding: '8px 12px' }}
            >
              <Upload size={14} /> Upload Custom VRM
              <input type="file" accept=".vrm" className="hidden" onChange={handleVrmUpload} />
            </label>
            {selectedVrmUrl && !vrmFiles.some(f => assetPath(`/vrm/${f}`) === selectedVrmUrl) && selectedVrmUrl !== '' && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Using custom model</p>
            )}
          </div>

          {/* VRM Pose & Physics Settings */}
          <div>
            <button
              className="btn btn-ghost w-full justify-between text-xs"
              style={{ border: '1px solid var(--border-light)', padding: '8px 12px' }}
              onClick={() => setShowVrmSettings(v => !v)}
            >
              <span className="flex items-center gap-1.5">
                <Settings2 size={14} />
                VRM Pose & Physics Settings
              </span>
              <span style={{ transform: showVrmSettings ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▾</span>
            </button>
            {showVrmSettings && (
              <div className="mt-2 space-y-3 p-3" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                {/* Arm Rest Angle */}
                <SliderField
                  label="Arm Rest Angle"
                  hint="-0.5 = wide spread ↔ 0 = T-pose ↔ 1.57 = fully down"
                  value={vrmSettings.armRestAngle}
                  min={-0.5} max={1.57} step={0.01}
                  onChange={v => setVrmSettings(s => ({ ...s, armRestAngle: v }))}
                />
                {/* Arm Forward Pitch */}
                <SliderField
                  label="Arm Forward Pitch"
                  hint="Forward tilt of upper arms"
                  value={vrmSettings.armForwardPitch}
                  min={0} max={0.8} step={0.01}
                  onChange={v => setVrmSettings(s => ({ ...s, armForwardPitch: v }))}
                />
                {/* Arm Spread Bias (Animation) */}
                <SliderField
                  label="Arm Spread Bias (Animation)"
                  hint="-30° inward ↔ 0° neutral ↔ +60° outward — fixes arm-body penetration during motions"
                  value={vrmSettings.armSpreadBias ?? 20}
                  min={-30} max={60} step={1}
                  onChange={v => setVrmSettings(s => ({ ...s, armSpreadBias: v }))}
                />
                {/* Spring Bone Stiffness */}
                <SliderField
                  label="Spring Bone Stiffness"
                  hint="Hair/clothing springiness"
                  value={vrmSettings.springBoneStiffness}
                  min={0.1} max={3.0} step={0.05}
                  onChange={v => setVrmSettings(s => ({ ...s, springBoneStiffness: v }))}
                />
                {/* Spring Bone Gravity */}
                <SliderField
                  label="Spring Bone Gravity"
                  hint="How much gravity affects springs"
                  value={vrmSettings.springBoneGravity}
                  min={0} max={3.0} step={0.05}
                  onChange={v => setVrmSettings(s => ({ ...s, springBoneGravity: v }))}
                />
                {/* Spring Bone Wind */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Wind Effect</span>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)', marginTop: 1 }}>Subtle breeze on springs</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={vrmSettings.springBoneWind}
                      onChange={e => setVrmSettings(s => ({ ...s, springBoneWind: e.target.checked }))}
                      className="sr-only"
                    />
                    <div
                      className="w-9 h-5 rounded-full transition-colors"
                      style={{ background: vrmSettings.springBoneWind ? 'var(--accent)' : 'var(--border-medium)' }}
                    >
                      <div
                        className="w-4 h-4 rounded-full transition-transform"
                        style={{
                          background: 'white',
                          margin: '2px',
                          transform: vrmSettings.springBoneWind ? 'translateX(16px)' : 'translateX(0)',
                        }}
                      />
                    </div>
                  </label>
                </div>
                {/* Reset button */}
                <button
                  className="btn btn-ghost w-full text-xs justify-center"
                  onClick={() => setVrmSettings({ ...DEFAULT_VRM_SETTINGS })}
                >
                  <RotateCcw size={12} /> Reset to Defaults
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button className="btn btn-ghost flex-1" onClick={() => setCharacterEditId(null)}>Cancel</button>
          <button
            className="btn flex-1 font-semibold"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        className="input-pill"
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function SliderField({ label, hint, value, min, max, step, onChange }: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)', marginTop: 1 }}>{hint}</p>
        </div>
        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-current"
        style={{ accentColor: 'var(--accent)' }}
      />
    </div>
  );
}
