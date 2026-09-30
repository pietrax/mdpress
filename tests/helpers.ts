import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';

/** true when pandoc and typst are installed: integration tests only run in that case. */
export const hasTools = ['pandoc', 'typst'].every((cmd) => spawnSync(cmd, ['--version']).status === 0);

export function tempDir(prefix = 'mdpress-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Solid-colour RGB PNG, for test logos and images. */
export function makePng(width: number, height: number, rgb: [number, number, number] = [11, 61, 145]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function unzipText(zip: Buffer, path: string): Promise<string | null> {
  const file = (await JSZip.loadAsync(zip)).file(path);
  return file ? file.async('string') : null;
}

export function pdfPageCount(pdf: Buffer): number {
  const m = /\/Type\s*\/Pages\s*\/Count (\d+)/.exec(pdf.toString('latin1'));
  return m ? Number(m[1]) : -1;
}
