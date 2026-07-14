# 经营舱 UI 像素级迁移交付包

生成日期：2026-07-14

本交付包用于将 `public/arco-redesign` 中的静态产品原型迁移到现有 Next.js 运营控制台。迁移目标不只是换皮，而是在保留 API、Supabase、权限和业务规则的前提下，重新建立可维护、按路由分包、可视觉回归的前端架构。

## 目录

- `docs/`：架构、视觉规格、性能预算、路由映射和执行验收方案。
- `frontend-design/source/`：12 个独立 HTML 页面及共享 CSS，是可编辑的视觉源稿。
- `frontend-design/single-file/constella-ui.html`：便于评审的单文件交互原型。
- `frontend-design/assets/`：原型依赖的品牌图片。
- `frontend-design/tools/`：重新生成单文件原型的构建脚本。
- `prompts/`：可直接交给编码 AI 的分阶段实现提示词。
- `references/`：项目内与本次迁移直接相关的历史设计和 QA 资料。
- `MANIFEST.txt`：包内文件清单。
- `CHECKSUMS.sha256`：文件完整性校验值。

## 推荐阅读顺序

1. `docs/01-migration-architecture.md`
2. `docs/02-pixel-design-spec.md`
3. `docs/03-performance-maintainability.md`
4. `docs/04-page-route-data-map.md`
5. `docs/05-execution-acceptance-release.md`
6. `prompts/00-master-implementation-prompt.md`

## 原型使用

直接打开：

```text
frontend-design/single-file/constella-ui.html
```

独立页面需要保持 `source/` 中 HTML 与 CSS 的相对位置，并将 `assets/ops-mascot-logo.png` 放到原项目约定的 `public/brand/` 路径。单文件版本已内嵌样式与品牌资源，更适合离线评审。

## 正式实现边界

- 静态 HTML 是视觉和交互意图基准，不是生产代码模板。
- 不把 Iconify、Marked 或 DOMPurify CDN 引入正式应用。
- 正式图标使用项目已有的 `lucide-react`。
- Markdown 使用项目已有的安全渲染能力，编辑器按需加载。
- 不在 UI 迁移 PR 中重写数据库、API、RBAC 或结算规则。
- 每个页面独立迁移、测试、灰度和回滚。

## 当前技术基线

- Next.js 16.2.6 App Router
- React 19.2.4
- TypeScript 5
- Tailwind CSS 4
- Supabase SSR / Supabase JS
- Vitest 4.1.8
- Lucide React

