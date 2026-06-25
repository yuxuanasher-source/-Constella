alter table public.projects
  add column is_public_to_streamers boolean not null default false,
  add column public_summary text not null default '',
  add column game_download_url text;

alter table public.projects
  add constraint projects_game_download_url_http check (
    game_download_url is null
    or game_download_url ~* '^https?://'
  );

create index projects_org_public_streamer_idx
on public.projects (organization_id, status, created_at desc)
where is_public_to_streamers = true;
