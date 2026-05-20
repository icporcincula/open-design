// Hand-off menu in the ChatPane header — "open the design project
// folder in <local app>". Mirrors paseo's WorkspaceOpenInEditorButton:
// a single split-style button that remembers the user's last pick
// (LocalStorage) and a dropdown listing the rest. Detection runs on
// the daemon; this component just renders.

import { useEffect, useRef, useState } from 'react';
import type {
  HostEditor,
  HostEditorId,
  HostEditorsResponse,
} from '@open-design/contracts';
import { fetchHostEditors, openProjectInEditor } from '../providers/registry';
import { Icon, type IconName } from './Icon';

const PREFERRED_EDITOR_KEY = 'open-design:preferred-editor';

interface Props {
  projectId: string;
  // Optional fallback "always open in OS file manager" — falls back to the
  // existing shell.openPath bridge in case the daemon catalogue is empty
  // (highly unlikely on macOS / Win / Linux but harmless to support).
  onRequestRevealInFinder?: () => void;
}

function readPreferred(): HostEditorId | null {
  try {
    const v = window.localStorage.getItem(PREFERRED_EDITOR_KEY);
    return (v as HostEditorId) || null;
  } catch {
    return null;
  }
}

function writePreferred(id: HostEditorId): void {
  try {
    window.localStorage.setItem(PREFERRED_EDITOR_KEY, id);
  } catch {
    // ignore — quota or sandboxed
  }
}

export function HandoffButton({ projectId, onRequestRevealInFinder }: Props) {
  const [editors, setEditors] = useState<HostEditor[]>([]);
  const [platform, setPlatform] = useState<HostEditorsResponse['platform']>('unknown');
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<HostEditorId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHostEditors()
      .then((resp) => {
        if (cancelled) return;
        setEditors(resp.editors);
        setPlatform(resp.platform);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setEditors([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const available = editors.filter((e) => e.available);
  const unavailable = editors.filter((e) => !e.available);
  const preferred = readPreferred();
  const primary =
    available.find((e) => e.id === preferred) ?? available[0] ?? null;

  async function launch(editor: HostEditor) {
    if (!editor.available) {
      // Still try — the user might have an unprobed path (e.g. macOS
      // bundle in /Applications). The daemon will return 409 if it
      // genuinely can't find it.
    }
    setError(null);
    setBusy(editor.id);
    setOpen(false);
    writePreferred(editor.id);
    try {
      await openProjectInEditor(projectId, editor.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Fallback: if Finder is the user's pick and the daemon spawn
      // failed, try the renderer-side reveal-in-finder bridge.
      if (editor.id === 'finder' && onRequestRevealInFinder) {
        try {
          onRequestRevealInFinder();
        } catch {
          // ignore
        }
      }
    } finally {
      setBusy(null);
    }
  }

  if (!loaded || (available.length === 0 && unavailable.length === 0)) {
    return null;
  }

  // No detected editors at all — render a Finder/Explorer/File-Manager
  // single-button fallback so the surface is never blank.
  if (available.length === 0) {
    const fallbackLabel = platform === 'win32' ? 'Explorer' : platform === 'linux' ? 'File Manager' : 'Finder';
    return (
      <button
        type="button"
        className="handoff-trigger"
        title={`No editors found on $PATH — opens in ${fallbackLabel}`}
        onClick={() => onRequestRevealInFinder?.()}
      >
        <Icon name="folder" size={13} />
        <span className="handoff-trigger-label">{fallbackLabel}</span>
      </button>
    );
  }

  return (
    <div
      className={`handoff-wrap${open ? ' open' : ''}`}
      ref={wrapRef}
      data-testid="handoff-wrap"
    >
      <button
        type="button"
        className="handoff-trigger"
        data-testid="handoff-trigger"
        title={primary ? `交付给 ${primary.label}` : '交付'}
        onClick={() => {
          if (primary && busy !== primary.id) {
            void launch(primary);
          } else {
            setOpen((v) => !v);
          }
        }}
        disabled={busy !== null}
      >
        {primary ? (
          <>
            <Icon name={(primary.icon ?? 'folder') as IconName} size={13} />
            <span className="handoff-trigger-label">
              交付给 {primary.label}
            </span>
          </>
        ) : (
          <>
            <Icon name="folder" size={13} />
            <span className="handoff-trigger-label">交付</span>
          </>
        )}
        <button
          type="button"
          className="handoff-caret"
          aria-label="Choose hand-off target"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          tabIndex={-1}
        >
          <Icon name="chevron-down" size={12} />
        </button>
      </button>
      {open ? (
        <div className="handoff-menu" role="menu" data-testid="handoff-menu">
          {available.map((editor) => (
            <button
              key={editor.id}
              type="button"
              className={`handoff-menu-item${editor.id === preferred ? ' active' : ''}`}
              role="menuitem"
              data-testid={`handoff-menu-item-${editor.id}`}
              onClick={() => void launch(editor)}
              disabled={busy === editor.id}
            >
              <Icon name={(editor.icon ?? 'folder') as IconName} size={13} />
              <span>{editor.label}</span>
              {editor.id === preferred ? (
                <Icon name="check" size={12} />
              ) : null}
            </button>
          ))}
          {unavailable.length > 0 ? (
            <>
              <div className="handoff-menu-divider" />
              <div className="handoff-menu-section">Not installed</div>
              {unavailable.map((editor) => (
                <button
                  key={editor.id}
                  type="button"
                  className="handoff-menu-item dim"
                  role="menuitem"
                  data-testid={`handoff-menu-item-${editor.id}`}
                  onClick={() => void launch(editor)}
                  disabled={busy === editor.id}
                  title={`${editor.label} — not detected on $PATH`}
                >
                  <Icon name={(editor.icon ?? 'folder') as IconName} size={13} />
                  <span>{editor.label}</span>
                </button>
              ))}
            </>
          ) : null}
          {error ? (
            <>
              <div className="handoff-menu-divider" />
              <div className="handoff-menu-error">{error}</div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
