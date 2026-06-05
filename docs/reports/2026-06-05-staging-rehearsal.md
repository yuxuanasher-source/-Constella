# 准生产彩排记录

准生产发布时间：未发布
准生产地址：未生成
代码分支：codex/full-project-ui
Commit：2abc84a
Supabase 项目：未创建，当前 Supabase CLI 未登录
测试账号：未创建

## 当前边界

- 本轮只做 staging / 准生产彩排。
- 不连接正式生产库。
- 不使用真实用户、真实钱、真实生产数据库。
- 不运行 `supabase db reset`。

## 第一步三件事状态

- 新建 Supabase staging 项目 `your-app-staging`：不通过，阻塞于 Supabase CLI 未登录。
- 新建私有 bucket `evidence-private`：不通过，需先完成 Supabase 登录并 link staging 项目。
- 配置部署环境变量：不通过，部署平台未检测到本地配置，且缺 staging Supabase URL/keys。

## 基础检查

- type-check：未执行，尚未进入部署后检查阶段
- lint：未执行，尚未进入部署后检查阶段
- test：未执行，尚未进入部署后检查阶段
- build：未执行，尚未进入部署后检查阶段

## 人工链路

- 创建项目：未执行
- 发布任务：未执行
- 主播开播：未执行
- 主播关播：未执行
- 主播报数：未执行
- 主播截图上传：未执行
- 运营审核：未执行
- 财务结算：未执行

## 重点红灯

- `/m/diagnosis` 是否真实请求 `/api/ai/diagnosis`：未验证，需 staging 地址后用浏览器网络请求确认。
- 主播上传截图是否真实请求 `/api/uploads/signed`：未验证，需 staging 地址后用浏览器网络请求确认。

## 阻塞问题

1. Supabase CLI 返回 `Access token not provided`，无法创建或读取 staging 项目。
2. 未检测到本地 Vercel/Fly/Render/Netlify/Railway 配置，且未安装全局 Vercel CLI。
3. 缺少 staging Supabase 的 Project URL、anon key、service role key，无法配置部署环境变量。

## 解锁后继续执行

```powershell
pnpm exec supabase login
pnpm exec supabase projects create your-app-staging --org-id <org-id> --db-password <staging-db-password> --region <region> --size nano
pnpm exec supabase link --project-ref <staging-project-ref> --password <staging-db-password>
pnpm exec supabase db query --linked "insert into storage.buckets (id, name, public) values ('evidence-private', 'evidence-private', false) on conflict (id) do update set public = false;"
pnpm exec supabase db push
```

## 结论

不能进入正式发布准备。

当前结论只能是：准生产彩排尚未开始部署，阻塞在 staging 基础设施授权。
