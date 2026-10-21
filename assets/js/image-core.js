/**
 * PicMint — image core
 * ---------------------------------------------------------------------------
 * Pure helpers live at the top so they can be unit-tested in Node without a
 * DOM. Browser-only routines (decode / encode / compose) sit at the bottom and
 * are only touched at call time.
 *
 * Design rule: no third-party dependency, ever. The ZIP writer below is ~90
 * lines of stored (uncompressed) ZIP so batch export works offline.
 */

/* ==========================================================================
   Constants
   ========================================================================== */

export const FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF' },
};

export const BEAUTIFY_BACKGROUNDS = {
  aurora: ['#4ce0b3', '#5bc8ff', '#9a63ff'],
  sunset: ['#ffb36b', '#ff6b8b', '#8f5bff'],
  graphite: ['#1b1f27', '#2b3240', '#11141a'],
  paper: ['#ffffff', '#f2f5f3', '#e3e9e5'],
};

/* ==========================================================================
   Pure helpers (unit-tested)
   ========================================================================== */

/**
 * Human readable byte size. Keeps 1 decimal by default, drops it for values
 * of 100 and above so the string stays compact.
 */
export function formatBytes(bytes, digits = 1) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${Math.round(value)} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unit = 0;

  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }

  const precision = scaled >= 100 ? 0 : digits;
  return `${scaled.toFixed(precision)} ${units[unit]}`;
}

/** Strip the extension and any path separators from a file name. */
export function fileStem(name) {
  const base = String(name || 'image').split(/[\\/]/).pop() || 'image';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(/[<>:"|?*\u0000-\u001f]/g, '-').trim() || 'image';
}

/** Pick the extension for a logical format, defaulting to the source one. */
export function extensionFor(format) {
  return FORMATS[format]?.ext || 'webp';
}

/**
 * Build a deterministic, collision-resistant output name.
 * Example: "sunset-harbour.jpg" → "sunset-harbour-1280x853.webp"
 */
export function buildOutputName(originalName, { width, height, format = 'webp', suffix = '' } = {}) {
  const stem = fileStem(originalName);
  const dims = width && height ? `-${Math.round(width)}x${Math.round(height)}` : '';
  const extra = suffix ? `-${String(suffix).replace(/[^\w-]+/g, '')}` : '';
  return `${stem}${dims}${extra}.${extensionFor(format)}`;
}

/**
 * Scale so the longest edge equals `maxEdge`. Never upscales.
 * Returns integer dimensions so canvas allocations stay predictable.
 */
export function fitDimensions(width, height, maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const limit = Number(maxEdge) || 0;

  if (limit <= 0) return { width: w, height: h, scaled: false };

  const longest = Math.max(w, h);
  if (longest <= limit) return { width: w, height: h, scaled: false };

  const ratio = limit / longest;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/**
 * Percentage saved. Positive means smaller, negative means the output grew
 * (which genuinely happens when a small JPEG is converted to PNG).
 */
export function savedPercent(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || !Number.isFinite(a) || b <= 0) return 0;
  return Math.round(((b - a) / b) * 1000) / 10;
}

/** DOS timestamp used by ZIP headers (2 second resolution, 1980 epoch). */
export function toDosDateTime(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE 802.3), required by the ZIP central directory. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP writer (method 0 = stored, no compression).
 * Images are already compressed, so deflating them again buys almost nothing
 * while costing a megabyte of JS. UTF-8 flag (0x0800) keeps Chinese file
 * names intact on Windows and macOS.
 *
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob}
 */
export function createZip(files, { date = new Date() } = {}) {
  const encoder = new TextEncoder();
  const { time, date: dosDate } = toDosDateTime(date);

  const prepared = files.map((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    return { nameBytes, data, crc: crc32(data), offset: 0 };
  });

  const localSize = prepared.reduce((sum, f) => sum + 30 + f.nameBytes.length + f.data.length, 0);
  const centralSize = prepared.reduce((sum, f) => sum + 46 + f.nameBytes.length, 0);
  const buffer = new ArrayBuffer(localSize + centralSize + 22);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let cursor = 0;
  const u16 = (offset, value) => view.setUint16(offset, value & 0xffff, true);
  const u32 = (offset, value) => view.setUint32(offset, value >>> 0, true);

  prepared.forEach((file) => {
    file.offset = cursor;

    u32(cursor, 0x04034b50);
    u16(cursor + 4, 20); // version needed
    u16(cursor + 6, 0x0800); // UTF-8 file name
    u16(cursor + 8, 0); // stored
    u16(cursor + 10, time);
    u16(cursor + 12, dosDate);
    u32(cursor + 14, file.crc);
    u32(cursor + 18, file.data.length);
    u32(cursor + 22, file.data.length);
    u16(cursor + 26, file.nameBytes.length);
    u16(cursor + 28, 0);

    bytes.set(file.nameBytes, cursor + 30);
    bytes.set(file.data, cursor + 30 + file.nameBytes.length);
    cursor += 30 + file.nameBytes.length + file.data.length;
  });

  const centralStart = cursor;

  prepared.forEach((file) => {
    u32(cursor, 0x02014b50);
    u16(cursor + 4, 20); // version made by
    u16(cursor + 6, 20); // version needed
    u16(cursor + 8, 0x0800);
    u16(cursor + 10, 0);
    u16(cursor + 12, time);
    u16(cursor + 14, dosDate);
    u32(cursor + 16, file.crc);
    u32(cursor + 20, file.data.length);
    u32(cursor + 24, file.data.length);
    u16(cursor + 28, file.nameBytes.length);
    u16(cursor + 30, 0); // extra
    u16(cursor + 32, 0); // comment
    u16(cursor + 34, 0); // disk start
    u16(cursor + 36, 0); // internal attrs
    u32(cursor + 38, 0); // external attrs
    u32(cursor + 42, file.offset);

    bytes.set(file.nameBytes, cursor + 46);
    cursor += 46 + file.nameBytes.length;
  });

  const centralEnd = cursor;

  u32(cursor, 0x06054b50);
  u16(cursor + 4, 0);
  u16(cursor + 6, 0);
  u16(cursor + 8, prepared.length);
  u16(cursor + 10, prepared.length);
  u32(cursor + 12, centralEnd - centralStart);
  u32(cursor + 16, centralStart);
  u16(cursor + 20, 0);

  return new Blob([buffer], { type: 'application/zip' });
}

/* ==========================================================================
   Browser-only: capability detection
   ========================================================================== */

let supportCache = null;

/** Probe which encoders this browser actually ships. */
export function detectFormatSupport() {
  if (supportCache) return supportCache;
  if (typeof document === 'undefined') {
    return { jpeg: true, png: true, webp: true, avif: false };
  }

  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;

  const canEncode = (mime) => {
    try {
      return probe.toDataURL(mime).startsWith(`data:${mime}`);
    } catch {
      return false;
    }
  };

  supportCache = {
    jpeg: true,
    png: true,
    webp: canEncode('image/webp'),
    avif: canEncode('image/avif'),
  };
  return supportCache;
}

/** Formats this browser can write, in display order. */
export function availableFormats() {
  const support = detectFormatSupport();
  return Object.entries(FORMATS)
    .filter(([key]) => support[key])
    .map(([key, meta]) => ({ key, ...meta }));
}

/** True when a dropped file looks like something we can decode. */
export function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i.test(file.name || '');
}

/* ==========================================================================
   Browser-only: decode / draw / encode
   ========================================================================== */

/** Decode any browser-supported image into an ImageBitmap (or <img> fallback). */
export async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Safari occasionally rejects the options bag — retry bare. */
      try {
        return await createImageBitmap(file);
      } catch {
        /* fall through to <img> */
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('浏览器无法解码这张图片'));
      el.src = url;
    });
    return img;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`当前浏览器无法编码为 ${mime}`));
      },
      mime,
      quality
    );
  });
}

/** Rounded rectangle path with a fallback for older Safari. */
function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function paintBackground(ctx, width, height, palette) {
  const [from, mid, to] = palette;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(0.52, mid);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // A soft light bloom keeps flat gradients from looking like a default preset.
  const bloom = ctx.createRadialGradient(width * 0.22, height * 0.08, 0, width * 0.22, height * 0.08, width * 0.9);
  bloom.addColorStop(0, 'rgba(255,255,255,0.28)');
  bloom.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Core single-file pipeline: decode → resize → encode.
 *
 * @param {File|Blob} file
 * @param {{format?: string, quality?: number, maxEdge?: number, flatten?: boolean, suffix?: string}} options
 */
export async function processImage(file, options = {}) {
  const { format = 'webp', quality = 0.82, maxEdge = 0, flatten = true, suffix = '' } = options;
  const meta = FORMATS[format] || FORMATS.webp;

  const source = await decodeImage(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const target = fitDimensions(sourceWidth, sourceHeight, maxEdge);

  const canvas = createCanvas(target.width, target.height);
  const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg' });
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // JPEG has no alpha channel: without a matte, transparency turns black.
  if (format === 'jpeg' && flatten) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
  }

  ctx.drawImage(source, 0, 0, target.width, target.height);

  const blob = await canvasToBlob(canvas, meta.mime, format === 'png' ? undefined : quality);

  if (typeof source.close === 'function') source.close();

  return {
    blob,
    width: target.width,
    height: target.height,
    sourceWidth,
    sourceHeight,
    format,
    name: buildOutputName(file.name || 'image', { width: target.width, height: target.height, format, suffix }),
  };
}

/**
 * Compose a "shareable screenshot" — padded gradient canvas, rounded image,
 * soft shadow and an optional watermark line.
 */
export async function beautifyImage(file, options = {}) {
  const {
    padding = 0.08,
    radius = 20,
    shadow = true,
    background = 'aurora',
    watermark = '',
    maxEdge = 0,
  } = options;

  const source = await decodeImage(file);
  const fit = fitDimensions(source.width, source.height, maxEdge);
  const pad = Math.round(Math.max(fit.width, fit.height) * Math.min(Math.max(padding, 0), 0.24));
  const captionH = watermark ? Math.round(Math.max(fit.width, fit.height) * 0.07) : 0;

  const canvas = createCanvas(fit.width + pad * 2, fit.height + pad * 2 + captionH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  paintBackground(ctx, canvas.width, canvas.height, BEAUTIFY_BACKGROUNDS[background] || BEAUTIFY_BACKGROUNDS.aurora);

  const x = pad;
  const y = pad;

  if (shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(6, 12, 10, 0.38)';
    ctx.shadowBlur = Math.round(pad * 1.15);
    ctx.shadowOffsetY = Math.round(pad * 0.28);
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    roundRectPath(ctx, x, y, fit.width, fit.height, radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundRectPath(ctx, x, y, fit.width, fit.height, radius);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, fit.width, fit.height);
  ctx.restore();

  // Hairline border reads as "screen edge" on light backgrounds.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, Math.round(pad * 0.03));
  roundRectPath(ctx, x + 0.5, y + 0.5, fit.width - 1, fit.height - 1, radius);
  ctx.stroke();
  ctx.restore();

  if (watermark) {
    const fontSize = Math.round(Math.min(canvas.width, fit.width) * 0.032);
    ctx.font = `500 ${Math.max(11, fontSize)}px -apple-system, "Segoe UI", "PingFang SC", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(watermark, canvas.width / 2, canvas.height - captionH / 2 - pad * 0.12);
  }

  const blob = await canvasToBlob(canvas, 'image/png');
  if (typeof source.close === 'function') source.close();

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    sourceWidth: fit.width,
    sourceHeight: fit.height,
    format: 'png',
    name: buildOutputName(file.name || 'image', { width: canvas.width, height: canvas.height, format: 'png', suffix: 'card' }),
  };
}

/** Turn a Blob into a Uint8Array (used by the ZIP writer). */
export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Trigger a browser download without leaking DOM nodes. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
