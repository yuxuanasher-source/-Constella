# 基础设施与壳层提示词

```text
执行经营舱 UI 迁移的基础阶段，只实现设计基础、公共壳层和视觉测试，不迁移业务页面，不改 API 或数据库。

请先检查：
- app/(ops)/console/layout.tsx
- app/globals.css
- components/reference-ui/ops-reference.jsx 中现有 Sidebar、TopBar 和路由逻辑
- public/arco-redesign/sidebar.css
- public/arco-redesign/typography.css
- public/arco-redesign/index.html
- package.json 与当前测试配置

目标：
1. 创建 styles/ops/tokens.css 和必要的 foundation 样式。
2. 创建 components/ops-shell 下的服务端壳层、侧栏、顶栏和移动导航。
3. 创建第一批无业务语义控件：Button、IconButton、Badge、Card、Input、Select、Tabs、Table shell、Dialog/Drawer shell。
4. 在不影响旧 UI 的前提下增加一个受功能开关保护的新壳层入口。
5. 增加 Playwright 截图测试和固定视口配置；若依赖不存在，只添加最小测试依赖。

像素要求：
- 桌面侧栏 248px；901-1024 为 220px；<=900 转为顶部横向导航。
- 顶栏桌面 68px，移动端 60px。
- 导航项 38px，徽标 20px，卡片圆角 6px。
- 普通文本 12px，分区标题 14px，品牌 16px，页面主标题 22px。
- 使用设计文档中的颜色 token，不在组件中复制色值。

架构要求：
- layout 默认保持 Server Component。
- 只有移动菜单、搜索或用户菜单等交互区域使用 `use client`。
- 侧栏使用 Next Link，不在壳层加载任何业务列表或启动轮询。
- 侧栏不要自动预取全部重页面。
- 图标只用 lucide-react。
- 不复制原型 HTML 的 DOM；提炼相同视觉结构。

验收：
- 新旧壳层可通过功能开关切换。
- 1920、1440、1024、768、390 宽度无溢出和遮挡。
- 键盘可操作，图标按钮有 aria-label 和焦点样式。
- 运行 lint、type-check、相关测试和 build。
- 报告公共壳层客户端 JS 大小；目标 <= 50KB gzip。
```

