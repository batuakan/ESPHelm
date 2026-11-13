import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Firmware images for updates from the editor (ADR-0036).
 *
 * Every ESPHelm image carries a marker string compiled in by the runtime
 * (`ESPHELM-IMAGE/1 fw=<version> board=<board> kind=<color|mono>`), from which an uploaded file
 * is matched to the displays that can take it. Its build id is what the display reports in
 * `hello.fw.build` once it runs it: the app descriptor's app_elf_sha256 for an ESP32 app image,
 * the sha256 of the file for a host (SDL) program.
 */

export type ImageKind = 'color' | 'mono';
export type ImageFormat = 'esp32' | 'elf';
export type ImageSource = 'upload' | 'github';

export interface FirmwareImage {
  buildId: string;
  version: string;
  board: string;
  kind: ImageKind;
  format: ImageFormat;
  size: number;
  md5: string;
  sha256: string;
  source: ImageSource;
  added: string;
}

export type ParsedImage = Omit<FirmwareImage, 'source' | 'added'>;

export type ParseResult =
  { ok: true; image: ParsedImage } | { ok: false; error: ImageError; message: string };

export type ImageError =
  'TOO_SMALL' | 'TOO_LARGE' | 'FACTORY_IMAGE' | 'UNKNOWN_FORMAT' | 'NO_MARKER' | 'AMBIGUOUS_MARKER';

/** Largest image accepted, as the display checks the offer (firmware_update.cpp). */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

const MARKER_PREFIX = Buffer.from('ESPHELM-IMAGE/1 ', 'latin1');
const MARKER_RE =
  /^ESPHELM-IMAGE\/1 fw=([0-9A-Za-z._-]{1,31}) board=([0-9A-Za-z._-]{1,64}) kind=(color|mono)$/;

const ESP_IMAGE_MAGIC = 0xe9;
/** esp_app_desc_t follows the 24-byte image header and the first 8-byte segment header. */
const APP_DESC_OFFSET = 0x20;
const APP_DESC_MAGIC = 0xabcd5432;
/** app_elf_sha256 within esp_app_desc_t (magic, secure_version, reserv1[2], version, project_name, time, date, idf_ver). */
const APP_ELF_SHA256_OFFSET = 0x90;

/** Every marker in the image; they must all agree. */
function findMarkers(bytes: Buffer): string[] {
  const found = new Set<string>();
  let at = bytes.indexOf(MARKER_PREFIX);
  while (at >= 0) {
    const end = bytes.indexOf(0, at);
    const text = bytes.toString('latin1', at, end < 0 ? Math.min(bytes.length, at + 160) : end);
    if (MARKER_RE.test(text)) found.add(text);
    at = bytes.indexOf(MARKER_PREFIX, at + 1);
  }
  return [...found];
}

export function parseImage(bytes: Buffer): ParseResult {
  if (bytes.length < 1024) {
    return { ok: false, error: 'TOO_SMALL', message: 'this is not a firmware image (too small)' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'TOO_LARGE', message: 'the image is larger than 64 MB' };
  }
  const markers = findMarkers(bytes);
  const factory: ParseResult = {
    ok: false,
    error: 'FACTORY_IMAGE',
    message:
      'this looks like a factory image (bootloader and partitions); upload the OTA image (firmware.ota.bin)',
  };
  let format: ImageFormat;
  let buildId: string;
  if (bytes[0] === ESP_IMAGE_MAGIC) {
    // A factory image starting with the bootloader has the bootloader's descriptor here.
    if (bytes.readUInt32LE(APP_DESC_OFFSET) !== APP_DESC_MAGIC) return factory;
    format = 'esp32';
    buildId = bytes
      .subarray(
        APP_DESC_OFFSET + APP_ELF_SHA256_OFFSET,
        APP_DESC_OFFSET + APP_ELF_SHA256_OFFSET + 32,
      )
      .toString('hex');
  } else if (bytes.readUInt32BE(0) === 0x7f454c46) {
    format = 'elf';
    buildId = createHash('sha256').update(bytes).digest('hex');
  } else if (markers.length > 0) {
    return factory; // ESPHelm firmware, with the bootloader further in (the P4's is at 0x2000)
  } else {
    return {
      ok: false,
      error: 'UNKNOWN_FORMAT',
      message: 'this is neither an ESP32 app image nor a host program',
    };
  }
  if (markers.length === 0) {
    return {
      ok: false,
      error: 'NO_MARKER',
      message: 'this image is not ESPHelm firmware (or older than 0.4.0, which had no updates)',
    };
  }
  if (markers.length > 1) {
    return { ok: false, error: 'AMBIGUOUS_MARKER', message: 'the image names more than one board' };
  }
  const [, version, board, kind] = MARKER_RE.exec(markers[0]!)!;
  return {
    ok: true,
    image: {
      buildId,
      version: version!,
      board: board!,
      kind: kind as ImageKind,
      format,
      size: bytes.length,
      md5: createHash('md5').update(bytes).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

/** Compare dotted versions numerically ("0.10.0" > "0.9.1"); a non-numeric part compares as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y);
    if (c !== 0) return Math.sign(c);
  }
  return 0;
}

/** Images kept per board and tile set; older ones are removed when a new one is added. */
export const KEEP_PER_BOARD = 2;

/**
 * Images under <dataDir>/firmware: <buildId>.bin plus firmware.json (the index). The index is
 * checked against the files on load; an entry without its file is dropped.
 */
export class FirmwareStore {
  private readonly dir: string;
  private readonly indexFile: string;
  private images = new Map<string, FirmwareImage>();

  constructor(
    dataDir: string,
    private readonly reportProblem: (message: string) => void,
  ) {
    this.dir = join(dataDir, 'firmware');
    this.indexFile = join(this.dir, 'firmware.json');
  }

  load(): void {
    mkdirSync(this.dir, { recursive: true });
    this.images.clear();
    let raw: unknown = [];
    try {
      raw = JSON.parse(readFileSync(this.indexFile, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.reportProblem(`firmware.json could not be read: ${(e as Error).message}`);
      }
    }
    for (const entry of Array.isArray(raw) ? (raw as FirmwareImage[]) : []) {
      if (typeof entry?.buildId !== 'string' || !/^[0-9a-f]{64}$/.test(entry.buildId)) continue;
      try {
        const size = statSync(this.file(entry.buildId)).size;
        if (size === entry.size) this.images.set(entry.buildId, entry);
      } catch {
        // file gone: drop the entry
      }
    }
  }

  list(): FirmwareImage[] {
    return [...this.images.values()].sort(
      (a, b) => compareVersions(b.version, a.version) || b.added.localeCompare(a.added),
    );
  }

  get(buildId: string): FirmwareImage | undefined {
    return this.images.get(buildId);
  }

  bytes(buildId: string): Buffer {
    return readFileSync(this.file(buildId));
  }

  path(buildId: string): string {
    return this.file(buildId);
  }

  /**
   * Store a parsed image. Older images of the same board and tile set beyond KEEP_PER_BOARD
   * are removed, except those in `keep` (targets of updates in progress).
   */
  add(
    parsed: ParsedImage,
    bytes: Buffer,
    source: ImageSource,
    now: Date,
    keep: ReadonlySet<string> = new Set(),
  ): { image: FirmwareImage; created: boolean; removed: string[] } {
    const existing = this.images.get(parsed.buildId);
    if (existing) return { image: existing, created: false, removed: [] };
    const tmp = `${this.file(parsed.buildId)}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, this.file(parsed.buildId));
    const image: FirmwareImage = { ...parsed, source, added: now.toISOString() };
    this.images.set(image.buildId, image);
    const removed = this.list()
      .filter((i) => i.board === image.board && i.kind === image.kind)
      .slice(KEEP_PER_BOARD)
      .filter((i) => i.buildId !== image.buildId && !keep.has(i.buildId))
      .map((i) => i.buildId);
    for (const id of removed) this.removeFile(id);
    this.save();
    return { image, created: true, removed };
  }

  delete(buildId: string): boolean {
    if (!this.images.has(buildId)) return false;
    this.removeFile(buildId);
    this.save();
    return true;
  }

  private removeFile(buildId: string): void {
    rmSync(this.file(buildId), { force: true });
    this.images.delete(buildId);
  }

  private file(buildId: string): string {
    return join(this.dir, `${buildId}.bin`);
  }

  private save(): void {
    const tmp = `${this.indexFile}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify([...this.images.values()], null, 2)}\n`);
    renameSync(tmp, this.indexFile);
  }
}

/** One image in a release's manifest.json (written by .github/workflows/release.yml). */
export interface ManifestImage {
  board: string;
  kind: ImageKind;
  version: string;
  file: string;
  size: number;
  md5: string;
  sha256: string;
}

/** The latest release's assets, fetched only when an admin presses Check GitHub (no phoning home). */
export const GITHUB_RELEASES = 'https://github.com/batuakan/ESPHelm/releases/latest/download/';

export function parseManifest(body: unknown): ManifestImage[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const images = (body as { images?: unknown }).images;
  if (!Array.isArray(images)) return undefined;
  const ok = images.filter(
    (i): i is ManifestImage =>
      typeof i === 'object' &&
      i !== null &&
      typeof i.board === 'string' &&
      (i.kind === 'color' || i.kind === 'mono') &&
      typeof i.version === 'string' &&
      typeof i.file === 'string' &&
      /^[0-9A-Za-z._-]+$/.test(i.file) &&
      Number.isInteger(i.size) &&
      i.size > 0 &&
      i.size <= MAX_IMAGE_BYTES &&
      typeof i.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(i.sha256),
  );
  return ok.length === images.length ? ok : undefined;
}
