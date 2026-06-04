alter table public.profiles
add column if not exists phone text,
add column if not exists login_account text,
add column if not exists requires_onboarding boolean not null default false;

create unique index if not exists profiles_phone_unique
on public.profiles (phone)
where phone is not null;

create unique index if not exists profiles_login_account_unique
on public.profiles (login_account)
where login_account is not null;
