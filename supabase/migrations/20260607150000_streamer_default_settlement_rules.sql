alter table public.streamers
  add column if not exists default_cps_rate_bps integer not null default 0;

alter table public.streamers
  drop constraint if exists streamers_default_cps_rate_bps_range,
  add constraint streamers_default_cps_rate_bps_range
    check (default_cps_rate_bps >= 0 and default_cps_rate_bps <= 10000);

alter table public.project_streamers
  add column if not exists cps_rate_bps integer not null default 0;

alter table public.project_streamers
  drop constraint if exists project_streamers_cps_rate_bps_range,
  add constraint project_streamers_cps_rate_bps_range
    check (cps_rate_bps >= 0 and cps_rate_bps <= 10000);
