<div align="center">

<img src="assets/img/favicon.svg" width="76" height="76" alt="PicMint" />

# PicMint

**浏览器里的图片工坊 —— 批量压缩、格式转换、截图美化，一张图片都不会上传。**

[![License: MIT](https://img.shields.io/badge/license-MIT-2fdc9f?style=flat-square)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-5b6cff?style=flat-square)](package.json)
[![Size: < 80 KB](https://img.shields.io/badge/first--load-%3C80%20KB-9a63ff?style=flat-square)](#技术实现)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-2fdc9f?style=flat-square)](CONTRIBUTING.md)

[在线试用](https://picmint.dev) · [快速开始](docs/quick-start.md) · [架构说明](docs/architecture.md) · [更新日志](CHANGELOG.md) · [English](README.en.md)

</div>

![PicMint 主页](docs/assets/home-preview.jpg)

---

## 这是什么

PicMint 是一个**完全在浏览器本地运行**的图片处理工具。没有后端、没有上传接口、没有埋点脚本 —— 打开页面，处理完后图片还在你的硬盘上。

它解决的是一个具体的、每天都会遇到的问题：**只是想压几张图，为什么要先把原片传到别人的服务器？**

| 常见在线工具 | PicMint |
| --- | --- |
| 图片上传到服务器处理 | 图片只在你的内存里 |
| 需要等上传 / 下载 | 即时完成，速度取决于本机 CPU |
| 服务关停后链接失效 | 静态站点，可离线使用 |
| 隐私政策里的"我们不会…" | 没有可收集的数据，因为没有后端 |
| 免费额度、登录、水印 | 无限制、无账号、无水印 |

## 功能

<img src="docs/assets/studio-preview.jpg" alt="PicMint Studio 界面" width="100%" />

- **批量压缩** —— 一次拖入最多 128 张，按质量或目标体积压缩，实时显示前后体积与节省比例。
- **四格式互转** —— JPEG / PNG / WebP / AVIF，编码器直接调用浏览器原生能力。
- **智能缩放** —— 只填最大边，另一侧等比推算；自动校正 EXIF 方向，不放大原图。
- **截图美化** —— 渐变背景、圆角、留白、柔和投影与自定义水印，一次设置批量套用。
- **一键打包 ZIP** —— 内置 90 行 ZIP 写入器，支持 UTF-8 文件名，不引第三方库。
- **本地优先** —— 断网可用，无 Cookie、无第三方脚本、无字体 CDN。
- **键盘流** —— `Ctrl/⌘ + O` 添加、`Enter` 处理、`Delete` 移除、队列按文件名排序。

## 快速开始

### 直接使用

打开 [picmint.dev](https://picmint.dev)，或把仓库下载后双击 `index.html`。

> 部分浏览器对 `file://` 协议下的 Canvas 编码有额外限制，建议用本地服务器打开。

### 本地运行

只需要 Node.js 18+，**不需要 `npm install`**：

```bash
git clone https://github.com/picmint/picmint.git
cd picmint
npm start
# → http://127.0.0.1:4173
```

`npm start` 启动的是一个 90 行的零依赖静态服务器（`scripts/serve.mjs`）。

### 运行测试

```bash
npm test
```

覆盖纯函数、CRC32、ZIP 二进制结构与 UTF-8 文件名处理。

## 使用方式

1. **拖入图片**：把文件拖到工坊窗口任意位置，或按 `Ctrl/⌘ + O`。
2. **选择输出**：右侧面板设定格式、质量、最大边；需要社交配图时打开「截图美化」。
3. **开始处理**：点击右上角「开始处理」（或按 `Enter`），进度与体积会实时更新。
4. **导出**：单张点「下载」，批量点「打包下载」得到 ZIP。

如果输出比原图更大（例如把已优化的 JPEG 转成 PNG），默认会保留原图并在行内标注，避免"越压越大"。

## 技术实现

整个项目是**零依赖的原生 JavaScript**，没有构建步骤，没有框架，没有 polyfill。

| 关注点 | 做法 |
| --- | --- |
| 解码 | `createImageBitmap()`，回退到 `<img>` + `URL.createObjectURL` |
| 缩放 | `canvas.drawImage` + `imageSmoothingQuality: 'high'` |
| 编码 | `canvas.toBlob(mime, quality)`，PNG 忽略质量参数 |
| 能力探测 | 2×2 画布 `toDataURL` 前缀检测 WebP / AVIF 编码器 |
| 批量导出 | 手写 stored（method 0）ZIP：本地头 + 中央目录 + EOCD + CRC32 |
| 状态管理 | 单一 `state` 对象，队列按需重建，单行处理时局部打补丁 |
| 样式 | CSS 自定义属性 + 原生 Grid，无预处理器 |

**为什么 ZIP 不压缩？** 图片本身已是压缩数据，再做 deflate 通常只能省 1–3%，却要引入几十 KB 的库。stored 模式写入快、代码小、兼容性好。

**为什么没有 Web Worker？** 单张处理在 20–120 ms 量级，主线程足够。批处理时按帧让出（`setTimeout(0)`）保证进度条能刷新。图片数量极大的场景更适合用桌面工具。

## 目录结构

```text
picmint/
├── index.html                  # 营销主页（含实时压缩演示）
├── studio.html                 # 图片工坊
├── assets/
│   ├── css/
│   │   ├── theme-tokens.css    # 设计变量：颜色、字号、间距、动效
│   │   ├── landing-page.css    # 主页样式
│   │   └── studio-app.css      # 工坊样式
│   ├── js/
│   │   ├── image-core.js       # 纯函数 + 解码/编码/美化 + ZIP 写入器
│   │   ├── landing-effects.js  # 主页交互（渐入、计数、导航）
│   │   ├── playground-demo.js  # 主页实时压缩演示
│   │   └── studio-app.js       # 工坊控制器
│   └── img/                    # Logo、favicon、社交卡片
├── docs/                       # 使用与架构文档
├── scripts/serve.mjs           # 零依赖静态服务器
├── tests/core.test.mjs         # node:test 单元测试
└── .github/workflows/          # CI + GitHub Pages 部署
```

## 浏览器支持

| 浏览器 | 压缩 / 转换 | AVIF 输出 |
| --- | --- | --- |
| Chrome / Edge 90+ | ✅ | ✅（Edge 121+） |
| Safari 16.4+ | ✅ | ✅ |
| Firefox 100+ | ✅ | ❌ 自动隐藏选项 |

不支持的编码格式会**禁用按钮并给出说明**，而不是静默降级成别的格式。

## 隐私

- 没有后端，没有 `fetch` 图片，没有分析脚本。
- 不使用 Cookie、`localStorage` 或 IndexedDB —— 刷新即清空。
- 部署在 GitHub Pages 上时，托管方可能记录页面访问日志，这与本项目无关。
- 验证方法：打开开发者工具 Network 面板，清空记录后拖入图片，不应出现任何新请求。

## 部署

仓库根目录就是完整的静态站点，任选其一：

- **GitHub Pages**：仓库 Settings → Pages → Source 选 `GitHub Actions`，推送到 `main` 即自动发布（见 `.github/workflows/pages.yml`）。
- **Netlify / Cloudflare Pages**：构建命令留空，发布目录填 `/`。
- **自建**：把仓库放进任意静态服务器的根目录即可。

## 路线图

- [x] 批量压缩与格式转换
- [x] 尺寸调整与 EXIF 方向校正
- [x] 截图美化（渐变、圆角、水印）
- [x] ZIP 打包导出
- [ ] 目标体积压缩（二分搜索质量）
- [ ] 预设方案（保存常用参数组合）
- [ ] 拖拽排序与自定义输出文件名模板
- [ ] 繁体中文与日文界面

## 合作伙伴

PicMint 的服务器成本为零，但设计、字体授权、跨设备测试与安全审计仍然需要支持。合作伙伴位长期开放，欢迎设计工作室、字体厂商与云服务商加入：**hello@picmint.dev**

> 主页 `#partners` 区块的 Logo 为示例占位，替换 `index.html` 中对应的 SVG 即可，无需改动样式。

## 贡献

欢迎 Issue 与 PR。提交前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，并确保：

```bash
npm test        # 单元测试通过
npm start       # 手动验证主页与工坊
```

## 许可证

[MIT](LICENSE) © PicMint contributors

代码可自由用于商业项目与二次开发，保留版权声明即可。**品牌名与 Logo 不在授权范围内**，衍生项目请更换名称与视觉标识。
