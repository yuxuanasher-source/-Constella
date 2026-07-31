-- Expiring, revocable knowledge-base share links.
-- Plaintext bearer tokens are returned once by the application and are never
-- persisted. Public reads are performed by a server-side service-role client
-- after hashing the presented token.

alter type public.audit_action
  add value if not exists 'create_knowledge_share';
alter type public.audit_action
  add value if not exists 'revoke_knowledge_share';

create table public.knowledge_share_links (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique
    constraint knowledge_share_links_token_hash_format
      check (token_hash ~ '^[0-9a-f]{64}$'),
  title text not null
    constraint knowledge_share_links_title_length
      check (length(btrim(title)) between 1 and 200),
  source_document_id text,
  cos_key text not null unique,
  request_key text not null,
  status text not null default 'pending'
    constraint knowledge_share_links_status_check
      check (status in ('pending', 'active', 'failed')),
  created_by uuid not null references public.profiles(id),
  created_by_name text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint knowledge_share_links_source_document_length
    check (source_document_id is null or length(source_document_id) between 1 and 128),
  constraint knowledge_share_links_request_key_length
    check (length(request_key) between 1 and 128),
  constraint knowledge_share_links_cos_key_from_id
    check (cos_key = 'knowledge-base-share/' || id::text || '.json'),
  constraint knowledge_share_links_expiry_after_creation
    check (expires_at > created_at),
  constraint knowledge_share_links_revocation_pair
    check (
      (revoked_at is null and revoked_by is null)
      or (revoked_at is not null and revoked_by is not null)
    ),
  unique (organization_id, created_by, request_key)
);

create index knowledge_share_links_active_idx
  on public.knowledge_share_links (organization_id, expires_at desc)
  where status = 'active' and revoked_at is null;

create index knowledge_share_links_document_active_idx
  on public.knowledge_share_links (organization_id, source_document_id, created_at desc)
  where status = 'active' and revoked_at is null;

alter table public.knowledge_share_links enable row level security;

create or replace function public.can_manage_knowledge_share_links(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner', 'ops_manager', 'operator_business')
  );
$$;

revoke all on function public.can_manage_knowledge_share_links(uuid)
  from public, anon;
grant execute on function public.can_manage_knowledge_share_links(uuid)
  to authenticated, service_role;

create policy knowledge_share_links_authenticated_manage
on public.knowledge_share_links
for all
to authenticated
using (public.can_manage_knowledge_share_links(organization_id))
with check (public.can_manage_knowledge_share_links(organization_id));

revoke all on table public.knowledge_share_links
  from public, anon, authenticated;
grant all on table public.knowledge_share_links to service_role;
