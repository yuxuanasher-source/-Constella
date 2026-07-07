-- Settlement batch titles.
--
-- Operators want to name a settlement batch when they create it (方案:
-- 结算流程改造 step 3 「确定结算批次需要填写相关的信息」). The batch list and
-- the streamer statement notification both display this title, falling back
-- to the generated "项目 · 类型" label when absent.

alter table public.settlement_batches
  add column if not exists title text;

-- Recreate the atomic generation RPC with an optional title parameter. The
-- parameter defaults to null so existing callers keep working unchanged.
drop function if exists public.generate_settlement_batch(
  uuid, uuid, public.settlement_batch_type, date, date,
  numeric, numeric, numeric, jsonb, uuid, jsonb
);

create or replace function public.generate_settlement_batch(
  p_organization_id uuid,
  p_project_id uuid,
  p_batch_type public.settlement_batch_type,
  p_period_start date,
  p_period_end date,
  p_computed_amount numeric,
  p_manual_amount numeric,
  p_adjustment_amount numeric,
  p_evidence_summary jsonb,
  p_created_by uuid,
  p_items jsonb,
  p_title text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_batch public.settlement_batches%rowtype;
  v_item jsonb;
  v_item_row public.settlement_batch_items%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_report_id uuid;
begin
  insert into public.settlement_batches (
    organization_id, project_id, batch_type, status,
    period_start, period_end,
    computed_amount, manual_amount, adjustment_amount,
    evidence_summary, created_by, title
  )
  values (
    p_organization_id, p_project_id, p_batch_type, 'generated',
    p_period_start, p_period_end,
    p_computed_amount, p_manual_amount, p_adjustment_amount,
    coalesce(p_evidence_summary, '{}'::jsonb), p_created_by,
    nullif(trim(coalesce(p_title, '')), '')
  )
  returning * into v_batch;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.settlement_batch_items (
      organization_id, settlement_batch_id, project_id,
      streamer_id, live_report_id, item_type,
      computed_amount, manual_amount, adjustment_amount,
      evidence_level, evidence_snapshot
    )
    values (
      p_organization_id, v_batch.id, p_project_id,
      nullif(v_item->>'streamer_id', '')::uuid,
      nullif(v_item->>'live_report_id', '')::uuid,
      coalesce(nullif(v_item->>'item_type', ''), 'live_report'),
      coalesce((v_item->>'computed_amount')::numeric, 0),
      coalesce((v_item->>'manual_amount')::numeric, 0),
      coalesce((v_item->>'adjustment_amount')::numeric, 0),
      nullif(v_item->>'evidence_level', '')::public.evidence_level,
      coalesce(v_item->'evidence_snapshot', '{}'::jsonb)
    )
    returning * into v_item_row;

    v_items := v_items || to_jsonb(v_item_row);

    -- Mirror markReportSettled: claim the report only if not already pointing at
    -- an item. The settlement_batch_items unique index is the authoritative
    -- per-type dedup and rolls back the whole transaction on a concurrent
    -- duplicate.
    v_report_id := nullif(v_item->>'live_report_id', '')::uuid;
    if v_report_id is not null then
      update public.live_reports
        set settled_batch_item_id = v_item_row.id
      where id = v_report_id
        and settled_batch_item_id is null;
    end if;
  end loop;

  return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_items);
end;
$$;
