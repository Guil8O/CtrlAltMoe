'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import { sendChat, generateRollingSummary, type ChatOptions } from '@/lib/chat/engine';
import { type ModelCapabilities } from '@/lib/providers';
import {
  Send, Monitor, Paperclip, Globe, X, Image as ImageIcon,
} from 'lucide-react';

/* ───── Emotion badge color ───── */
const emotionColors: Record<string, string> = {
  happy: '#A7F3D0',
  angry: '#FCA5A5',
  sad: '#BAE6FD',
  surprised: '#FDE68A',
  neutral: '#E5E7EB',
};

export default function ChatPanel() {
  const {
    messages,
    activeCharacterId,
    characters,
    settings,
    isStreaming,
    streamingContent,
    getCapabilities,
  } = useAppStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inputText, setInputText] = useState('');
  const [screenShareOn, setScreenShareOn] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);

  const activeChar = characters.find(c => c.id === activeCharacterId);
  const caps: ModelCapabilities = getCapabilities();

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeCharacterId]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text && attachedImages.length === 0) return;
    if (isStreaming) return;

    const options: ChatOptions = {};

    // Screen capture
    if (screenShareOn && caps.supportsImageInput) {
      const viewer = useAppStore.getState().viewer;
      const frame = viewer.captureFrame();
      if (frame) {
        options.screenCapture = frame;
      }
    }

    // Attached images
    if (attachedImages.length > 0) {
      options.imageDataUrls = attachedImages;
    }

    setInputText('');
    setAttachedImages([]);

    await sendChat(text, options);

    // Auto-summary if many messages
    const msgCount = useAppStore.getState().messages.length;
    if (msgCount > 0 && msgCount % 20 === 0) {
      generateRollingSummary();
    }
  }, [inputText, attachedImages, screenShareOn, isStreaming, caps]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  if (!activeCharacterId) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
        <div className="text-center animate-fade-in">
          <p className="text-lg mb-2">👋</p>
          <p className="text-sm">Select or create a character to start chatting</p>
        </div>
      </div>
    );
  }

  const emotionLabel = activeChar
    ? (() => {
        const es = activeChar.emotionState;
        const max = Object.entries(es).reduce((a, b) => (b[1] > a[1] ? b : a), ['neutral', 0]);
        return max[1] > 0.3 ? max[0] : 'neutral';
      })()
    : 'neutral';

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-light)',
      }}
    >
      {/* ───── Header ───── */}
      <div
        className="glass flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-light)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ background: (activeChar?.color || '#A7F3D0') + '40' }}
          >
            {activeChar?.icon || '✨'}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{activeChar?.name || 'Character'}</h3>
            <div className="flex items-center gap-2">
              <span
                className="badge-pill"
                style={{
                  background: emotionColors[emotionLabel] || emotionColors.neutral,
                  color: 'var(--text-on-accent)',
                  fontSize: 10,
                }}
              >
                {emotionLabel}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {settings.provider}/{settings.model}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ───── Messages ───── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
          >
            <div
              className="max-w-[85%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                borderRadius: msg.role === 'user'
                  ? 'var(--radius-lg) var(--radius-lg) 4px var(--radius-lg)'
                  : 'var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px',
                background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                border: msg.role === 'user' ? 'none' : '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-soft)',
                color: msg.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-primary)',
              }}
            >
              {msg.content}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {msg.attachments.map((att, j) => (
                    att.dataUrl && (
                      <img
                        key={j}
                        src={att.dataUrl}
                        alt={att.name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    )
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex justify-start animate-fade-in">
            <div
              className="max-w-[85%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-light)',
                boxShadow: 'var(--shadow-soft)',
              }}
            >
              {streamingContent || (
                <span className="animate-pulse-slow" style={{ color: 'var(--text-tertiary)' }}>
                  Thinking...
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ───── Image attachments preview ───── */}
      {attachedImages.length > 0 && (
        <div className="px-4 pb-1 flex gap-2 overflow-x-auto">
          {attachedImages.map((img, i) => (
            <div key={i} className="relative shrink-0 animate-fade-in">
              <img src={img} alt="" className="w-14 h-14 rounded-lg object-cover" />
              <button
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}
                onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ───── Input area ───── */}
      <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
        {/* Toolbar */}
        <div className="flex items-center gap-1 mb-2">
          {/* Screen share toggle */}
          {caps.supportsImageInput && (
            <button
              className={`btn-icon ${screenShareOn ? 'text-green-500' : ''}`}
              onClick={() => setScreenShareOn(!screenShareOn)}
              title={screenShareOn ? 'Screen capture ON' : 'Screen capture OFF'}
              style={screenShareOn ? { background: 'var(--accent-light)' } : {}}
            >
              <Monitor size={16} />
            </button>
          )}

          {/* Image attach */}
          {caps.supportsImageInput && (
            <button
              className="btn-icon"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image"
            >
              <ImageIcon size={16} />
            </button>
          )}

          {/* File attach */}
          {caps.supportsFileInput && (
            <button
              className="btn-icon"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
            >
              <Paperclip size={16} />
            </button>
          )}

          {/* Web search */}
          {caps.supportsWebSearch && (
            <button className="btn-icon" title="Web search (coming soon)" disabled>
              <Globe size={16} />
            </button>
          )}
        </div>

        {/* Input + Send */}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="input-pill flex-1"
            style={{ minHeight: 42, maxHeight: 120, resize: 'none' }}
            rows={1}
            placeholder="Type a message..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn btn-primary shrink-0"
            style={{ borderRadius: 'var(--radius-pill)', padding: '10px 14px' }}
            onClick={handleSend}
            disabled={isStreaming || (!inputText.trim() && attachedImages.length === 0)}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        multiple
        onChange={handleImageAttach}
      />
    </div>
  );
}
