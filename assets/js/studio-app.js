/**
 * PicMint Studio — application controller
 * ---------------------------------------------------------------------------
 * State lives in one plain object. Rendering is intentionally cheap and
 * declarative-ish: rebuild the queue only when its shape changes, patch single
 * rows while processing.
 */

import {
  FORMATS,
  availableFormats,
  beautifyImage,
  blobToBytes,
  buildOutputName,
  createZip,
  detectFormatSupport,
  downloadBlob,
  formatBytes,
  isImageFile,
  processImage,
  savedPercent,
} from './image-core.js';

/* ==========================================================================
   Elements
   ========================================================================== */

const $ = (id) => document.getElementById(id);

const el = {
  fileInput: $('fileInput'),
  addImages: $('addImages'),
  clearAll: $('clearAll'),
  processAll: $('processAll'),
  exportZip: $('exportZip'),
  sortQueue: $('sortQueue'),

  queue: $('queue'),
  queueEmpty: $('queueEmpty'),
  queueCount: $('queueCount'),

  stage: $('stage'),
  stageEmpty: $('stageEmpty'),
  stageFrame: $('stageFrame'),
  stageImage: $('stageImage'),
  activeName: $('activeName'),

  viewButtons: Array.from(document.querySelectorAll('[data-view]')),
  zoomIn: $('zoomIn'),
  zoomOut: $('zoomOut'),
  zoomLevel: $('zoomLevel'),
  downloadCurrent: $('downloadCurrent'),

  formatGrid: $('formatGrid'),
  formatHint: $('formatHint'),
  quality: $('quality'),
  qualityValue: $('qualityValue'),
  qualityHint: $('qualityHint'),
  maxEdge: $('maxEdge'),
  maxEdgeValue: $('maxEdgeValue'),
  edgeChips: $('edgeChips'),

  beautifyOn: $('beautifyOn'),
  beautifyPanel: $('beautifyPanel'),
  swatches: $('swatches'),
  padding: $('padding'),
  paddingValue: $('paddingValue'),
  radius: $('radius'),
  radiusValue: $('radiusValue'),
  watermark: $('watermark'),

  dimSuffix: $('dimSuffix'),
  keepSmaller: $('keepSmaller'),
  resetSettings: $('resetSettings'),

  statusDot: $('statusDot'),
  statusText: $('statusText'),
  statusTotals: $('statusTotals'),

  toasts: $('toasts'),
};

/* ==========================================================================
   State
   ========================================================================== */

const DEFAULTS = {
  format: 'webp',
  quality: 82,
  maxEdge: 0,
  beautify: false,
  background: 'aurora',
  padding: 8,
  radius: 20,
  watermark: '',
  dimSuffix: true,
  keepSmaller: true,
};

const state = {
  items: [],
  activeId: null,
  view: 'result',
  zoom: 0, // 0 = fit to viewport
  options: { ...DEFAULTS },
  busy: false,
  dirty: false,
  previewUrl: null,
  seq: 0,
};

const support = detectFormatSupport();

/* ==========================================================================
   Utilities
   ========================================================================== */

let toastSeq = 0;

function toast(message, type = 'ok') {
  if (!el.toasts) return;
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  node.id = `toast-${++toastSeq}`;
  node.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${type === 'error' ? '<circle cx="8" cy="8" r="6.2"/><path d="M8 5v3.4M8 10.6v.4"/>' : '<path d="m3 8.4 3.2 3.2L13 5"/>'}
    </svg>
    <span></span>`;
  node.querySelector('span').textContent = message;
  el.toasts.append(node);

  window.setTimeout(() => {
    node.style.transition = 'opacity .25s linear, transform .25s linear';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    window.setTimeout(() => node.remove(), 260);
  }, 3600);
}

function setStatus(text, busy = false) {
  if (el.statusText) el.statusText.textContent = text;
  if (el.statusDot) el.statusDot.classList.toggle('statusbar__dot--busy', busy);
}

function totalStats() {
  const done = state.items.filter((item) => item.status === 'done' && item.result);
  const before = done.reduce((sum, item) => sum + item.size, 0);
  const after = done.reduce((sum, item) => sum + item.result.size, 0);
  return { count: done.length, total: state.items.length, before, after };
}

function refreshTotals() {
  const { count, total, before, after } = totalStats();

  if (el.queueCount) el.queueCount.textContent = String(total);
  if (el.clearAll) el.clearAll.disabled = total === 0 || state.busy;
  if (el.processAll) el.processAll.disabled = total === 0 || state.busy;
  if (el.exportZip) el.exportZip.disabled = count === 0 || state.busy;

  if (!el.statusTotals) return;
  if (!count) {
    el.statusTotals.textContent = total ? `${total} 张待处理` : '—';
    return;
  }

  const saved = savedPercent(before, after);
  el.statusTotals.textContent = `已处理 ${count}/${total} · ${formatBytes(before)} → ${formatBytes(after)} · ${
    saved >= 0 ? '节省' : '增加'
  } ${Math.abs(saved)}%`;
}

function activeItem() {
  return state.items.find((item) => item.id === state.activeId) || null;
}

function releaseItem(item) {
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  item.thumbUrl = null;
  item.resultUrl = null;
}

/* ==========================================================================
   Queue rendering
   ========================================================================== */

function deltaMarkup(item) {
  if (item.status !== 'done' || !item.result) return '';
  if (item.result.keptOriginal) return '<b class="qitem__delta qitem__delta--good">原图</b>';
  if (item.result.beautified) return '<b class="qitem__delta">美化</b>';

  const pct = savedPercent(item.size, item.result.size);
  const cls = pct >= 0 ? 'qitem__delta--good' : 'qitem__delta--bad';
  return `<b class="qitem__delta ${cls}">${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%</b>`;
}

function renderQueue() {
  if (!el.queue || !el.queueEmpty) return;

  el.queue.querySelectorAll('.qitem').forEach((node) => node.remove());
  el.queueEmpty.hidden = state.items.length > 0;

  const frag = document.createDocumentFragment();

  state.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = `qitem${item.id === state.activeId ? ' is-active' : ''}${
      item.status === 'done' ? ' is-done' : ''
    }${item.status === 'working' ? ' is-working' : ''}${item.status === 'error' ? ' is-error' : ''}`;
    row.dataset.id = item.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const sizeText =
      item.status === 'done' && item.result
        ? `${formatBytes(item.size)} → ${formatBytes(item.result.size)}`
        : formatBytes(item.size);

    row.innerHTML = `
      <span class="qitem__thumb">
        <img src="${item.thumbUrl}" alt="" loading="lazy" />
        <button class="qitem__remove" type="button" data-remove="${item.id}" aria-label="移除 ${item.name}">
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2 2 8"/></svg>
        </button>
      </span>
      <span class="qitem__main">
        <span class="qitem__name">${escapeHtml(item.name)}</span>
        <span class="qitem__meta">${sizeText} ${deltaMarkup(item)}</span>
      </span>
      <span class="qitem__status" title="${item.status}"></span>`;

    frag.append(row);
  });

  el.queue.append(frag);
  refreshTotals();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function patchRow(item) {
  const row = el.queue?.querySelector(`.qitem[data-id="${item.id}"]`);
  if (!row) {
    renderQueue();
    return;
  }

  row.classList.toggle('is-done', item.status === 'done');
  row.classList.toggle('is-working', item.status === 'working');
  row.classList.toggle('is-error', item.status === 'error');
  row.classList.toggle('is-active', item.id === state.activeId);

  const meta = row.querySelector('.qitem__meta');
  if (meta) {
    const sizeText =
      item.status === 'done' && item.result
        ? `${formatBytes(item.size)} → ${formatBytes(item.result.size)}`
        : formatBytes(item.size);
    meta.innerHTML = `${sizeText} ${deltaMarkup(item)}`;
  }
}

/* ==========================================================================
   Stage / preview
   ========================================================================== */

function currentPreviewSource(item) {
  if (!item) return null;
  if (state.view === 'result' && item.result) return item.resultUrl;
  return item.thumbUrl;
}

function renderStage() {
  if (!el.stageFrame || !el.stageImage || !el.stageEmpty) return;
  const item = activeItem();

  if (!item) {
    el.stageEmpty.hidden = false;
    el.stageFrame.hidden = true;
    el.stageImage.removeAttribute('src');
    if (el.activeName) el.activeName.textContent = '未选择图片';
    if (el.downloadCurrent) el.downloadCurrent.disabled = true;
    if (el.zoomIn) el.zoomIn.disabled = true;
    if (el.zoomOut) el.zoomOut.disabled = true;
    if (el.zoomLevel) el.zoomLevel.textContent = '—';
    return;
  }

  const src = currentPreviewSource(item);
  el.stageEmpty.hidden = true;
  el.stageFrame.hidden = false;

  if (el.activeName) el.activeName.textContent = item.name;
  if (el.downloadCurrent) el.downloadCurrent.disabled = !item.result;
  if (el.zoomIn) el.zoomIn.disabled = false;
  if (el.zoomOut) el.zoomOut.disabled = false;

  if (src) {
    if (el.stageImage.getAttribute('src') !== src) el.stageImage.src = src;
    el.stageImage.alt = item.name;
  }

  applyZoom();
  updateViewButtons();
}

function applyZoom() {
  if (!el.stageImage || !el.zoomLevel) return;

  if (state.zoom === 0) {
    el.stageImage.style.width = '';
    el.stageImage.style.maxWidth = '';
    el.stageImage.style.height = '';
    el.zoomLevel.textContent = '适应';
    return;
  }

  const natural = el.stageImage.naturalWidth || 1;
  el.stageImage.style.maxWidth = 'none';
  el.stageImage.style.width = `${Math.round(natural * state.zoom)}px`;
  el.stageImage.style.height = 'auto';
  el.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateViewButtons() {
  el.viewButtons.forEach((btn) => {
    const on = btn.dataset.view === state.view;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

/* ==========================================================================
   Adding / removing files
   ========================================================================== */

const MAX_ITEMS = 128;

function addFiles(fileList) {
  if (state.busy) {
    toast('正在处理中，稍等一下再添加。', 'error');
    return;
  }

  const incoming = Array.from(fileList || []).filter(isImageFile);
  if (!incoming.length) {
    toast('没有找到可识别的图片文件。', 'error');
    return;
  }

  const room = MAX_ITEMS - state.items.length;
  if (room <= 0) {
    toast(`一个批次最多 ${MAX_ITEMS} 张，先处理掉一些吧。`, 'error');
    return;
  }

  const slice = incoming.slice(0, room);
  if (slice.length < incoming.length) {
    toast(`超出 ${MAX_ITEMS} 张上限，已添加前 ${slice.length} 张。`, 'error');
  }

  slice.forEach((file) => {
    const item = {
      id: `f${++state.seq}`,
      file,
      name: file.name,
      size: file.size,
      thumbUrl: URL.createObjectURL(file),
      resultUrl: null,
      result: null,
      status: 'idle',
      error: null,
    };
    state.items.push(item);
  });

  if (!state.activeId) state.activeId = state.items[0]?.id ?? null;
  state.dirty = true;

  renderQueue();
  renderStage();
  setStatus(`已添加 ${slice.length} 张图片`);
  if (el.fileInput) el.fileInput.value = '';
}

function removeItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;

  releaseItem(state.items[index]);
  state.items.splice(index, 1);

  if (state.activeId === id) {
    state.activeId = state.items[Math.max(0, index - 1)]?.id ?? null;
  }

  renderQueue();
  renderStage();
}

function clearAll() {
  if (state.busy) return;
  if (!state.items.length) return;

  if (state.items.length > 3 && !window.confirm(`确定清空这 ${state.items.length} 张图片吗？此操作不可撤销。`)) {
    return;
  }

  state.items.forEach(releaseItem);
  state.items = [];
  state.activeId = null;
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }

  renderQueue();
  renderStage();
  setStatus('已清空');
}

/* ==========================================================================
   Processing
   ========================================================================== */

function buildOptions() {
  const { format, quality, maxEdge, beautify, background, padding, radius, watermark } = state.options;
  if (beautify) {
    return { mode: 'beautify', beautify: { background, padding: padding / 100, radius, watermark, maxEdge } };
  }
  return { mode: 'resize', resize: { format, quality: quality / 100, maxEdge } };
}

async function processOne(item, options) {
  item.status = 'working';
  item.error = null;
  patchRow(item);

  try {
    const output =
      options.mode === 'beautify'
        ? await beautifyImage(item.file, options.beautify)
        : await processImage(item.file, options.resize);

    const keepOriginal = state.options.keepSmaller && options.mode === 'resize' && output.blob.size >= item.size;

    if (keepOriginal) {
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      item.result = {
        blob: item.file,
        size: item.size,
        width: output.sourceWidth,
        height: output.sourceHeight,
        name: item.name,
        keptOriginal: true,
      };
      item.resultUrl = item.thumbUrl;
    } else {
      let name;
      if (options.mode === 'beautify') {
        name = buildOutputName(item.name, { width: output.width, height: output.height, format: 'png', suffix: 'card' });
      } else if (state.options.dimSuffix) {
        name = buildOutputName(item.name, { width: output.width, height: output.height, format: state.options.format });
      } else {
        name = buildOutputName(item.name, { format: state.options.format });
      }

      if (item.resultUrl && item.resultUrl !== item.thumbUrl) URL.revokeObjectURL(item.resultUrl);
      item.resultUrl = URL.createObjectURL(output.blob);
      item.result = {
        blob: output.blob,
        size: output.blob.size,
        width: output.width,
        height: output.height,
        name,
        keptOriginal: false,
        beautified: options.mode === 'beautify',
      };
    }

    item.status = 'done';
  } catch (error) {
    console.error('[picmint]', item.name, error);
    item.status = 'error';
    item.error = error?.message || '处理失败';
  }

  patchRow(item);
  return item.status === 'done';
}

async function processAll() {
  if (state.busy || !state.items.length) return;

  if (state.items.length > 40 && state.options.beautify) {
    const ok = window.confirm(
      `美化模式会为每张图重新排版，${state.items.length} 张可能需要较长时间并占用较多内存。继续吗？`
    );
    if (!ok) return;
  }

  state.busy = true;
  state.dirty = false;
  refreshTotals();

  const options = buildOptions();
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < state.items.length; i += 1) {
    const item = state.items[i];
    setStatus(`处理中 ${i + 1}/${state.items.length} · ${item.name}`, true);
    // Yield to the browser so the row spinner actually paints.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const success = await processOne(item, options);
    if (success) ok += 1;
    else failed += 1;

    if (item.id === state.activeId) renderStage();
  }

  state.busy = false;
  refreshTotals();
  renderStage();

  setStatus(failed ? `完成 ${ok} 张，${failed} 张失败` : `处理完成 · ${ok} 张`);

  if (failed) toast(`${failed} 张失败，查看对应行的状态点。`, 'error');
  else toast(`已处理 ${ok} 张图片`);

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

/* ==========================================================================
   Export
   ========================================================================== */

function downloadCurrent() {
  const item = activeItem();
  if (!item?.result) {
    toast('这张还没有处理结果。', 'error');
    return;
  }
  downloadBlob(item.result.blob, item.result.name);
  toast(`正在下载 ${item.result.name}`);
}

async function exportZip() {
  const done = state.items.filter((item) => item.status === 'done' && item.result);
  if (!done.length) {
    toast('还没有可导出的结果。', 'error');
    return;
  }

  if (state.busy) return;
  state.busy = true;
  setStatus('正在打包…', true);

  try {
    const used = new Set();
    const files = [];

    for (const item of done) {
      let name = item.result.name;
      let counter = 2;
      while (used.has(name)) {
        const dot = name.lastIndexOf('.');
        name = `${item.result.name.slice(0, dot)}-${counter}${item.result.name.slice(dot)}`;
        counter += 1;
      }
      used.add(name);
      files.push({ name, data: await blobToBytes(item.result.blob) });
    }

    const zip = createZip(files);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(zip, `picmint-${stamp}.zip`);
    toast(`已打包 ${files.length} 个文件（${formatBytes(zip.size)}）`);
    setStatus(`打包完成 · ${files.length} 个文件`);
  } catch (error) {
    console.error(error);
    toast(error?.message || '打包失败', 'error');
    setStatus('打包失败');
  } finally {
    state.busy = false;
    refreshTotals();
  }
}

/* ==========================================================================
   Settings wiring
   ========================================================================== */

function paintRange(input) {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

function syncSettingsUI() {
  const { options } = state;

  el.formatGrid?.querySelectorAll('[data-format]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.format === options.format);
  });

  if (el.quality) {
    el.quality.value = String(options.quality);
    el.quality.disabled = options.format === 'png';
    paintRange(el.quality);
  }
  if (el.qualityValue) el.qualityValue.textContent = options.format === 'png' ? '无损' : String(options.quality);

  if (el.maxEdge) el.maxEdge.value = options.maxEdge > 0 ? String(options.maxEdge) : '';
  if (el.maxEdgeValue) el.maxEdgeValue.textContent = options.maxEdge > 0 ? `${options.maxEdge} px` : '不缩放';

  el.edgeChips?.querySelectorAll('[data-edge]').forEach((btn) => {
    btn.classList.toggle('is-on', Number(btn.dataset.edge) === options.maxEdge);
  });

  if (el.beautifyOn) el.beautifyOn.checked = options.beautify;
  if (el.beautifyPanel) el.beautifyPanel.hidden = !options.beautify;

  el.swatches?.querySelectorAll('[data-bg]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.bg === options.background);
  });

  if (el.padding) {
    el.padding.value = String(options.padding);
    paintRange(el.padding);
  }
  if (el.paddingValue) el.paddingValue.textContent = `${options.padding}%`;

  if (el.radius) {
    el.radius.value = String(options.radius);
    paintRange(el.radius);
  }
  if (el.radiusValue) el.radiusValue.textContent = `${options.radius}px`;

  if (el.watermark) el.watermark.value = options.watermark;
  if (el.dimSuffix) el.dimSuffix.checked = options.dimSuffix;
  if (el.keepSmaller) el.keepSmaller.checked = options.keepSmaller;

  if (el.formatHint) {
    const hints = {
      jpeg: '兼容性最好，不支持透明。适合照片与通用场景。',
      png: '无损、支持透明，体积通常最大。适合图标与截图。',
      webp: '体积与兼容性最平衡，支持透明，推荐默认。',
      avif: '同画质下体积最小，但编码较慢、旧浏览器不支持。',
    };
    el.formatHint.textContent = hints[options.format] || '';
  }
}

function markDirty() {
  state.dirty = true;
  if (!state.busy && state.items.some((item) => item.status === 'done')) {
    setStatus('设置已更改 · 再次点击「开始处理」应用');
  }
}

function bindSettings() {
  el.formatGrid?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-format]');
    if (!btn || btn.disabled) return;
    state.options.format = btn.dataset.format;
    syncSettingsUI();
    markDirty();
  });

  el.quality?.addEventListener('input', () => {
    state.options.quality = Number(el.quality.value);
    if (el.qualityValue) el.qualityValue.textContent = el.quality.value;
    paintRange(el.quality);
    markDirty();
  });

  el.maxEdge?.addEventListener('input', () => {
    const value = Math.max(0, Math.min(12000, Number(el.maxEdge.value) || 0));
    state.options.maxEdge = value;
    if (el.maxEdgeValue) el.maxEdgeValue.textContent = value > 0 ? `${value} px` : '不缩放';
    el.edgeChips?.querySelectorAll('[data-edge]').forEach((btn) => {
      btn.classList.toggle('is-on', Number(btn.dataset.edge) === value);
    });
    markDirty();
  });

  el.edgeChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-edge]');
    if (!btn) return;
    state.options.maxEdge = Number(btn.dataset.edge);
    syncSettingsUI();
    markDirty();
  });

  el.beautifyOn?.addEventListener('change', () => {
    state.options.beautify = el.beautifyOn.checked;
    syncSettingsUI();
    markDirty();
  });

  el.swatches?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-bg]');
    if (!btn) return;
    state.options.background = btn.dataset.bg;
    syncSettingsUI();
    markDirty();
  });

  el.padding?.addEventListener('input', () => {
    state.options.padding = Number(el.padding.value);
    if (el.paddingValue) el.paddingValue.textContent = `${el.padding.value}%`;
    paintRange(el.padding);
    markDirty();
  });

  el.radius?.addEventListener('input', () => {
    state.options.radius = Number(el.radius.value);
    if (el.radiusValue) el.radiusValue.textContent = `${el.radius.value}px`;
    paintRange(el.radius);
    markDirty();
  });

  el.watermark?.addEventListener('input', () => {
    state.options.watermark = el.watermark.value.trim();
    markDirty();
  });

  el.dimSuffix?.addEventListener('change', () => {
    state.options.dimSuffix = el.dimSuffix.checked;
    markDirty();
  });

  el.keepSmaller?.addEventListener('change', () => {
    state.options.keepSmaller = el.keepSmaller.checked;
    markDirty();
  });

  el.resetSettings?.addEventListener('click', () => {
    state.options = { ...DEFAULTS };
    syncSettingsUI();
    markDirty();
    toast('设置已恢复默认');
  });
}

/* ==========================================================================
   Global events
   ========================================================================== */

function bindGlobalEvents() {
  el.addImages?.addEventListener('click', () => el.fileInput?.click());

  el.fileInput?.addEventListener('change', () => {
    if (el.fileInput.files?.length) addFiles(el.fileInput.files);
  });

  el.clearAll?.addEventListener('click', clearAll);
  el.processAll?.addEventListener('click', processAll);
  el.exportZip?.addEventListener('click', exportZip);
  el.downloadCurrent?.addEventListener('click', downloadCurrent);

  el.sortQueue?.addEventListener('click', () => {
    state.items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
    renderQueue();
    toast('队列已按文件名排序');
  });

  el.queue?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-remove]');
    if (removeBtn) {
      event.stopPropagation();
      removeItem(removeBtn.dataset.remove);
      return;
    }

    const row = event.target.closest('.qitem');
    if (!row) return;
    state.activeId = row.dataset.id;
    state.zoom = 0;
    renderQueue();
    renderStage();
  });

  el.queue?.addEventListener('keydown', (event) => {
    const row = event.target.closest('.qitem');
    if (!row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      state.activeId = row.dataset.id;
      renderQueue();
      renderStage();
    }
  });

  el.viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      renderStage();
      if (state.view === 'result' && !activeItem()?.result) {
        setStatus('这张还没有结果，显示的是原图');
      }
    });
  });

  el.zoomIn?.addEventListener('click', () => {
    state.zoom = state.zoom === 0 ? 1 : Math.min(4, Math.round((state.zoom + 0.25) * 100) / 100);
    applyZoom();
  });

  el.zoomOut?.addEventListener('click', () => {
    state.zoom = state.zoom <= 0.25 ? 0 : Math.max(0.25, Math.round((state.zoom - 0.25) * 100) / 100);
    applyZoom();
  });

  el.stageImage?.addEventListener('load', applyZoom);

  // Drop anywhere in the window.
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('is-dragging');
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    addFiles(event.dataTransfer.files);
  });

  // Keyboard shortcuts.
  window.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      el.fileInput?.click();
      return;
    }

    if (typing) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      processAll();
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && state.activeId) {
      event.preventDefault();
      removeItem(state.activeId);
    }
  });

  window.addEventListener('beforeunload', () => {
    state.items.forEach(releaseItem);
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

function boot() {
  // Disable encoders the browser cannot provide, instead of silently degrading.
  el.formatGrid?.querySelectorAll('[data-format]').forEach((btn) => {
    const format = btn.dataset.format;
    if (!support[format]) {
      btn.disabled = true;
      btn.title = `当前浏览器不支持编码 ${FORMATS[format]?.label || format}`;
    }
  });

  if (!support[state.options.format]) {
    const first = availableFormats()[0];
    if (first) state.options.format = first.key;
  }

  syncSettingsUI();
  bindSettings();
  bindGlobalEvents();
  renderQueue();
  renderStage();
  setStatus('就绪');
  paintRange(el.quality);
  paintRange(el.padding);
  paintRange(el.radius);

  if (state.options.beautify) {
    el.beautifyPanel?.removeAttribute('hidden');
  }
}

boot();
