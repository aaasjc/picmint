# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 计划中

- 目标体积压缩：对质量做二分搜索，命中用户设定的 KB 上限。
- 预设方案：把常用参数组合保存为命名预设。
- 队列拖拽排序与输出文件名模板。

## [1.0.0] — 2026-10-21

首个公开版本。经过一次完整的端到端验证：真实浏览器内生成测试图、批量处理、美化重排、ZIP 解包校验（`zipfile.testzip()` 无错误，中文文件名正常）。

### 新增

- **主页**：深色品牌站，含 Hero 实时演示、功能网格、页面内可用的压缩演示、合作伙伴墙、FAQ、CTA。
- **Studio 工坊**：
  - 批量队列，最多 128 张，支持拖拽入队、键盘操作、单张移除、按名排序。
  - 输出格式：JPEG / PNG / WebP / AVIF，按浏览器实际编码能力启用或禁用。
  - 质量滑块（30–100），PNG 自动禁用并标注"无损"。
  - 最大边缩放，提供 2560 / 1920 / 1280 / 800 快捷值，绝不放大原图。
  - 截图美化：4 套渐变背景、留白 0–20%、圆角 0–48px、可选水印文字。
  - 输出体积大于原图时默认保留原图，并标注"原图"。
  - 单张下载、批量 ZIP 导出、复制预览。
  - `Ctrl/⌘ + O` 添加、`Enter` 处理、`Delete` 移除。
- **核心库** `image-core.js`：
  - `formatBytes` / `fitDimensions` / `savedPercent` / `buildOutputName` 等纯函数。
  - `processImage`：解码 → 缩放 → 编码，JPEG 自动白底填充。
  - `beautifyImage`：渐变背景、圆角裁切、柔和投影、水印合成。
  - `createZip`：手写 stored ZIP，UTF-8 文件名标志位，CRC32 校验。
- **工程**：
  - 零依赖静态服务器 `scripts/serve.mjs`（防目录穿越）。
  - `node:test` 单元测试，覆盖纯函数、CRC32 校验值、ZIP 二进制结构。
  - GitHub Actions：CI（Node 18 / 20 / 22）+ Pages 自动部署。
  - MIT 许可证；贡献指南、行为准则、安全策略、架构文档。

### 设计

- 设计系统集中在 `theme-tokens.css`：颜色、字号、间距、圆角、阴影、动效曲线。
- 主页支持 `prefers-reduced-motion`，渐入动画在无 JS 环境下自动降级为可见。
- 移动端 390px 宽度下无横向滚动，画布与参数面板改为纵向堆叠。

[未发布]: https://github.com/picmint/picmint/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/picmint/picmint/releases/tag/v1.0.0
