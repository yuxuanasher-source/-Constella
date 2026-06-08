create or replace function public.current_streamer_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.streamers s
  where s.organization_id = target_organization_id
    and s.user_id = auth.uid()
  order by s.created_at desc, s.id desc
  limit 1;
$$;
