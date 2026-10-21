# 贡献指南

先说清楚这个项目的边界，能省掉彼此很多时间。

## 项目原则（PR 会被拒绝的情形）

PicMint 的核心承诺是**零依赖、零构建、零上传**。以下改动通常不会被合并：

- 引入前端框架（React / Vue / Svelte…）或构建步骤（Webpack / Vite / Rollup）。
- 引入运行时依赖，包括体积很小的工具库。ZIP 写入、CRC32、格式化都已经手写实现。
- 添加任何形式的网络请求、埋点、第三方字体或 CDN 资源。
- 添加账号、云端存储、"同步" 类功能。
- 用截图代替可运行代码，或提交未经本地验证的 UI 改动。

如果确实需要新依赖，请先在 Issue 里说明为什么 20 行原生代码做不到。

## 开发流程

```bash
git clone https://github.com/aaasjc/picmint.git
cd picmint
npm start      # http://127.0.0.1:4173
npm test       # node:test，无需安装任何东西
```

没有 `npm install` 这一步，仓库里也没有 `node_modules`。

## 代码风格

- 原生 ES Modules，`import` / `export`，浏览器与 Node 共用纯函数。
- 2 空格缩进，单引号，语句末尾保留分号。
- 纯逻辑放 `assets/js/image-core.js`，DOM 相关代码放页面控制器，便于单元测试。
- CSS 使用 `theme-tokens.css` 里的变量，不要在组件里硬编码颜色。
- 注释解释**为什么**，不解释**是什么**。
- 面向用户的中文文案要克制：不用感叹号，不堆营销词。

## 提交前自检

1. `npm test` 全部通过。
2. `npm start` 后手动验证：主页在 1440px 与 390px 两个宽度下没有横向滚动。
3. 拖入一张真实照片，确认压缩、美化、ZIP 导出三条路径都正常。
4. 打开 Network 面板，确认处理过程中没有新增请求。
5. 新增可访问性元素时检查键盘可达（Tab / Enter / Escape）。

## 提交信息

采用 Conventional Commits 的简化形式：

```text
feat: 支持目标体积压缩
fix: 修正 PNG 输出时质量滑块未禁用
docs: 补充 AVIF 浏览器支持说明
perf: 大图改用两阶段降采样
chore: 升级 CI Node 版本
```

## Pull Request

- 一个 PR 只做一件事，描述里写清**改动前的问题**与**验证方式**。
- UI 改动附上截图（桌面 + 移动各一张）。
- 涉及 `image-core.js` 的改动必须补测试。
- 不要修改 `LICENSE` 中的版权主体，也不要改品牌名。

## 报告问题

提交 Issue 时请包含：

- 浏览器与版本（AVIF 相关问题尤其重要）。
- 图片的格式、尺寸、体积（无需上传文件本身）。
- 预期结果与实际结果。
- 控制台报错截图（如有）。

## 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
