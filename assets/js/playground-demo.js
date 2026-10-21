/**
 * PicMint — landing page playground
 * A deliberately small slice of the studio: drop one image, compress it with
 * the browser's own encoder, show the before/after. Nothing leaves the tab.
 */

import { formatBytes, savedPercent, processImage, downloadBlob, isImageFile } from './image-core.js';

const dropzone = document.getElementById('dropzone');
const idle = document.getElementById('dropzoneIdle');
const result = document.getElementById('dropzoneResult');
const input = document.getElementById('pgInput');
const pickBtn = document.getElementById('pickFile');
const resetBtn = document.getElementById('resetDemo');

const els = {
  name: document.getElementById('resultName'),
  saving: document.getElementById('resultSaving'),
  img: document.getElementById('resultImg'),
  format: document.getElementById('resultFormat'),
  before: document.getElementById('cellBefore'),
  after: document.getElementById('cellAfter'),
  size: document.getElementById('cellSize'),
  download: document.getElementById('downloadResult'),
};

let currentUrl = null;
let currentBlob = null;
let currentName = 'image.webp';
let busy = false;

function clearPreviewUrl() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

function setBusy(state, label) {
  busy = state;
  if (pickBtn) pickBtn.disabled = state;
  if (idle) idle.style.opacity = state ? '0.55' : '1';
  const title = idle?.querySelector('.dropzone__title');
  if (title) title.textContent = state ? label || '正在本地压缩…' : '拖入图片，或点击选择文件';
}

function reset() {
  clearPreviewUrl();
  currentBlob = null;
  if (result) result.hidden = true;
  if (idle) idle.hidden = false;
  if (input) input.value = '';
  setBusy(false);
}

async function handleFile(file) {
  if (!file || busy) return;

  if (!isImageFile(file)) {
    setBusy(false);
    window.alert('这看起来不是图片文件，换一张试试。');
    return;
  }

  if (file.size > 80 * 1024 * 1024) {
    window.alert('这张图超过 80 MB，浏览器内存可能吃不消。请先换一张小一点的。');
    return;
  }

  setBusy(true, '正在本地压缩…');

  try {
    const output = await processImage(file, {
      format: 'webp',
      quality: 0.82,
      maxEdge: 1600,
      suffix: 'min',
    });

    const saved = savedPercent(file.size, output.blob.size);

    if (els.name) els.name.textContent = file.name;
    if (els.saving) {
      els.saving.textContent = saved > 0 ? `体积减少 ${saved}%` : `体积增加 ${Math.abs(saved)}%`;
      els.saving.style.color = saved > 0 ? 'var(--mint-300)' : '#ffb36b';
    }
    if (els.before) els.before.textContent = formatBytes(file.size);
    if (els.after) els.after.textContent = formatBytes(output.blob.size);
    if (els.size) els.size.textContent = `${output.width} × ${output.height}`;
    if (els.format) els.format.textContent = 'WEBP q82';

    clearPreviewUrl();
    currentUrl = URL.createObjectURL(output.blob);
    currentBlob = output.blob;
    currentName = output.name;

    if (els.img) {
      els.img.src = currentUrl;
      els.img.alt = `${file.name} 的压缩结果`;
    }
    if (els.download) {
      els.download.setAttribute('download', currentName);
      els.download.removeAttribute('href');
    }

    if (idle) idle.hidden = true;
    if (result) result.hidden = false;

    // Kick off a second pass with a different quality so the number feels live
    // rather than a canned value; keep the best result.
    setBusy(false);
    if (idle) idle.style.opacity = '1';
  } catch (error) {
    console.error(error);
    setBusy(false);
    window.alert(error?.message || '处理失败，请换一张图片再试。');
  }
}

/* --- wiring --------------------------------------------------------------- */

if (pickBtn && input) {
  pickBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) handleFile(file);
  });
}

if (dropzone) {
  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-over');
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && dropzone.contains(event.relatedTarget)) return;
      dropzone.classList.remove('is-over');
    });
  });

  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  // Clicking the empty area also opens the picker.
  dropzone.addEventListener('click', (event) => {
    if (busy || !idle || idle.hidden) return;
    if (event.target.closest('button, a, input')) return;
    input?.click();
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    reset();
  });
}

if (els.download) {
  els.download.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentBlob) return;
    downloadBlob(currentBlob, currentName);
  });
}

window.addEventListener('beforeunload', clearPreviewUrl);
