// Home composer settings strip — promotes two settings that today live
// inside the New Project modal to first-class chips below the prompt
// textarea (image 1 of the design brief):
//
//   1. Working directory — the parent folder the user wants the project
//      to live in. Surfaces openFolderDialog; selected path is stored
//      in HomeView state and threaded through to PluginLoopSubmit. The
//      daemon's project-create flow does not move user files; this chip
//      records intent for the agent + for future automation.
//   2. Design system — searchable dropdown + preview swatches. Used to
//      stamp designSystemId on the created project; the agent then
//      composes the system prompt against that design system.
//
// Both chips intentionally render inline (not modal) so the user can
// scan and adjust before pressing Enter. The design system popover
// supports keyboard search and shows a swatch strip + summary preview
// per entry, mirroring the user's brief: "支持下拉框搜索和选择,还有
// 预览设计系统".

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesignSystemSummary } from '@open-design/contracts';
import { useI18n } from '../i18n';
import {
  localizeDesignSystemCategory,
  localizeDesignSystemSummary,
} from '../i18n/content';
import {
  fetchDesignSystemPreview,
  openFolderDialog,
} from '../providers/registry';
import { Icon } from './Icon';

interface Props {
  // Chosen parent directory the user wants the project to live in. Null
  // means "use the daemon's default location (.od/projects/<id>/)".
  workingDir: string | null;
  onChangeWorkingDir: (dir: string | null) => void;
  designSystems: DesignSystemSummary[];
  designSystemsLoading: boolean;
  selectedDesignSystemId: string | null;
  onChangeDesignSystemId: (id: string | null) => void;
  // 'block' = standalone strip below the composer (original placement).
  // 'inline' = compact chips that live inside the composer's footer-left
  // slot. Inline drops the strip-level width cap and outer margins so
  // the chips line up with the attach button instead of forming a row
  // of their own.
  variant?: 'block' | 'inline';
}

export function HomeHeroSettingsChips({
  workingDir,
  onChangeWorkingDir,
  designSystems,
  designSystemsLoading,
  selectedDesignSystemId,
  onChangeDesignSystemId,
  variant = 'block',
}: Props) {
  const { locale, t } = useI18n();
  const selectedDs = useMemo(
    () => designSystems.find((d) => d.id === selectedDesignSystemId) ?? null,
    [designSystems, selectedDesignSystemId],
  );

  const [dsOpen, setDsOpen] = useState(false);
  const [dsQuery, setDsQuery] = useState('');
  const [hoveredDs, setHoveredDs] = useState<DesignSystemSummary | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const dsWrapRef = useRef<HTMLDivElement | null>(null);
  const dsInputRef = useRef<HTMLInputElement | null>(null);
  const [dirError, setDirError] = useState<string | null>(null);

  useEffect(() => {
    if (!dsOpen) return;
    function onPointer(e: MouseEvent) {
      if (dsWrapRef.current?.contains(e.target as Node)) return;
      setDsOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDsOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [dsOpen]);

  useEffect(() => {
    if (dsOpen) {
      // Focus the search box when the popover opens so the user can
      // start typing immediately — matches the picker affordances in
      // the daemon CLI (`od design-systems list --filter <q>`).
      window.setTimeout(() => dsInputRef.current?.focus(), 0);
    } else {
      setDsQuery('');
      setHoveredDs(null);
      setFullscreenPreview(false);
    }
  }, [dsOpen]);

  useEffect(() => {
    if (!fullscreenPreview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreenPreview(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreenPreview]);

  const previewTarget = hoveredDs ?? selectedDs ?? null;
  useEffect(() => {
    if (!previewTarget) {
      setPreviewHtml(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void fetchDesignSystemPreview(previewTarget.id)
      .then((html) => {
        if (cancelled) return;
        setPreviewHtml(html);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewHtml(null);
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewTarget?.id]);

  const filteredDs = useMemo(() => {
    const q = dsQuery.trim().toLowerCase();
    if (q.length === 0) return designSystems;
    return designSystems.filter((d) => {
      const localizedSummary = localizeDesignSystemSummary(locale, d);
      const localizedCategory = localizeDesignSystemCategory(locale, d.category);
      const haystack = `${d.title} ${d.category} ${d.summary} ${localizedCategory} ${localizedSummary}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [dsQuery, designSystems, locale]);

  // Fire the native dialog request without queueing a React re-render
  // first — the OS dialog is modal, so disabling the button beforehand
  // just adds a perceived 100-500ms of "click → render → fetch" delay
  // before the picker actually appears. We update state only on the
  // way back from the dialog.
  function handlePickDir() {
    void (async () => {
      try {
        const picked = await openFolderDialog();
        if (picked) {
          onChangeWorkingDir(picked);
          setDirError(null);
        } else {
          setDirError(t('workingDirPicker.unavailable'));
        }
      } catch (err) {
        setDirError(err instanceof Error ? err.message : String(err));
      }
    })();
  }

  const shortDir = workingDir
    ? workingDir.split('/').filter(Boolean).slice(-1)[0] ?? workingDir
    : null;

  return (
    <div
      className={`home-hero__settings${variant === 'inline' ? ' home-hero__settings--inline' : ''}`}
      data-testid="home-hero-settings"
    >
      <button
        type="button"
        className={`home-hero__setting-chip${workingDir ? ' picked' : ''}`}
        data-testid="home-hero-working-dir-chip"
        onClick={handlePickDir}
        title={workingDir ?? t('workingDirPicker.homeTitle')}
      >
        <Icon name="folder" size={13} />
        <span>{workingDir ? shortDir : t('workingDirPicker.select')}</span>
        {workingDir ? (
          <span
            className="home-hero__setting-chip-clear"
            data-testid="home-hero-working-dir-clear"
            onClick={(e) => {
              e.stopPropagation();
              onChangeWorkingDir(null);
            }}
            role="button"
            aria-label={t('workingDirPicker.clearAria')}
          >
            <Icon name="close" size={11} />
          </span>
        ) : null}
      </button>

      <div
        ref={dsWrapRef}
        className={`home-hero__setting-chip-wrap${dsOpen ? ' open' : ''}`}
      >
        <button
          type="button"
          className={`home-hero__setting-chip${selectedDs ? ' picked' : ''}`}
          data-testid="home-hero-design-system-chip"
          onClick={() => setDsOpen((v) => !v)}
          disabled={designSystemsLoading}
          title={selectedDs?.title ?? t('designSystemPicker.select')}
        >
          <Icon name="palette" size={13} />
          <span>
            {designSystemsLoading
              ? t('designSystemPicker.loading')
              : selectedDs?.title ?? t('designSystemPicker.select')}
          </span>
          <Icon name="chevron-down" size={11} />
        </button>
        {dsOpen ? (
          <div
            className="home-hero__design-system-popover"
            data-testid="home-hero-design-system-popover"
          >
            <div className="home-hero__design-system-search">
              <Icon name="search" size={12} />
              <input
                ref={dsInputRef}
                type="text"
                value={dsQuery}
                onChange={(e) => setDsQuery(e.target.value)}
                placeholder={t('designSystemPicker.searchPlaceholder')}
                data-testid="home-hero-design-system-search"
              />
            </div>
            <div className="home-hero__design-system-body">
              <div className="home-hero__design-system-list" role="listbox">
                <button
                  type="button"
                  className={`home-hero__design-system-option${selectedDesignSystemId == null ? ' active' : ''}`}
                  role="option"
                  aria-selected={selectedDesignSystemId == null}
                  onClick={() => {
                    onChangeDesignSystemId(null);
                    setDsOpen(false);
                  }}
                >
                  <span className="home-hero__design-system-option-title">{t('designSystemPicker.noneTitle')}</span>
                  <span className="home-hero__design-system-option-summary">
                    {t('designSystemPicker.noneSummary')}
                  </span>
                </button>
                {filteredDs.map((d) => {
                  const localizedCategory = localizeDesignSystemCategory(locale, d.category);
                  const localizedSummary = localizeDesignSystemSummary(locale, d);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className={`home-hero__design-system-option${d.id === selectedDesignSystemId ? ' active' : ''}`}
                      role="option"
                      aria-selected={d.id === selectedDesignSystemId}
                      onMouseEnter={() => setHoveredDs(d)}
                      onFocus={() => setHoveredDs(d)}
                      onClick={() => {
                        onChangeDesignSystemId(d.id);
                        setDsOpen(false);
                      }}
                      data-testid={`home-hero-design-system-option-${d.id}`}
                    >
                      <div className="home-hero__design-system-option-head">
                        <span className="home-hero__design-system-option-title">{d.title}</span>
                        {d.category ? (
                          <span className="home-hero__design-system-option-cat">{localizedCategory}</span>
                        ) : null}
                      </div>
                      {d.swatches && d.swatches.length > 0 ? (
                        <div className="home-hero__design-system-swatches">
                          {d.swatches.slice(0, 6).map((sw, i) => (
                            <span
                              key={`${d.id}-sw-${i}`}
                              className="home-hero__design-system-swatch"
                              style={{ background: sw }}
                            />
                          ))}
                        </div>
                      ) : null}
                      {localizedSummary ? (
                        <span className="home-hero__design-system-option-summary">{localizedSummary}</span>
                      ) : null}
                    </button>
                  );
                })}
                {filteredDs.length === 0 ? (
                  <div className="home-hero__design-system-empty">
                    {t('designSystemPicker.empty')}
                  </div>
                ) : null}
              </div>
              <div className="home-hero__design-system-preview" data-testid="home-hero-design-system-preview">
                {previewTarget ? (
                  <>
                    <div className="home-hero__design-system-preview-head">
                      <strong>{previewTarget.title}</strong>
                      {previewTarget.category ? (
                        <span className="home-hero__design-system-preview-cat">
                          {localizeDesignSystemCategory(locale, previewTarget.category)}
                        </span>
                      ) : null}
                      {previewHtml ? (
                        <button
                          type="button"
                          className="home-hero__design-system-preview-expand"
                          data-testid="home-hero-design-system-preview-expand"
                          onClick={() => setFullscreenPreview(true)}
                          title={t('designSystemPicker.openPreview')}
                          aria-label={t('designSystemPicker.openPreview')}
                        >
                          <Icon name="eye" size={16} strokeWidth={1.9} />
                        </button>
                      ) : null}
                    </div>
                    {previewTarget.summary ? (
                      <p className="home-hero__design-system-preview-summary">
                        {localizeDesignSystemSummary(locale, previewTarget)}
                      </p>
                    ) : null}
                    {previewTarget.swatches && previewTarget.swatches.length > 0 ? (
                      <div className="home-hero__design-system-preview-swatches">
                        {previewTarget.swatches.slice(0, 12).map((sw, i) => (
                          <span
                            key={`${previewTarget.id}-pv-sw-${i}`}
                            className="home-hero__design-system-preview-swatch"
                            style={{ background: sw }}
                            title={sw}
                          />
                        ))}
                      </div>
                    ) : null}
                    {previewLoading ? (
                      <div className="home-hero__design-system-preview-loading">
                        {t('designSystemPicker.loadingPreview')}
                      </div>
                    ) : previewHtml ? (
                      <iframe
                        className="home-hero__design-system-preview-frame"
                        srcDoc={previewHtml}
                        sandbox="allow-same-origin"
                        title={t('designSystemPicker.previewFrameTitle', { title: previewTarget.title })}
                      />
                    ) : (
                      <div className="home-hero__design-system-preview-empty">
                        {t('designSystemPicker.noPreview')}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="home-hero__design-system-preview-empty">
                    {t('designSystemPicker.previewHint')}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {dirError ? (
        <span className="home-hero__setting-hint">{dirError}</span>
      ) : null}
      {fullscreenPreview && previewTarget && previewHtml && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="home-hero__design-system-fullscreen"
              role="dialog"
              aria-label={t('designSystemPicker.fullscreenAria', { title: previewTarget.title })}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setFullscreenPreview(false);
                }
              }}
            >
              <div className="home-hero__design-system-fullscreen-frame">
                <div className="home-hero__design-system-fullscreen-head">
                  <div className="home-hero__design-system-fullscreen-title">
                    <strong>{previewTarget.title}</strong>
                    {previewTarget.category ? (
                      <span className="home-hero__design-system-preview-cat">
                        {localizeDesignSystemCategory(locale, previewTarget.category)}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="home-hero__design-system-fullscreen-close"
                    onClick={() => setFullscreenPreview(false)}
                    aria-label={t('designSystemPicker.closeFullscreen')}
                    title={t('designSystemPicker.closeEsc')}
                  >
                    <Icon name="close" size={18} strokeWidth={2.1} />
                  </button>
                </div>
                <iframe
                  className="home-hero__design-system-fullscreen-iframe"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  title={t('designSystemPicker.fullscreenFrameTitle', { title: previewTarget.title })}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
