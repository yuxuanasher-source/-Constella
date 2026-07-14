# AI 总实施提示词

将下面内容作为新编码任务的首条提示词使用。

```text
你正在维护 Constella/经营舱项目。请把 public/arco-redesign 中的 12 个静态 HTML 原型像素级迁移到现有 Next.js 16 App Router 运营控制台，同时完成前端架构和性能重建。

开始前必须阅读：
- deliverables/constella-ui-migration-kit-2026-07-14/docs/01-migration-architecture.md
- deliverables/constella-ui-migration-kit-2026-07-14/docs/02-pixel-design-spec.md
- deliverables/constella-ui-migration-kit-2026-07-14/docs/03-performance-maintainability.md
- deliverables/constella-ui-migration-kit-2026-07-14/docs/04-page-route-data-map.md
- deliverables/constella-ui-migration-kit-2026-07-14/docs/05-execution-acceptance-release.md

视觉基准：
- public/arco-redesign/constella-ui.html 用于整体评审。
- public/arco-redesign 中对应独立 HTML 和共享 CSS 用于像素细节。

必须遵守：
1. 保留 app/api、features、Supabase、RBAC、DTO、结算和审计规则。
2. 不把 HTML、iframe、模拟数据、Iconify CDN、Marked CDN 或 DOMPurify CDN 原样迁入生产页面。
3. 使用真实 App Router 路由；不要继续在一个 React 组件内通过字符串状态切换所有页面。
4. 默认使用 Server Component，只为必要交互建立小型 Client Component。
5. 不建立覆盖全部页面数据和动作的全局 Provider。
6. 图标使用 lucide-react；Markdown 使用项目已有安全渲染能力。
7. 样式通过 token 与 CSS Modules/现有 Tailwind 规则实现；除真正动态值外不新增内联样式。
8. 不撤销工作区中你没有创建的修改，不进行无关重构。
9. 每次只迁移一个明确阶段，完成实现、测试、截图和性能验证后再进入下一阶段。
10. 新旧 UI 需要通过功能开关并存，直至全量验收完成。

工作顺序：
1. 检查 git 状态、正式路由、现有测试和数据服务。
2. 测量当前构建产物和关键页面性能，保存基线。
3. 建立 token、公共控件、服务端壳层和 Playwright 视觉测试。
4. 按总览与项目、供给与准入、履约与报数、财务治理、知识库、AI、设置的顺序迁移。
5. 每个页面建立默认、加载、空态、错误、无权限和主要交互状态。
6. 每个页面在 1920x1080、1440x900、1280x800、768x1024、390x844 下截图比较。
7. 运行 lint、type-check、相关业务测试、API contract、UI smoke 和 build。

性能目标：
- LCP P75 <= 2.5s，INP P75 <= 200ms，CLS <= 0.1。
- 公共壳层客户端 JS <= 50KB gzip。
- 单页面新增客户端 JS <= 100KB gzip。
- 首屏客户端 JS 目标 <= 200KB gzip。
- 首轮像素差异 <= 0.2%，稳定后 <= 0.1%。

输出要求：
- 开始时报告发现的架构、风险、当前性能基线和本阶段文件范围。
- 实施中保持改动局部，逐项更新进度。
- 完成时列出修改文件、真实行为、视觉差异、性能变化、测试结果和剩余风险。
- 任何 API、权限或数据合同缺口都必须显式说明，不能用静态假数据掩盖。

先执行基础阶段：视觉基线、设计 token、公共壳层和测试框架。不要一次迁移全部页面。
```

