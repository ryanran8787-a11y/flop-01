/** 零依賴 PNG/ICO 生成（tray 圖 + 視窗圖）。node scripts/make-icons.mjs */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets');
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([td, data])));
  return Buffer.concat([len, td, data, crc]);
}

/** 藍色圓形吉祥物佔位圖（RGBA）。 */
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const i = (y * size + x) * 4;
      if (d <= r) {
        const edge = Math.max(0, Math.min(1, (r - d) / (size * 0.06)));
        px[i] = 110; px[i + 1] = 178; px[i + 2] = 255;
        px[i + 3] = Math.round(255 * Math.min(1, edge + 0.15));
      } else {
        px[i + 3] = 0;
      }
    }
  }
  return px;
}

function png(size) {
  const raw = draw(size);
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.concat([Buffer.from([0]), raw.subarray(y * size * 4, (y + 1) * size * 4)]));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const p16 = png(16);
const p256 = png(256);
writeFileSync(join(outDir, 'tray.png'), p16);
writeFileSync(join(outDir, 'icon.png'), p256);

// ICO = PNG 內嵌（Vista+ 合法）
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; // 256 → 0
entry[1] = 0;
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(p256.length, 8);
entry.writeUInt32LE(6 + 16, 12);
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([head, entry, p256]));
console.log('icons written:', p16.length, p256.length);
