-- Ported from master lineage (project_public_streamer_fields): lets a project be
-- opened to organization-internal streamers with a public announcement summary.
alter table public.projects
  add column if not exists is_public_to_streamers boolean not null default false,
  add column if not exists public_summary text not null default '',
  add column if not exists game_download_url text;

alter table public.projects
  drop constraint if exists projects_game_download_url_http;
alter table public.projects
  add constraint projects_game_download_url_http check (
    game_download_url is null
    or game_download_url ~* '^https?://'
  );

create index if not exists projects_org_public_streamer_idx
on public.projects (organization_id, status, created_at desc)
where is_public_to_streamers = true;
