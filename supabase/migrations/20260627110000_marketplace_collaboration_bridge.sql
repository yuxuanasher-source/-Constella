-- 撮合达成 → 现有协作流程的桥接（决策：发单方选现有项目再桥接）。
-- 桥接天然两步（RLS 限定协作申请由接单方自插）：
--   1) 发单方为某个已启用 MCN 协作的现有项目创建分享链接，token 落到撮合达成记录上；
--   2) 接单方据此 token 提交一条 submitted 协作申请，复用现有审核→激活。
-- 这里补充撮合达成表承载分享引用所需的列。

alter table public.marketplace_deals
  add column if not exists collaboration_share_id uuid
    references public.project_collaboration_shares(id),
  add column if not exists collaboration_share_token text;

-- 说明：collaboration_share_token 仅本撮合达成的双方可读（沿用 marketplace_deals
-- 的 party_read 策略），用于让接单方一键提交协作申请；不进入公开层。
