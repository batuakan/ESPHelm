// The bar above the page tabs, for what applies to the whole layout rather than one page: start
// over from a starter layout, share it (a file, or another display's layout, ADR-0027), the
// display's theme and its settings (ADR-0015).
import { useRef, useState, type ReactNode } from 'react';
import { orderedTemplates, templateSupported } from './PageTabs';

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
  supported: Set<string>;
  /** The display's shorter side is at least 600 px. */
  largeDisplay: boolean;
  onApplyTemplate(id: string): void;
  share: ShareProps;
  /** The display theme and settings controls, after the menus. */
  children?: ReactNode;
}

export function LayoutBar(props: Props) {
  const { supported, share } = props;
  const [menu, setMenu] = useState<'template' | 'share' | null>(null);
  const [confirmApply, setConfirmApply] = useState<string | null>(null);
  const [pickedOther, setPickedOther] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const templates = orderedTemplates(props.largeDisplay);

  const close = () => {
    setMenu(null);
    setConfirmApply(null);
    setPickedOther(null);
  };

  return (
    <div className="layout-bar-wrap">
      <div className="menu-anchor">
        <div className="layout-bar" role="toolbar" aria-label="Layout">
          <button
            className="small"
            aria-expanded={menu === 'template'}
            onClick={() => (menu === 'template' ? close() : (close(), setMenu('template')))}
          >
            Templates
          </button>
          <button
            className="small"
            aria-expanded={menu === 'share'}
            onClick={() => (menu === 'share' ? close() : (close(), setMenu('share')))}
          >
            Share
          </button>
          {props.children}
        </div>
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
      </div>
      {share.sharedWith.length > 0 && (
        <p className="shared-with hint">
          Shared with {share.sharedWith.join(', ')}: editing this layout changes those displays too.
        </p>
      )}
    </div>
  );
}
