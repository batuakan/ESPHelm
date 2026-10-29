import { createHash } from 'node:crypto';
import type { Layout } from '@esphelm/schema';

/** The exact bytes served to devices: compact JSON (small for C3/C6 devices). */
export function serializeLayout(layout: Layout): Buffer {
  return Buffer.from(JSON.stringify(layout), 'utf8');
}

/** Strong ETag derived from the served bytes, so it changes exactly when they do. */
export function etagOf(bytes: Buffer): string {
  return `"${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}"`;
}

/** RFC 9110 If-None-Match: a list of entity tags (weak comparison) or "*". */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === '*' || t.replace(/^W\//, '') === etag);
}
