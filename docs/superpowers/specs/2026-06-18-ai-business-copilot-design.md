x a# AI 经营问答 Copilot 产品设计

日期：2026-06-18
范围：在现有经营舱中新增“自然语言 AI 经营问答”能力，让老板、运营负责人、一线运营和财务用自然语言追问经营数据。

## 1. 产品结论

本功能值得做，但第一版不做通用 BI，也不允许模型自由写 SQL。

推荐形态是：

```text
自然语言问题
-> 意图识别
-> 当前账号角色和组织范围
-> 白名单经营指标工具
-> 结构化事实和来源
-> AI 总结、风险解释、下一步建议
```

AI 可以读真实业务数据，但只能通过后端已经授权、已经脱敏、只读的指标工具读取。所有数字必须来自可追溯事实；所有建议都只进入人工确认，不直接执行发布、审核、结算、导出或权限变更。

## 2. 业务价值

现版本已经有项目、主播、排班、报数、OCR、结算、审计、通知、角色化看板和 M10 作战台。下一步增长点不是再堆模块，而是降低经营管理者从数据到判断的成本。

| 角色          | 当前痛点                                   | AI 经营问答价值                                      |
| ------------- | ------------------------------------------ | ---------------------------------------------------- |
| 老板 / 负责人 | 看板能看到结果，但追问原因仍要点进多个模块 | 直接问经营是否健康、毛利异常在哪里、哪些项目拖累利润 |
| 运营负责人    | 每天要在招募、排班、报数、异常之间排序     | 直接问今天先处理什么、哪些项目卡住、哪些主播缺口最大 |
| 一线运营      | 只需要知道自己今天要处理什么               | 直接问我的待办、待审核报数、需要联系的主播           |
| 财务          | 结算池、弱证据、人工承载和重开批次分散     | 直接问哪些金额可以安全结算、哪些钱有证据风险         |

## 3. MVP 目标

- 在 `/console` 角色化首页提供一个经营问答入口。
- 支持中文自然语言问题，不要求用户选择 SQL、表名或复杂筛选器。
- 第一版覆盖四类问题：
  - 经营健康：收入、毛利、毛利率、低毛利项目、高风险事项。
  - 今日优先级：待开播、待报数、待审核、异常任务、项目卡点。
  - 结算风险：结算池金额、弱证据金额、待生成批次、重开批次。
  - 证据质量：OCR/截图/系统时长差异、黄红证据、待人工复核。
- 回答必须包含：
  - `answer`：给人看的简短结论。
  - `facts[]`：所有数字事实和来源。
  - `findings[]`：无数字的判断。
  - `recommendations[]`：只读建议，必须人工处理。
  - `drilldowns[]`：可点击跳转到项目、任务、报数、结算、审计或通知。
  - `caveats[]`：数据范围、时间窗口和部分加载失败说明。
- 每次问答写入 AI invocation、AI tool invocation、usage event 和 audit log。

## 4. 非目标

- 不做“AI 自由写 SQL 查询数据库”。
- 不把自然语言回答当成财务凭证或结算依据。
- 不让 AI 自动审核报数、生成结算批次、锁定批次、重开批次或导出敏感文件。
- 不做跨组织数据问答。
- 不在第一版做任意图表生成、拖拽 BI 或历史多维分析器。
- 不向主播、协作 MCN、外部厂家开放内部经营问答。

## 5. 用户场景

### 5.1 老板 / 负责人

示例问题：

- “这个月经营健康吗？”
- “毛利异常在哪里？”
- “哪些项目最需要我关注？”

回答重点：

- 本月厂家应收、预估毛利、毛利率和高风险事项。
- 低毛利或负毛利项目。
- 高风险审计、结算重开、敏感动作。
- 下一步建议跳转到项目、结算或审计，不直接执行动作。

### 5.2 运营负责人

示例问题：

- “今天团队先处理什么？”
- “哪些项目卡在招募或报数？”
- “有哪些异常任务会影响交付？”

回答重点：

- 今日待开播、待报数、待审核、异常任务。
- 候选不足、录屏待审、最终入项确认 backlog。
- 运营动作排序和对应模块跳转。

### 5.3 一线运营

示例问题：

- “我今天有哪些待办？”
- “我负责的项目哪些报数待审？”
- “哪些主播需要联系补证据？”

回答重点：

- 只返回当前用户负责或授权项目。
- 不返回组织级应收、毛利、供应商成本等字段。
- 给出可操作队列和跳转。

### 5.4 财务

示例问题：

- “哪些金额可以安全结算？”
- “弱证据金额有多少？”
- “哪些批次重开过？”

回答重点：

- 结算池金额、结算池条数、待生成批次、弱证据金额、重开批次。
- 证据风险和人工承载说明。
- 只读分析，不允许在回答中生成或锁定批次。

## 6. 产品入口

第一版入口放在角色化首页第一屏 KPI 下方，形态为一个紧凑的“问经营数据”面板：

- 输入框：支持自然语言问题。
- 快捷问题：按角色给出 3 个推荐问题。
- 回答区：结论、事实、建议、可点击来源。
- 状态区：加载中、失败、无权限、数据不完整、AI provider 降级。

放在角色首页的原因：

- 用户刚登录时最容易产生追问。
- 当前角色和范围已经确定。
- 可以复用角色化看板的指标口径和脱敏边界。
- 不需要用户先进入复杂的 M10 tab。

## 7. 数据与权限架构

### 7.1 数据流

```text
POST /api/ai/business-copilot
  -> getAuthContext
  -> isMcnStaff
  -> loadRoleHomeDashboard
  -> runAiToolQuery("business_copilot_answer")
  -> runBusinessCopilotAgent
  -> return structured answer
```

第一版优先复用 `loadRoleHomeDashboard` 的角色化 DTO 作为事实来源。这样可以直接继承当前员工角色、组织范围、一线运营项目范围、财务字段边界和空态处理。

### 7.2 工具白名单

新增 AI 工具：

```text
business_copilot_answer
```

工具属性：

- `readOnly: true`
- `scopes: ["mcn_staff"]`
- 不接受 SQL。
- 不接受表名。
- 不接受任意字段投影。
- 输入只允许 `{ question, dashboard }`。
- 输出只允许结构化 answer envelope。

后续阶段可以把 `dashboard` 扩展成更丰富的语义层，但仍必须由后端白名单工具提供。

### 7.3 意图识别

MVP 使用确定性分类器，保证 CI 和无密钥环境可测：

- 含“健康、毛利、利润、收入、风险、老板、经营”进入 `executive_health`。
- 含“今天、优先、待办、卡住、排班、报数、异常、处理”进入 `operations_priority`。
- 含“结算、金额、财务、批次、应付、弱证据、重开”进入 `settlement_risk`。
- 含“OCR、截图、证据、黄、红、复核、时长”进入 `evidence_quality`。
- 不能归类则进入 `unsupported`，返回可提问范围，不查额外数据。

如果外部 LLM provider 可用，可以在后续阶段把分类器升级为 shadow 模式：LLM 给出候选意图，但确定性分类仍是回退和测试基线。

## 8. 输出契约

```ts
type BusinessCopilotAnswer = {
  question: string;
  intent:
    | "executive_health"
    | "operations_priority"
    | "settlement_risk"
    | "evidence_quality"
    | "unsupported";
  answer: string;
  facts: Array<{
    label: string;
    value: number | string;
    unit?: string;
    sourceTool: "role_home_dashboard";
    sourceId: string;
  }>;
  findings: Array<{
    summary: string;
    evidence: Array<{ sourceTool: string; sourceId: string }>;
  }>;
  recommendations: Array<{
    proposal: string;
    requiresHumanApproval: true;
    target?: { route: string; id?: string };
  }>;
  drilldowns: Array<{
    label: string;
    target: { route: string; id?: string };
  }>;
  caveats: string[];
  generatedAt: string;
};
```

数字只进入 `facts[]`，判断和建议不写裸数字。前端可以把 `facts[]` 渲染成事实卡片，把 `answer` 渲染成人话总结。

## 9. 安全边界

- 只允许 MCN 员工角色访问，主播角色直接 403。
- 继续依赖数据库 RLS 和服务端 RBAC，不把前端隐藏当安全边界。
- AI 工具继承 `actor.role`、`actor.organizationId`、`actor.userId`。
- 一线运营只拿自己负责项目的角色化看板数据。
- 财务不获得 owner-only 的项目毛利明细。
- 回答不得包含 supplier internal cost、internal risk notes、streamerForbiddenKeys。
- 所有工具调用写 `ai_invocations`、`ai_tool_invocations`、`usage_events`、`audit_logs`。
- AI 不返回可执行动作字段，例如 `execute`、`mutation`、`sql`。
- 错误时返回明确状态，不伪造成功。

## 10. 失败和空态

| 状态             | 产品表现                                 |
| ---------------- | ---------------------------------------- |
| 未登录           | 401，前端保持登录流                      |
| 主播或非员工角色 | 403，提示当前账号不能访问内部经营问答    |
| 问题为空         | 400，提示输入经营问题                    |
| 问题不在范围内   | 返回 `unsupported`，展示可问问题         |
| 看板数据为空     | 返回空态回答，引导先创建项目、排班或报数 |
| 部分数据缺失     | 在 `caveats[]` 标明数据范围              |
| AI 工具失败      | 返回错误，不写业务动作                   |

## 11. 验收标准

- owner 问“经营健康吗”时，返回经营健康类回答和角色化 KPI 事实。
- ops_manager 问“今天先处理什么”时，返回待办/风险队列和跳转。
- operator_business 不能通过问答拿到组织级应收、毛利或供应商成本。
- finance 问“哪些金额有风险”时，返回结算池和弱证据相关事实，不返回 owner-only 经营明细。
- streamer 访问 API 返回 403。
- 输入 `select * from settlement_batches` 不会执行 SQL，只会按自然语言归类或返回 unsupported。
- 每次成功问答都会写 AI 调用账本、工具调用账本、用量和审计。
- 前端问答面板可输入问题、提交、展示结论、事实、建议和来源跳转。
- `pnpm test:ai-system`、角色化看板相关测试、API route 测试和 UI smoke 通过。

## 12. 阶段规划

### Phase 1：受控经营问答 MVP

- 新增 `business_copilot_answer` 工具。
- 新增自然语言问答 agent。
- 新增 `/api/ai/business-copilot`。
- 在角色首页展示问答面板。
- 使用角色化看板 DTO 作为事实来源。

### Phase 2：经营语义层

- 把事实来源从角色化 DTO 扩展为专门的业务语义层。
- 增加项目级、主播级、供应商级、结算批次级 drilldown。
- 增加时间窗口参数，例如今天、本周、本月、项目周期。

### Phase 3：主动洞察

- 定时生成经营异常摘要。
- 将建议采纳结果写入 `recommendation_outcomes`。
- 对比历史项目和供应商表现，形成经营飞轮。

## 13. 产品原则

1. AI 是经营解释层，不是数据库管理员。
2. 自然语言可以触发查询意图，但不能突破权限。
3. 所有数字必须有来源。
4. 所有建议必须人工处理。
5. 第一版先回答高频经营问题，不做万能问答。
6. 能复用角色化指标口径，就不另起一套数字口径。
