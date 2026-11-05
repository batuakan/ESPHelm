// Page tabs above the canvas: pick a page, add one (grid, wind rose, or a starter page),
// rename, reorder and delete it, start over from a starter layout, or share the layout (a file,
// or another display's layout, ADR-0027). The display shows the pages in this order and steps
// through them with its footer buttons.
import { useRef, useState } from 'react';
import { LABEL_PATTERN, TEMPLATES, type Layout } from '@esphelm/schema';
import type { NewPageKind } from '../layoutOps';

const LABEL_RE = new RegExp(LABEL_PATTERN, 'u');

/** Widgets a page needs from the display's firmware. */
export function pageWidgets(page: Layout['pages'][number]): string[] {
  return page.kind === 'grid' ? [...new Set(page.tiles.map((t) => t.type))] : [page.kind];
}

/** Starter layouts, the denser "-720" ones first on large displays (shorter side >= 600 px). */
export function orderedTemplates(largeDisplay: boolean): Layout[] {
  const all = Object.values(TEMPLATES);
  const large = all.filter((t) => t.id.endsWith('-720'));
  const small = all.filter((t) => !t.id.endsWith('-720'));
  return largeDisplay ? [...large, ...small] : [...small, ...large];
}

export function templateSupported(template: Layout, supported: Set<string>): boolean {
  return template.pages.every((p) => pageWidgets(p).every((w) => supported.has(w)));
}

/** Another display with a layout of its own to copy or link to. */
export interface OtherDisplay {
  id: string;
  name: string;
}

/** The Share menu (ADR-0027). */
export interface ShareProps {
  /** Other displays that have a layout. */
  others: OtherDisplay[];
  /** Names of the other displays that show this same layout (linked). */
  sharedWith: string[];
  /** Edits not sent yet. */
  dirty: boolean;
  onExport(): void;
  onImportFile(file: File): void;
  onCopyFrom(deviceId: string): void;
  onLinkTo(deviceId: string): void;
  /** Gives this display a layout of its own again; absent when it already has one. */
  onSeparate?(): void;
}

interface Props {
  layout: Layout;
  index: number;
  supported: Set<string>;
  /** The display's shorter side is at least 600 px. */
  largeDisplay: boolean;
  onSelect(index: number): void;
  onAdd(kind: NewPageKind): void;
  onAddTemplate(id: string): void;
  onApplyTemplate(id: string): void;
  onRename(title: string): void;
  onMove(delta: number): void;
  onDelete(): void;
  share: ShareProps;
}

export function PageTabs(props: Props) {
  const { layout, index, supported } = props;
  const [menu, setMenu] = useState<'add' | 'template' | 'share' | null>(null);
  const [confirmApply, setConfirmApply] = useState<string | null>(null);
  const [pickedOther, setPickedOther] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const share = props.share;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const page = layout.pages[index];
  const title = page?.title ?? '';
  const templates = orderedTemplates(props.largeDisplay);

  const close = () => {
    setMenu(null);
    setConfirmApply(null);
    setPickedOther(null);
  };

  return (
    <div className="page-tabs">
      <div className="tabs-row">
      <div className="tabs" role="tablist" aria-label="Pages">
        {layout.pages.map((p, i) => {
          const missing = pageWidgets(p).filter((w) => !supported.has(w));
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={i === index}
              className={`tab ${i === index ? 'on' : ''} ${missing.length > 0 ? 'unsupported' : ''}`}
              title={missing.length > 0 ? `This display cannot show: ${missing.join(', ')}` : undefined}
              onClick={() => {
                props.onSelect(i);
                setConfirmDelete(false);
              }}
            >
              {p.title ?? p.id}
            </button>
          );
        })}
        <button
          className="tab add"
          aria-label="Add page"
          aria-expanded={menu === 'add'}
          onClick={() => setMenu(menu === 'add' ? null : 'add')}
        >
          +
        </button>
      </div>
      {/* Outside the scrolling tabs: always in view, however many pages there are. */}
      <div className="tab-actions">
        <button
          className="tab template"
          aria-expanded={menu === 'template'}
          onClick={() => setMenu(menu === 'template' ? null : 'template')}
        >
          Templates
        </button>
        <button
          className="tab share"
          aria-expanded={menu === 'share'}
          onClick={() => (menu === 'share' ? close() : setMenu('share'))}
        >
          Share
        </button>
      </div>
      </div>
      {share.sharedWith.length > 0 && (
        <p className="shared-with hint">
          Shared with {share.sharedWith.join(', ')}: editing this layout changes those displays too.
        </p>
      )}

      {menu === 'add' && (
        <div className="menu" role="menu" aria-label="Add page">
          <button role="menuitem" onClick={() => (props.onAdd('grid'), close())}>
            Grid page
          </button>
          <button
            role="menuitem"
            disabled={!supported.has('wind_rose')}
            onClick={() => (props.onAdd('wind_rose'), close())}
          >
            Wind rose page{!supported.has('wind_rose') && ' (not supported)'}
          </button>
          <button
            role="menuitem"
            disabled={!supported.has('autopilot')}
            onClick={() => (props.onAdd('autopilot'), close())}
          >
            Autopilot page{!supported.has('autopilot') && ' (not supported)'}
          </button>
          <button
            role="menuitem"
            disabled={!supported.has('chart')}
            title={supported.has('chart') ? undefined : 'Charts need a display with PSRAM'}
            onClick={() => (props.onAdd('chart'), close())}
          >
            Chart page{!supported.has('chart') && ' (not supported)'}
          </button>
          {templates.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              disabled={!templateSupported(t, supported)}
              onClick={() => (props.onAddTemplate(t.id), close())}
            >
              Starter: {t.name ?? t.id}{!templateSupported(t, supported) && ' (not supported)'}
            </button>
          ))}
        </div>
      )}

      {menu === 'template' && (
        <div className="menu" role="menu" aria-label="Start from template">
          <p className="hint">Replaces every page of this display's layout.</p>
          {templates.map((t) =>
            confirmApply === t.id ? (
              <div key={t.id} className="confirm">
                Replace all pages with “{t.name ?? t.id}”?
                <button className="danger small" onClick={() => (props.onApplyTemplate(t.id), close())}>
                  Replace
                </button>
                <button className="small" onClick={() => setConfirmApply(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                key={t.id}
                role="menuitem"
                disabled={!templateSupported(t, supported)}
                onClick={() => setConfirmApply(t.id)}
              >
                {t.name ?? t.id}
                {!templateSupported(t, supported) && ' (not supported)'}
              </button>
            ),
          )}
        </div>
      )}

      {menu === 'share' && (
        <div className="menu" role="menu" aria-label="Share layout">
          <button role="menuitem" onClick={() => (share.onExport(), close())}>
            Export file{share.dirty && ' (includes changes not yet sent)'}
          </button>
          <button role="menuitem" onClick={() => fileInput.current?.click()}>
            Import file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Layout file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // the same file can be picked again
              if (file) {
                share.onImportFile(file);
                close();
              }
            }}
          />
          {share.onSeparate && (
            <button role="menuitem" onClick={() => (share.onSeparate?.(), close())}>
              Make a separate copy (sent with Save &amp; send)
            </button>
          )}
          {share.others.length > 0 && <p className="hint">Use another display's layout:</p>}
          {share.others.map((o) =>
            pickedOther === o.id ? (
              <div key={o.id} className="confirm">
                <span>
                  <b>Copy</b> puts its pages here to edit on their own. <b>Link</b> makes both displays
                  show one layout; editing it changes both.
                  {share.dirty && ' Your changes not yet sent are lost.'}
                </span>
                <button className="small" onClick={() => (share.onCopyFrom(o.id), close())}>
                  Copy
                </button>
                <button className="small" onClick={() => (share.onLinkTo(o.id), close())}>
                  Link
                </button>
                <button className="small" onClick={() => setPickedOther(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button key={o.id} role="menuitem" onClick={() => setPickedOther(o.id)}>
                {o.name}
              </button>
            ),
          )}
        </div>
      )}

      {page && (
        <div className="page-tools">
          <label className="page-title">
            <span className="sr-only">Page title</span>
            <input
              value={title}
              placeholder={page.id}
              onChange={(e) => props.onRename(e.target.value)}
              aria-label="Page title"
              aria-invalid={!LABEL_RE.test(title)}
            />
          </label>
          <button
            className="small"
            disabled={index === 0}
            onClick={() => props.onMove(-1)}
            aria-label="Move page left"
          >
            ←
          </button>
          <button
            className="small"
            disabled={index + 1 >= layout.pages.length}
            onClick={() => props.onMove(1)}
            aria-label="Move page right"
          >
            →
          </button>
          {confirmDelete ? (
            <>
              <button
                className="danger small"
                onClick={() => {
                  props.onDelete();
                  setConfirmDelete(false);
                }}
              >
                Delete “{page.title ?? page.id}”
              </button>
              <button className="small" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              className="small"
              disabled={layout.pages.length <= 1}
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete page"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
