/**
 * Writes a layout cache record the way the firmware stores it (layout_store.cpp), so a host
 * build can start offline with a given layout:
 *   magic "EHHL" (u32 LE) | body_len (u32 LE) | crc32 over etag_len..body (u32 LE) | etag_len (u8) | etag | body
 */
import { crc32 } from 'node:zlib';

export function cacheRecord(body: string, etag: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const etagBuf = Buffer.from(etag, 'utf8');
  if (etagBuf.length > 255) throw new Error('etag too long');
  const payload = Buffer.concat([Buffer.from([etagBuf.length]), etagBuf, bodyBuf]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x4c484845, 0);
  header.writeUInt32LE(bodyBuf.length, 4);
  header.writeUInt32LE(crc32(payload), 8);
  return Buffer.concat([header, payload]);
}
