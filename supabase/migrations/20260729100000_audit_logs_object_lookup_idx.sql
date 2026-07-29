create index if not exists audit_logs_org_object_created_idx
on public.audit_logs (organization_id, object_type, object_id, created_at desc);
