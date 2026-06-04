create type public.mcn_onboarding_status as enum (
  'submitted',
  'reviewing',
  'approved',
  'rejected'
);

create table public.mcn_onboarding_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  company_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  business_scale text,
  note text,
  source text not null default 'login_page',
  status public.mcn_onboarding_status not null default 'submitted',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcn_onboarding_company_required check (nullif(trim(company_name), '') is not null),
  constraint mcn_onboarding_contact_required check (nullif(trim(contact_name), '') is not null),
  constraint mcn_onboarding_email_required check (nullif(trim(contact_email), '') is not null),
  constraint mcn_onboarding_phone_required check (nullif(trim(contact_phone), '') is not null)
);

create index mcn_onboarding_requests_status_idx
on public.mcn_onboarding_requests (status, created_at desc);

create trigger mcn_onboarding_requests_touch_updated_at
before update on public.mcn_onboarding_requests
for each row execute function public.touch_updated_at();

alter table public.mcn_onboarding_requests enable row level security;

create policy "public can submit mcn onboarding requests"
on public.mcn_onboarding_requests
for insert
to anon, authenticated
with check (true);
