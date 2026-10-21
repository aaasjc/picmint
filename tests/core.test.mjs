import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMATS,
  buildOutputName,
  crc32,
  createZip,
  extensionFor,
  fileStem,
  fitDimensions,
  formatBytes,
  savedPercent,
  toDosDateTime,
} from '../assets/js/image-core.js';

/* ==========================================================================
   formatBytes
   ========================================================================== */

test('formatBytes keeps raw bytes below 1 KB', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(1023), '1023 B');
});

test('formatBytes scales to KB / MB / GB', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB');
});

test('formatBytes drops decimals once the value is large', () => {
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
});

test('formatBytes rejects nonsense input', () => {
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(Number.NaN), '—');
  assert.equal(formatBytes('abc'), '—');
});

/* ==========================================================================
   Names
   ========================================================================== */

test('fileStem strips directories and the last extension', () => {
  assert.equal(fileStem('photo.jpg'), 'photo');
  assert.equal(fileStem('C:\\Users\\me\\photo.v2.png'), 'photo.v2');
  assert.equal(fileStem('/tmp/.hidden'), '.hidden');
  assert.equal(fileStem('no-extension'), 'no-extension');
});

test('fileStem removes characters Windows refuses', () => {
  assert.equal(fileStem('a<b>c:d.jpg'), 'a-b-c-d');
});

test('extensionFor maps logical formats to file extensions', () => {
  assert.equal(extensionFor('jpeg'), 'jpg');
  assert.equal(extensionFor('png'), 'png');
  assert.equal(extensionFor('webp'), 'webp');
  assert.equal(extensionFor('avif'), 'avif');
  assert.equal(extensionFor('nope'), 'webp');
});

test('buildOutputName composes stem, dimensions and suffix', () => {
  assert.equal(
    buildOutputName('sunset harbour.jpg', { width: 1280, height: 853, format: 'webp' }),
    'sunset harbour-1280x853.webp'
  );
  assert.equal(buildOutputName('a.png', { format: 'jpeg' }), 'a.jpg');
  assert.equal(buildOutputName('a.png', { width: 10, height: 20, format: 'png', suffix: 'card' }), 'a-10x20-card.png');
  assert.equal(buildOutputName('汉字 照片.jpeg', { width: 800, height: 600, format: 'avif' }), '汉字 照片-800x600.avif');
});

test('every format has a mime type and an extension', () => {
  for (const meta of Object.values(FORMATS)) {
    assert.match(meta.mime, /^image\//);
    assert.match(meta.ext, /^[a-z]+$/);
  }
});

/* ==========================================================================
   Geometry / ratios
   ========================================================================== */

test('fitDimensions shrinks the longest edge and keeps the ratio', () => {
  assert.deepEqual(fitDimensions(4000, 3000, 2000), { width: 2000, height: 1500, scaled: true });
  assert.deepEqual(fitDimensions(3000, 4000, 2000), { width: 1500, height: 2000, scaled: true });
});

test('fitDimensions never upscales', () => {
  assert.deepEqual(fitDimensions(800, 600, 2000), { width: 800, height: 600, scaled: false });
  assert.deepEqual(fitDimensions(800, 600, 0), { width: 800, height: 600, scaled: false });
});

test('fitDimensions returns at least 1px', () => {
  assert.deepEqual(fitDimensions(10000, 1, 1), { width: 1, height: 1, scaled: true });
});

test('savedPercent reports both savings and growth', () => {
  assert.equal(savedPercent(1000, 250), 75);
  assert.equal(savedPercent(1000, 1200), -20);
  assert.equal(savedPercent(0, 100), 0);
  assert.equal(savedPercent(1000, 1000), 0);
});

/* ==========================================================================
   ZIP writer
   ========================================================================== */

test('crc32 matches the IEEE check value', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('toDosDateTime encodes 2026-01-02 03:04:06', () => {
  const { time, date } = toDosDateTime(new Date(2026, 0, 2, 3, 4, 6));
  assert.equal(date, (46 << 9) | (1 << 5) | 2);
  assert.equal(time, (3 << 11) | (4 << 5) | 3);
});

test('createZip produces a readable archive structure', async () => {
  const encoder = new TextEncoder();
  const files = [
    { name: 'hello.txt', data: encoder.encode('hello picmint') },
    { name: '图片/样例.bin', data: new Uint8Array([0, 1, 2, 250, 255]) },
  ];

  const zip = createZip(files, { date: new Date(2026, 0, 2, 3, 4, 6) });
  const bytes = new Uint8Array(await zip.arrayBuffer());

  // Local file header signature.
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);

  // End of central directory is the last 22 bytes when there is no comment.
  const eocd = bytes.length - 22;
  assert.deepEqual(Array.from(bytes.slice(eocd, eocd + 4)), [0x50, 0x4b, 0x05, 0x06]);

  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(eocd + 8, true), 2, 'entries on disk');
  assert.equal(view.getUint16(eocd + 10, true), 2, 'total entries');

  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.deepEqual(Array.from(bytes.slice(centralOffset, centralOffset + 4)), [0x50, 0x4b, 0x01, 0x02]);
  assert.equal(centralOffset + centralSize, eocd);

  // First local entry carries the right name, size and CRC.
  const nameLength = view.getUint16(26, true);
  const firstCrc = view.getUint32(14, true);
  const firstSize = view.getUint32(22, true);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + nameLength)), 'hello.txt');
  assert.equal(firstSize, 13);
  assert.equal(firstCrc, crc32(encoder.encode('hello picmint')));

  // UTF-8 flag is set so Chinese names survive on Windows.
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800);
});

test('createZip emits one central header per entry', async () => {
  const encoder = new TextEncoder();
  const files = ['a.txt', 'b.txt', 'c.txt'].map((name) => ({ name, data: encoder.encode(name) }));
  const bytes = new Uint8Array(await createZip(files).arrayBuffer());

  let count = 0;
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) count += 1;
  }
  assert.equal(count, 3);
});
