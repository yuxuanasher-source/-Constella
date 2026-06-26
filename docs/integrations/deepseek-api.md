# DeepSeek API 学习与接入笔记

> 来源：<https://api-docs.deepseek.com/zh-cn/>（官方站点对自动抓取返回 403，本文档结合官方文档与现行接口约定整理，**计费、模型版本以官方控制台为准**）。
> 关联实现：`features/ai/providers/deepseek-provider.ts` 及其单测。

DeepSeek 的对话接口与 **OpenAI Chat Completions 协议兼容**，迁移成本极低：把 `base_url` 指向 DeepSeek、把 `Authorization` 换成 DeepSeek 的 Key 即可复用 OpenAI SDK。

---

## 1. 接入要点速查

| 项目          | 值                                                                        |
| ------------- | ------------------------------------------------------------------------- |
| Base URL      | `https://api.deepseek.com`（兼容写法 `https://api.deepseek.com/v1`）      |
| Beta Base URL | `https://api.deepseek.com/beta`（启用 prefix / FIM 等 beta 能力）         |
| 鉴权          | 请求头 `Authorization: Bearer <DEEPSEEK_API_KEY>`                         |
| 主端点        | `POST /chat/completions`                                                  |
| 其他端点      | `POST /completions`（FIM 补全，beta）、`GET /models`、`GET /user/balance` |
| 内容类型      | `Content-Type: application/json`                                          |

> 注意：这里的 `/v1` 只是为了兼容 OpenAI SDK 的路径习惯，**与 DeepSeek 模型版本无关**。

### 模型

| 模型 ID             | 说明                       | 典型用途                             |
| ------------------- | -------------------------- | ------------------------------------ |
| `deepseek-chat`     | 通用对话模型（非思考模式） | 摘要、改写、结构化抽取、工具编排     |
| `deepseek-reasoner` | 思考模型，会先输出推理过程 | 复杂推理、复盘、需要链路可解释的判断 |

`deepseek-reasoner` 的特殊约定：

- 响应中除 `content` 外，还会带 `reasoning_content`（思维链）。**不要把 `reasoning_content` 拼回下一轮上下文**，否则会报错。
- 不支持 `temperature` / `top_p` / `presence_penalty` / `frequency_penalty` / `logprobs` 等采样参数（传了也会被忽略或报错）。
- 最大输出 token 更大（包含思维链），按官方文档配置 `max_tokens`。

---

## 2. 调用示例

### cURL

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "system", "content": "你是经营舱助手"},
      {"role": "user", "content": "用一句话总结这个项目"}
    ],
    "stream": false
  }'
```

### 复用 OpenAI SDK（Node / TypeScript）

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const completion = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "你好" }],
});
console.log(completion.choices[0].message.content);
```

本仓库不引入 OpenAI SDK，直接用 `fetch` 对接（见第 6 节）。

---

## 3. 请求参数

| 参数                                     | 类型               | 说明                                                                  |
| ---------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `model`                                  | string             | 必填，`deepseek-chat` 或 `deepseek-reasoner`                          |
| `messages`                               | array              | 必填，元素含 `role`（`system`/`user`/`assistant`/`tool`）与 `content` |
| `stream`                                 | boolean            | 是否流式返回，默认 `false`                                            |
| `temperature`                            | number             | 采样温度，默认 1.0；reasoner 忽略                                     |
| `top_p`                                  | number             | 核采样；与 `temperature` 二选一调整                                   |
| `max_tokens`                             | number             | 最大输出 token；不含输入                                              |
| `stop`                                   | string \| string[] | 停止序列                                                              |
| `response_format`                        | object             | `{ "type": "json_object" }` 开启 JSON 输出                            |
| `tools`                                  | array              | 函数调用工具定义（OpenAI 格式）                                       |
| `tool_choice`                            | string \| object   | `auto` / `none` / 指定函数                                            |
| `frequency_penalty` / `presence_penalty` | number             | 重复惩罚                                                              |
| `logprobs` / `top_logprobs`              | boolean / number   | 返回 token 概率                                                       |

### 推荐 `temperature`（官方建议）

| 场景            | temperature |
| --------------- | ----------- |
| 代码生成 / 数学 | 0.0         |
| 数据抽取 / 分析 | 1.0         |
| 通用对话        | 1.3         |
| 翻译            | 1.3         |
| 创意写作        | 1.5         |

> DeepSeek API 内部对 `temperature` 做了一次映射，行为与本地直接推理略有差异，按场景取上表值即可。

---

## 4. 响应结构

非流式响应（OpenAI 兼容）：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "deepseek-chat",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "……" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 26,
    "completion_tokens": 100,
    "total_tokens": 126,
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 26
  }
}
```

- `finish_reason`：`stop`（自然结束）/ `length`（达 max_tokens）/ `tool_calls`（触发工具）/ `content_filter`。
- 工具调用时 `message.content` 为 `null`，`message.tool_calls` 为数组。
- `reasoner` 会额外返回 `message.reasoning_content`。
- `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 用于上下文缓存计费（见第 5 节）。

### 流式（`stream: true`）

返回 `text/event-stream`，逐块下发 `data: {...}` 的 delta，最后以 `data: [DONE]` 结束。加 `"stream_options": {"include_usage": true}` 可在最后一帧带上 usage。

---

## 5. 计费与上下文缓存

- 计费按 **输入 / 输出 token** 分别计价，输出更贵。
- **上下文硬盘缓存**自动开启：重复前缀命中缓存的输入 token（`prompt_cache_hit_tokens`）按更低单价计费，可显著降低多轮 / 长系统提示的成本。无需手动开启，命中情况通过 `usage` 返回。
- 具体单价随官方调整，**部署前以 DeepSeek 控制台为准**；本仓库 Provider 里 `DEFAULT_PRICING` 仅为参考值，可通过 `pricing` 覆盖。

---

## 6. 错误码

| HTTP | 含义           | 处理           |
| ---- | -------------- | -------------- |
| 400  | 请求体格式错误 | 修正 body 结构 |
| 401  | 鉴权失败       | 检查 API Key   |
| 402  | 余额不足       | 充值           |
| 422  | 参数非法       | 调整参数       |
| 429  | 触发限流       | 退避重试       |
| 500  | 服务端错误     | 稍后重试       |
| 503  | 服务繁忙       | 退避重试       |

错误响应体形如：`{ "error": { "message": "...", "type": "...", "code": "..." } }`。

---

## 7. 在经营舱中的接入

DeepSeek 作为 `features/ai` LLM 网关的一个 `AiProvider`：

- 实现：`features/ai/providers/deepseek-provider.ts`
  - `createDeepSeekProvider(config)` 返回符合 `AiProvider` 契约的实例，`name: "deepseek"`，支持 `text` / `structured` / `tools` / `shadow` 能力。
  - `runText` → 普通对话；`runStructured` → 自动加 `response_format: { type: "json_object" }` 并解析 JSON；`runWithTools` → 把网关 `AiTool` 映射成 OpenAI function 定义。
  - 未配置 `DEEPSEEK_API_KEY` 时返回 `status: "degraded"`（`provider_unconfigured`），不抛异常，主链路（确定性工具）不受影响。
  - `fetchImpl` / `now` 可注入，便于单测；真实调用走全局 `fetch`。
- 环境变量（见 `.env.example`）：
  - `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）。
  - `readDeepSeekConfigFromEnv(process.env)` 读取上述变量。
- 接入网关：把 Provider 加入 `runAiGateway({ providers, primaryProvider: "deepseek", request })` 的 `providers` 列表即可；多 Provider 时按 `primaryProvider` 优先、其余作为兜底。

### 安全约定（与仓库既有约束一致）

- Provider 为只读推理，不直接落库；审计 / 调用台账走 `features/ai/invocation-ledger.ts`。
- 主播端字段级脱敏在工具层（`ai-tool-layer.ts` 的 `streamerForbiddenKeys`）完成，**不要把脱敏字段塞进发往 DeepSeek 的 prompt**。
- API Key 只从环境变量读取，禁止写入源码 / 日志 / 响应；单测中已断言响应序列化不包含 Key。

### 最小调用示例

```ts
import {
  createDeepSeekProvider,
  readDeepSeekConfigFromEnv,
} from "@/features/ai/providers/deepseek-provider";

const provider = createDeepSeekProvider(readDeepSeekConfigFromEnv(process.env));
const result = await provider.runStructured({
  promptKey: "project_review",
  promptVersion: 1,
  messages: [
    { role: "system", content: "只输出 JSON" },
    { role: "user", content: "总结这个项目的复盘要点" },
  ],
});
// result.status === "succeeded" -> result.structuredOutput
```
