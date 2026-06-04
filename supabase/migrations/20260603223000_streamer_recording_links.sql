create table public.streamer_recording_links (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete restrict,
  product text not null,
  category text not null,
  recording_url text not null,
  recording_month text not null,
  status public.recording_review_status not null default 'submitted',
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint streamer_recording_links_month_format check (
    recording_month ~ '^\d{4}-\d{2}$'
  ),
  constraint streamer_recording_links_http_url check (
    recording_url ~* '^https?://'
  )
);

create index streamer_recording_links_streamer_month_idx
on public.streamer_recording_links (organization_id, streamer_id, recording_month desc);

create trigger streamer_recording_links_touch_updated_at
before update on public.streamer_recording_links
for each row execute function public.touch_updated_at();

alter table public.streamer_recording_links enable row level security;

create policy streamer_recording_links_staff_access
on public.streamer_recording_links
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_recording_links_streamer_read_own
on public.streamer_recording_links
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy streamer_recording_links_streamer_insert_own
on public.streamer_recording_links
for insert
with check (streamer_id = public.current_streamer_id(organization_id));
