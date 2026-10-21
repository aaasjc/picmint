# 架构说明

## 总览

PicMint 是一个**没有构建步骤**的静态站点。浏览器直接加载 ES Modules，所有逻辑在同一次页面生命周期内完成。

```text
┌──────────────────────────────────────────────────────────┐
│  浏览器标签页                                              │
│                                                          │
│  index.html ──► landing-effects.js     （滚动、导航、计数）│
│      └───────► playground-demo.js      （单图演示）        │
│                        │                                 │
│  studio.html ─► studio-app.js          （状态与渲染）      │
│                        │                                 │
│                        ▼                                 │
│                  image-core.js                            │
│        ┌───────────────┼────────────────┐                │
│   纯函数层        编解码层            ZIP 层              │
│  formatBytes    createImageBitmap     crc32              │
│  fitDimensions  canvas.drawImage      createZip          │
│  savedPercent   canvas.toBlob                            │
└──────────────────────────────────────────────────────────┘
                    ▲
                    │  同一份文件被 node:test 直接 import
              tests/core.test.mjs
```

没有任何模块发起网络请求。`index.html` 与 `studio.html` 加载完成后即可断网使用。

## 模块职责

| 文件 | 职责 | 依赖 |
| --- | --- | --- |
| `assets/js/image-core.js` | 纯函数、能力探测、解码/缩放/编码、美化合成、ZIP 写入、下载 | 无 |
| `assets/js/studio-app.js` | 队列状态、渲染、参数联动、事件绑定、导出编排 | `image-core.js` |
| `assets/js/landing-effects.js` | 粘性导航、滚动渐入、数字滚动、卡片光斑 | 无 |
| `assets/js/playground-demo.js` | 主页单图压缩演示 | `image-core.js` |
| `scripts/serve.mjs` | 开发用静态服务器 | Node 内置模块 |

`image-core.js` 顶部的纯函数不触碰 DOM，因此可以在 Node 里直接单元测试；浏览器相关代码只在调用时才访问 `document` / `canvas`。

## 单张图片的处理链路

```text
File
 │
 ├─ createImageBitmap(file, { imageOrientation: 'from-image' })
 │     ↳ 失败则回退到 <img> + URL.createObjectURL
 ▼
ImageBitmap / HTMLImageElement
 │
 ├─ fitDimensions(w, h, maxEdge)        计算目标尺寸，不放大
 ▼
<canvas>  (JPEG 输出前先铺白底)
 │
 ├─ drawImage(source, 0, 0, w, h)       imageSmoothingQuality: 'high'
 ▼
canvas.toBlob(mime, quality)
 │
 ▼
Blob + 目标文件名（含尺寸后缀）
```

## 状态模型

工坊只有一个状态对象：

```js
state = {
  items: [{ id, file, name, size, thumbUrl, result, resultUrl, status, error }],
  activeId, view, zoom,
  options: { format, quality, maxEdge, beautify, background, padding, radius, watermark, dimSuffix, keepSmaller },
  busy, dirty, seq,
}
```

渲染策略刻意做得朴素：

- **结构变化**（增删、排序、切换选中）→ 重建队列 DOM。上限 128 项，重建成本可忽略。
- **单行变化**（处理中 / 完成 / 失败）→ `patchRow()` 只改那一行的 class 与文本。
- **设置变化** → 只改 `state.options` 并标记 `dirty`，不自动重算，避免用户拖动滑块时反复编码。

## 关键决策

### 为什么用 stored ZIP 而不是引入库

图片本身已经被压缩过，deflate 通常只能再省 1–3%。而引入 JSZip 这类库会增加 30–100 KB 的下载量，还要处理构建与许可证。手写的 stored（method 0）ZIP 只有约 90 行，包含：

- 本地文件头（30 字节 + 文件名）
- 中央目录头（46 字节 + 文件名）
- EOCD（22 字节）
- CRC-32 查表实现

文件名使用 UTF-8 编码并把通用标志位第 11 位（`0x0800`）置 1，这样中文文件名在 Windows 资源管理器和 macOS 归档工具里都不会乱码。已通过 Python `zipfile.testzip()` 与 `namelist()` 验证。

### 为什么不用 Web Worker

单张 4000×3000 的图片在本机处理耗时约 60–150 ms，放在主线程不会造成可感知的卡顿。批处理循环里每张之间执行一次 `await new Promise(r => setTimeout(r, 0))`，让浏览器有机会绘制进度。

如果未来引入"目标体积压缩"（需要对同一张图做 5–8 次编码），再考虑把编码搬到 Worker + `OffscreenCanvas`。届时的约束是 `ImageBitmap` 可转移（transferable），迁移成本不高。

### 为什么不用框架

界面状态简单：一个列表 + 一组参数 + 一个预览。用原生 DOM 表达的代码量小于引入框架后需要维护的抽象。代价是局部更新要手写，所以 `patchRow` 这类函数承担了虚拟 DOM 的职责。

### 为什么 PNG 输出忽略质量参数

`canvas.toBlob('image/png', quality)` 中的 quality 对 PNG 无效。UI 上直接把滑块禁用并显示"无损"，比让用户拖动一个没有效果的控件诚实。

### 为什么默认保留更小的原图

"压缩工具把图片变大了"是用户最容易被劝退的体验。`keepSmaller` 默认开启：当输出体积 ≥ 原图时，直接复用原文件并标注"原图"。用户仍可关闭该开关强制输出，用于确实需要统一格式的场景。

## 性能边界

| 场景 | 实测/估算 |
| --- | --- |
| 4000×3000 JPEG → WebP q82 | 约 90–160 ms |
| 1200×1200 PNG → WebP q82 | 约 25–45 ms |
| 截图美化（含阴影与排版） | 约 60–120 ms |
| 128 张混合批量 | 10–25 s（含每帧让出） |
| 单张内存占用 | 解码后约为 `w × h × 4` 字节 |

上限 128 张 / 80 MB 是经验值：再大就容易在低内存设备上触发标签页崩溃，而崩溃对用户来说比"分批处理"糟糕得多。

## 可访问性

- 所有交互控件都是原生 `button` / `input` / `details`，天然支持键盘。
- 队列项带 `role="button"` 与 `tabIndex`，`Enter` / `Space` 可选中。
- `prefers-reduced-motion: reduce` 时关闭所有动画与平滑滚动。
- 渐入动画依赖 `html.js` 类：脚本不可用时内容保持可见，不会出现"白屏"。
- 表单控件都有可见 label 或 `aria-label`。

## 扩展点

想加功能时，改动通常落在这几处：

1. **新的输出格式** → `FORMATS` 常量 + `detectFormatSupport()` 的探测键 + 设置面板的按钮。
2. **新的美化参数** → `BEAUTIFY_BACKGROUNDS` 或 `beautifyImage` 的配置项 + 设置面板控件。
3. **新的导出方式** → `studio-app.js` 的 `exportZip()` 附近，复用 `downloadBlob()`。
4. **新的纯逻辑** → 放进 `image-core.js` 顶部并补 `tests/core.test.mjs`。

新增依赖前请先读 [CONTRIBUTING.md](../CONTRIBUTING.md) 的项目原则。
