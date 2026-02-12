'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/store/app-store';
import CharacterList from '@/components/CharacterList';
import ChatPanel from '@/components/ChatPanel';
import CharacterEditor from '@/components/CharacterEditor';
import SettingsDrawer from '@/components/SettingsDrawer';
import { Settings, PanelLeftClose, PanelLeftOpen, Eye, EyeOff } from 'lucide-react';
import { runRetentionCleanup } from '@/lib/chat/engine';
import { autoSaveToLS, initStorage } from '@/lib/db/local-backup';

// Dynamic import for VRM viewer (SSR incompatible)
const VrmViewer = dynamic(() => import('@/components/VrmViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
      <div className="animate-pulse-slow text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading 3D viewer...</div>
    </div>
  ),
});

export default function Home() {
  const {
    loadCharacters,
    loadSettings,
    toggleSidebar,
    toggleSettings,
    sidebarOpen,
    settingsOpen,
    characterEditId,
    vrmVisible,
    setVrmVisible,
    settings,
  } = useAppStore();

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Initialise persistent storage (Plasma bridge or LS), then load data
    initStorage().then(() => {
      loadSettings().then(() => {
        loadCharacters();
        runRetentionCleanup();
      });
    });

    // Auto-save every 30 seconds
    const saveInterval = setInterval(() => autoSaveToLS(), 30_000);

    // Also save on page unload (browser close / navigate away)
    const handleBeforeUnload = () => autoSaveToLS();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(saveInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Apply theme on mount
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (settings.theme === 'light') {
      root.removeAttribute('data-theme');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
    }
    root.setAttribute('data-accent', settings.accentColor);
  }, [mounted, settings.theme, settings.accentColor]);

  // Trigger Three.js canvas resize when VRM visibility changes
  useEffect(() => {
    if (mounted && vrmVisible) {
      // Small delay to let grid transition finish
      const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
      return () => clearTimeout(timer);
    }
  }, [vrmVisible, mounted]);

  if (!mounted) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center animate-fade-in">
          <div className="text-2xl mb-2">✨</div>
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading Ctrl+Alt+Moe...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen" style={{ height: '100dvh' }}>
      {/* Top bar (floating) — positioned after sidebar + VRM area to avoid overlap */}
      <div
        className="fixed top-3 z-40 flex items-center gap-1"
        style={{
          left: sidebarOpen
            ? (vrmVisible ? 'calc(280px + 12px)' : 'calc(280px + 12px)')
            : '12px',
          transition: 'left 300ms ease',
        }}
      >
        <button className="floating-btn" onClick={toggleSidebar} title="Toggle sidebar">
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <button className="floating-btn" onClick={() => setVrmVisible(!vrmVisible)} title="Toggle VRM">
          {vrmVisible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>

      <div
        className="fixed top-3 right-3 z-40"
      >
        <button className="floating-btn" onClick={toggleSettings} title="Settings">
          <Settings size={16} />
        </button>
      </div>

      {/* Main 3-column layout */}
      <div
        className="h-full overflow-hidden"
        style={{
          display: 'grid',
          gridTemplateColumns: `${sidebarOpen ? '280px' : '0px'} ${vrmVisible ? '1fr' : '0px'} minmax(320px, 420px)`,
          transition: 'grid-template-columns 300ms ease',
        }}
      >
        {/* LEFT: Character List */}
        <div style={{ overflow: 'hidden', minWidth: 0 }}>
          {sidebarOpen && <CharacterList />}
        </div>

        {/* CENTER: VRM Viewer — always mounted to prevent Three.js re-init crop */}
        <div style={{ overflow: 'hidden', minWidth: 0, visibility: vrmVisible ? 'visible' : 'hidden' }}>
          <VrmViewer />
        </div>

        {/* RIGHT: Chat */}
        <div style={{ overflow: 'hidden', minWidth: 0 }}>
          <ChatPanel showTopPadding={!vrmVisible} />
        </div>
      </div>

      {/* Modals */}
      {characterEditId && <CharacterEditor />}
      <SettingsDrawer />
    </div>
  );
}
