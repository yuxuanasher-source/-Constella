-- P-A 账号库：补齐表级授权
-- 通过 Supabase 工具部署时默认权限会自动授予 anon/authenticated/service_role；
-- 若以 postgres 身份直接 psql 建表，则需显式授权，否则应用查询会报
-- "permission denied for table platform_accounts" (42501)。
-- 行级安全(RLS)仍负责限制可见行，此处仅放开表级访问。

grant all on table public.platform_accounts
  to anon, authenticated, service_role;

grant all on table public.platform_accounts_safe
  to anon, authenticated, service_role;
