alter table public.projects
  add column if not exists vendor_name text not null default '',
  add column if not exists product_name text not null default '',
  add column if not exists agent_name text not null default '',
  add column if not exists supplier_name text not null default '',
  add column if not exists description text not null default '';
