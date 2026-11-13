// Firmware images and updates (ADR-0036): upload an image, or fetch the latest release from
// GitHub when asked (nothing checks by itself), and update a display that can take one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, Device, FirmwareImage } from '../api';

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function FirmwareDialog(props: {
  api: Api;
  devices: Device[];
  displayName(d: Device): string;
  onChanged(): void;
  onClose(): void;
}) {
  const { api, onChanged } = props;
  const [images, setImages] = useState<FirmwareImage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ device: string; buildId: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setImages(await api.firmware());
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (what: string, action: () => Promise<string>) => {
    setBusy(what);
    setMessage(null);
    try {
      setMessage({ kind: 'info', text: await action() });
      await load();
      onChanged();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const upload = (file: File) =>
    run('upload', async () => {
      const image = await api.uploadFirmware(file);
      return `Added ${image.version} for ${image.board}.`;
    });
  const github = () =>
    run('github', async () => {
      const r = await api.checkGithub();
      const failed = r.errors.map((e) => `${e.file}: ${e.message}`).join('; ');
      if (failed) throw new Error(`Some images could not be fetched: ${failed}`);
      return r.added.length > 0
        ? `Added ${r.added.map((i) => `${i.version} for ${i.board}`).join(', ')}.`
        : 'No new images for the displays here.';
    });

  const byId = new Map(props.devices.map((d) => [d.id, d]));
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="panel firmware-dialog"
        role="dialog"
        aria-label="Firmware"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <h2>Firmware</h2>
          <button className="small" onClick={props.onClose}>
            Close
          </button>
        </div>
        <p className="hint">
          Upload an image (<code>firmware.ota.bin</code> from a release or your own build), or fetch the
          latest release. A display updates over the network and restarts; one that fails to start goes
          back to its old firmware. The first install is over USB.
        </p>
        <div className="firmware-actions">
          <button className="primary small" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            {busy === 'upload' ? 'Uploading…' : 'Upload .bin'}
          </button>
          <button className="small" disabled={busy !== null} onClick={() => void github()}>
            {busy === 'github' ? 'Checking…' : 'Check GitHub for updates'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".bin,application/octet-stream"
            hidden
            aria-label="Firmware image"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </div>
        {message && (
          <div className={`banner ${message.kind}`} role="status">
            {message.text}
          </div>
        )}
        {images === null ? (
          <p className="hint">Loading…</p>
        ) : images.length === 0 ? (
          <p className="hint">No images yet.</p>
        ) : (
          <ul className="firmware-images">
            {images.map((image) => (
              <li key={image.buildId}>
                <div className="firmware-image">
                  <strong>{image.version}</strong>
                  <span className="device-meta">
                    {image.board}
                    {image.kind === 'mono' ? ' · black and white' : ''} · {sizeText(image.size)} ·{' '}
                    {image.source === 'github' ? 'GitHub' : 'uploaded'} · <code>{image.buildId.slice(0, 8)}</code>
                  </span>
                  <button
                    className="small"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('delete', async () => {
                        await api.deleteFirmware(image.buildId);
                        return `Deleted ${image.version}.`;
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
                {image.devices.length === 0 && <span className="hint">No display here takes this image.</span>}
                <ul>
                  {image.devices.map((id) => {
                    const d = byId.get(id);
                    if (!d) return null;
                    const running = d.hello.fw.build === image.buildId;
                    const busyUpdate =
                      d.update && ['requested', 'downloading', 'installing'].includes(d.update.state);
                    const asking = confirm?.device === id && confirm.buildId === image.buildId;
                    return (
                      <li key={id} className="firmware-device">
                        <span>
                          {props.displayName(d)} <span className="device-meta">runs {d.hello.fw.version}</span>
                        </span>
                        {running ? (
                          <span className="device-meta">running</span>
                        ) : d.state !== 'adopted' ? (
                          <span className="device-meta">adopt it first</span>
                        ) : busyUpdate ? (
                          <span className="device-meta">updating…</span>
                        ) : asking ? (
                          <span className="firmware-confirm">
                            <span className="device-meta">The display restarts.</span>
                            <button
                              className="primary small"
                              onClick={() => {
                                setConfirm(null);
                                void run('update', async () => {
                                  await api.requestUpdate(id, image.buildId);
                                  return `${props.displayName(d)} is updating to ${image.version}.`;
                                });
                              }}
                            >
                              Update
                            </button>
                            <button className="small" onClick={() => setConfirm(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="small"
                            disabled={busy !== null}
                            onClick={() => setConfirm({ device: id, buildId: image.buildId })}
                          >
                            Install
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
