'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/app-store';
import { PROVIDER_CONFIGS, getModelCapabilities, type ProviderId } from '@/lib/providers';
import {
  X, Settings as SettingsIcon, Sun, Moon, Monitor, Trash2,
  Download, Upload, Save, HardDrive, Check,
} from 'lucide-react';
import { autoSaveToLS, getStorageStatus, createFullBackup, restoreFullBackup, getSaveDirectory } from '@/lib/db/local-backup';
import { isBridgeReady } from '@/lib/db/plasma-bridge';

const PROVIDERS = Object.values(PROVIDER_CONFIGS);
const ACCENT_OPTIONS = [
  { id: 'mint', label: 'Mint', color: '#A7F3D0' },
  { id: 'lilac', label: 'Lilac', color: '#DDD6FE' },
  { id: 'peach', label: 'Peach', color: '#FECDD3' },
] as const;

export default function SettingsDrawer() {
  const { settingsOpen, toggleSettings, settings, updateSettings } = useAppStore();

  const [provider, setProvider] = useState(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [retentionDays, setRetentionDays] = useState(settings.retentionDays);
  const [theme, setTheme] = useState(settings.theme);
  const [accentColor, setAccentColor] = useState(settings.accentColor);
  const [language, setLanguage] = useState(settings.language ?? 'en');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [savePath, setSavePath] = useState<string | null>(null);

  // Resolve save path on mount
  useEffect(() => {
    getSaveDirectory().then(p => setSavePath(p));
  }, []);

  useEffect(() => {
    setProvider(settings.provider);
    setModel(settings.model);
    setApiKey(settings.apiKey);
    setBaseUrl(settings.baseUrl);
    setRetentionDays(settings.retentionDays);
    setTheme(settings.theme);
    setAccentColor(settings.accentColor);
    setLanguage(settings.language ?? 'en');
  }, [settings]);

  const providerConfig = PROVIDER_CONFIGS[provider as ProviderId];
  const models = providerConfig?.models || [];

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const config = PROVIDER_CONFIGS[newProvider as ProviderId];
    setModel(config.defaultModel);
    if (newProvider === 'ollama') {
      setBaseUrl('http://localhost:11434');
      setApiKey('');
    } else if (newProvider === 'custom') {
      setBaseUrl('');
    } else {
      setBaseUrl('');
    }
  };

  const handleSave = () => {
    updateSettings({
      provider,
      model,
      apiKey,
      baseUrl,
      retentionDays,
      theme,
      accentColor: accentColor as 'mint' | 'lilac' | 'peach',
      language: language as 'en' | 'ja' | 'ko' | 'zh' | 'es',
    });
    // Immediately persist to localStorage backup
    setTimeout(() => autoSaveToLS(), 100);
    toggleSettings();
  };

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.removeAttribute('data-theme');
    } else {
      // system
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
    }
    root.setAttribute('data-accent', accentColor);
  }, [theme, accentColor]);

  const handleExportAll = async () => {
    // Build backup from both IDB + localStorage
    const jsonStr = await createFullBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ctrl-alt-moe-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportAll = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      // restoreFullBackup handles IDB + localStorage
      await restoreFullBackup(text);
      window.location.reload();
    } catch (err) {
      alert('Invalid backup file');
    }
  };

  const handleReset = async () => {
    if (!confirm('This will delete ALL data. Are you sure?')) return;
    const { db } = await import('@/lib/db/schema');
    await db.delete();
    window.location.reload();
  };

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div
        className="w-full max-w-md h-full overflow-y-auto p-6 animate-slide-right"
        style={{
          background: 'var(--bg-primary)',
          borderLeft: '1px solid var(--border-light)',
          boxShadow: 'var(--shadow-popup)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>
          <button className="btn-icon" onClick={toggleSettings}><X size={18} /></button>
        </div>

        {/* ───── Provider ───── */}
        <Section title="AI Provider">
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Provider</label>
          <select
            className="input-pill mb-3"
            style={{ borderRadius: 'var(--radius-md)' }}
            value={provider}
            onChange={e => handleProviderChange(e.target.value)}
          >
            {PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Model</label>
          <select
            className="input-pill mb-3"
            style={{ borderRadius: 'var(--radius-md)' }}
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          {/* API Key */}
          {providerConfig?.requiresApiKey && (
            <>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>API Key</label>
              <input
                className="input-pill mb-3"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Enter your API key..."
              />
            </>
          )}

          {/* Base URL */}
          {(provider === 'custom' || provider === 'ollama') && (
            <>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Base URL</label>
              <input
                className="input-pill mb-3"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder={providerConfig?.baseUrl || 'https://...'}
              />
            </>
          )}

          {/* Capabilities indicator */}
          <div className="mt-2 p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}>
            <div className="text-[10px] font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>
              MODEL CAPABILITIES
            </div>
            <CapabilityList providerId={provider as ProviderId} modelId={model} />
          </div>
        </Section>

        {/* ───── Appearance ───── */}
        <Section title="Appearance">
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>Theme</label>
          <div className="flex gap-2 mb-4">
            {([
              { id: 'light', icon: <Sun size={14} />, label: 'Light' },
              { id: 'dark', icon: <Moon size={14} />, label: 'Dark' },
              { id: 'system', icon: <Monitor size={14} />, label: 'System' },
            ] as const).map(t => (
              <button
                key={t.id}
                className="btn flex-1 text-xs"
                style={{
                  background: theme === t.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                  border: theme === t.id ? '1px solid var(--accent)' : '1px solid var(--border-light)',
                }}
                onClick={() => setTheme(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>Accent Color</label>
          <div className="flex gap-3">
            {ACCENT_OPTIONS.map(a => (
              <button
                key={a.id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all"
                style={{
                  background: accentColor === a.id ? a.color + '40' : 'var(--bg-secondary)',
                  border: accentColor === a.id ? `2px solid ${a.color}` : '1px solid var(--border-light)',
                }}
                onClick={() => setAccentColor(a.id)}
              >
                <span className="w-3 h-3 rounded-full" style={{ background: a.color }} />
                {a.label}
              </button>
            ))}
          </div>

          <label className="text-xs mt-4 mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Motion Keyword Language
          </label>
          <select
            className="input-pill"
            value={language}
            onChange={e => setLanguage(e.target.value as 'en' | 'ja' | 'ko' | 'zh' | 'es')}
          >
            <option value="en">English</option>
            <option value="ja">日本語 (Japanese)</option>
            <option value="ko">한국어 (Korean)</option>
            <option value="zh">中文 (Chinese)</option>
            <option value="es">Español (Spanish)</option>
          </select>
        </Section>

        {/* ───── Data ───── */}
        <Section title="Data & Privacy">
          {/* Storage status */}
          <div
            className="flex flex-col gap-1 mb-3 px-2 py-1.5 rounded text-[11px]"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-secondary)',
            }}
          >
            <div className="flex items-center gap-2">
              <HardDrive size={12} style={{ opacity: 0.6 }} />
              <span>{isBridgeReady() ? '💾 File storage (KDE widget)' : '🌐 Browser localStorage'}</span>
              {saveStatus && (
                <span className="ml-auto flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                  <Check size={11} /> {saveStatus}
                </span>
              )}
            </div>
            {savePath && (
              <div className="text-[10px] pl-5 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                📂 {savePath}
              </div>
            )}
          </div>

          <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
            Retention Period (days)
          </label>
          <input
            className="input-pill mb-3"
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={e => setRetentionDays(parseInt(e.target.value) || 30)}
          />

          <div className="flex gap-2 mt-3">
            <button
              className="btn btn-ghost flex-1 text-xs"
              onClick={async () => {
                await autoSaveToLS();
                const status = getStorageStatus();
                setSaveStatus(`${status.characterCount} chars`);
                setTimeout(() => setSaveStatus(null), 3000);
              }}
            >
              <Save size={13} /> Save Now
            </button>
            <button className="btn btn-ghost flex-1 text-xs" onClick={handleExportAll}>
              <Download size={13} /> Export
            </button>
            <label className="btn btn-ghost flex-1 text-xs cursor-pointer">
              <Upload size={13} /> Import
              <input type="file" accept=".json" className="hidden" onChange={handleImportAll} />
            </label>
          </div>

          <button
            className="btn btn-ghost w-full mt-2 text-xs text-red-400"
            onClick={handleReset}
          >
            <Trash2 size={13} /> Reset All Data
          </button>
        </Section>

        {/* Save */}
        <div className="mt-6">
          <button className="btn btn-primary w-full" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function CapabilityList({ providerId, modelId }: { providerId: ProviderId; modelId: string }) {
  const caps = getModelCapabilities(providerId, modelId);

  const items = [
    { label: 'Image Input', value: caps.supportsImageInput },
    { label: 'File Input', value: caps.supportsFileInput },
    { label: 'Streaming', value: caps.supportsStreaming },
    { label: 'Web Search', value: caps.supportsWebSearch },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => (
        <span
          key={item.label}
          className="badge-pill"
          style={{
            background: item.value ? 'var(--accent-light)' : 'var(--bg-primary)',
            color: item.value ? 'var(--text-primary)' : 'var(--text-tertiary)',
            border: `1px solid ${item.value ? 'var(--accent)' : 'var(--border-light)'}`,
          }}
        >
          {item.value ? '✓' : '✗'} {item.label}
        </span>
      ))}
    </div>
  );
}
