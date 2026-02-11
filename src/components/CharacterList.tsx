'use client';

import { useAppStore } from '@/store/app-store';
import { Plus, MoreHorizontal, Archive, Pencil, Download, Heart } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const EMOTION_ICONS: Record<string, string> = {
  happy: '😊',
  angry: '😠',
  sad: '😢',
  surprised: '😲',
  neutral: '😐',
};

function getEmotionLabel(es: { happy: number; angry: number; sad: number; surprised: number }): string {
  const entries = Object.entries(es);
  const max = entries.reduce((a, b) => (b[1] > a[1] ? b : a), ['neutral', 0]);
  return max[1] > 0.3 ? max[0] : 'neutral';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function CharacterList() {
  const {
    characters,
    activeCharacterId,
    selectCharacter,
    createCharacter,
    deleteCharacter,
    setCharacterEditId,
  } = useAppStore();

  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCreate = async () => {
    const id = await createCharacter('New Character');
    selectCharacter(id);
    setCharacterEditId(id);
  };

  const handleExport = (char: typeof characters[0]) => {
    const data = JSON.stringify(char, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${char.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(null);
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-light)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Characters</h2>
        <button
          className="btn-icon"
          onClick={handleCreate}
          title="New Character"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Character list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ position: 'relative' }}>
        {characters.length === 0 && (
          <div className="text-center py-8 animate-fade-in">
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No characters yet</p>
            <button className="btn btn-primary mt-3 text-sm" onClick={handleCreate}>
              <Plus size={14} /> Create your first
            </button>
          </div>
        )}

        {characters.map((char) => {
          const isActive = char.id === activeCharacterId;
          const emotionLabel = getEmotionLabel(char.emotionState);

          return (
            <div
              key={char.id}
              className="relative rounded-xl p-3 cursor-pointer hover-lift animate-fade-in"
              style={{
                background: isActive ? 'var(--accent-light)' : 'transparent',
                border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                transition: 'all var(--transition-fast)',
              }}
              onClick={() => selectCharacter(char.id)}
            >
              <div className="flex items-start gap-3">
                {/* Avatar icon */}
                <div
                  className="flex items-center justify-center rounded-xl text-lg shrink-0"
                  style={{
                    width: 40,
                    height: 40,
                    background: char.color + '40',
                    border: `1px solid ${char.color}`,
                  }}
                >
                  {char.icon}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{char.name}</span>
                    <span
                      className="badge-pill"
                      style={{
                        background: 'var(--accent-light)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {EMOTION_ICONS[emotionLabel] || '😐'} {emotionLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Heart size={10} style={{ color: 'var(--accent-peach-dark)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {char.affection}%
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      · {timeAgo(char.updatedAt)}
                    </span>
                  </div>
                </div>

                {/* Menu button */}
                <button
                  className="btn-icon shrink-0"
                  data-menu-id={char.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (menuOpen === char.id) {
                      setMenuOpen(null);
                      setMenuPos(null);
                    } else {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenuPos({ top: rect.bottom + 4, left: rect.right - 150 });
                      setMenuOpen(char.id);
                    }
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>

              {/* Dropdown menu */}
              {menuOpen === char.id && menuPos && (
                <div
                  ref={menuRef}
                  className="glass-card p-1 min-w-[140px] animate-fade-in"
                  style={{
                    position: 'fixed',
                    zIndex: 9999,
                    boxShadow: 'var(--shadow-popup)',
                    top: menuPos.top,
                    left: menuPos.left,
                  }}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-[var(--border-light)] transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCharacterEditId(char.id);
                      setMenuOpen(null);
                      setMenuPos(null);
                    }}
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-[var(--border-light)] transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport(char);
                    }}
                  >
                    <Download size={13} /> Export
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-[var(--border-light)] transition-colors text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCharacter(char.id);
                      setMenuOpen(null);
                      setMenuPos(null);
                    }}
                  >
                    <Archive size={13} /> Archive
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
