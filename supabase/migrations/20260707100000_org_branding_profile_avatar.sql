-- 组织品牌自定义（侧边栏 LOGO 字标 / 品牌名 / 副标）与个人头像字标。
-- branding 结构：{ "logoText": "JY", "brandName": "经营舱", "brandTagline": "MCN OPERATIONS · v1.2" }
-- 写入仅经由 /api/organization/settings（owner 校验 + admin client），不开放 RLS update。

alter table public.organizations
  add column if not exists branding jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists avatar_text text;

alter table public.profiles
  drop constraint if exists profiles_avatar_text_length_check;

alter table public.profiles
  add constraint profiles_avatar_text_length_check check (
    avatar_text is null or char_length(avatar_text) <= 4
  );
