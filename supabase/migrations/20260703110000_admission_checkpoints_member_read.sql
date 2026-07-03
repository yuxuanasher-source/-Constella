-- 卡点字典对组织成员开放只读：主播端需要把驳回理由码渲染成名称。
-- 字典只含 key/名称/说明/权重，不含任何敏感经营数据。
create policy admission_review_checkpoints_member_read
on public.admission_review_checkpoints
for select
using (public.is_org_member(organization_id));
