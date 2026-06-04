create table public.ai_invocations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  actor_name text,
  actor_role public.app_role,
  scene text not null,
  object_type text,
  object_id text,
  provider_name text,
  primary_provider text,
  shadow_provider text,
  provider_route jsonb not null default '{}'::jsonb,
  status text not null default 'started',
  prompt_key text,
  prompt_version integer,
  prompt_hash text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_cents integer not null default 0,
  latency_ms integer,
  degraded_reason text,
  error_summary text,
  raw_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_invocations_status_check check (
    status in ('started', 'queued', 'succeeded', 'failed', 'degraded')
  ),
  constraint ai_invocations_usage_nonnegative check (
    prompt_tokens >= 0
    and completion_tokens >= 0
    and total_tokens >= 0
    and cost_cents >= 0
    and (latency_ms is null or latency_ms >= 0)
  )
);

create table public.ai_tool_invocations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ai_invocation_id uuid references public.ai_invocations(id) on delete cascade,
  tool_name text not null,
  input_summary jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  scopes text[] not null default '{}',
  read_only boolean not null default true,
  allowed boolean not null default false,
  status text not null default 'started',
  latency_ms integer,
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_tool_invocations_read_only check (read_only = true),
  constraint ai_tool_invocations_status_check check (
    status in ('started', 'succeeded', 'failed', 'denied')
  ),
  constraint ai_tool_invocations_latency_nonnegative check (
    latency_ms is null or latency_ms >= 0
  )
);

create table public.background_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_jobs_known_type check (
    job_type in ('ocr.extract_live_report', 'ai.replay', 'insight.scan')
  ),
  constraint background_jobs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'needs_confirmation', 'cancelled')
  ),
  constraint background_jobs_attempts_nonnegative check (
    attempt >= 0 and max_attempts > 0
  )
);

create table public.prompts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prompt_key text not null,
  version integer not null,
  status text not null default 'draft',
  content_hash text not null,
  body text not null,
  response_schema jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, prompt_key, version),
  constraint prompts_version_positive check (version > 0),
  constraint prompts_status_check check (status in ('draft', 'published', 'archived'))
);

create table public.streamer_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  metric_key text not null,
  metric_value integer not null default 0,
  metric_window text not null default 'all_time',
  source_invocation_id uuid references public.ai_invocations(id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint streamer_metrics_value_nonnegative check (metric_value >= 0)
);

create table public.supplier_scores (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  score_key text not null,
  score_value integer not null default 0,
  source_invocation_id uuid references public.ai_invocations(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint supplier_scores_value_range check (score_value >= 0 and score_value <= 10000)
);

create table public.scoring_weights (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  weight_key text not null,
  weight_bps integer not null default 0,
  status text not null default 'draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, weight_key),
  constraint scoring_weights_bps_range check (weight_bps >= 0 and weight_bps <= 10000),
  constraint scoring_weights_status_check check (status in ('draft', 'active', 'archived'))
);

create table public.recommendation_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  object_type text not null,
  object_id text not null,
  recommendation_key text not null,
  proposed_action text not null,
  outcome text not null default 'pending',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  business_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint recommendation_outcomes_status_check check (
    outcome in ('pending', 'adopted', 'rejected', 'expired')
  )
);

create table public.project_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  facts jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  caveats jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.ai_diagnoses (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid references public.streamers(id) on delete set null,
  live_report_id uuid references public.live_reports(id) on delete set null,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  diagnosis_type text not null,
  facts jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  caveats jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.ai_script_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid references public.streamers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  script_key text not null,
  version integer not null,
  status text not null default 'draft',
  content text not null,
  facts jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, script_key, version),
  constraint ai_script_versions_version_positive check (version > 0),
  constraint ai_script_versions_status_check check (status in ('draft', 'published', 'archived'))
);

alter table public.ocr_results
  add column if not exists ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  add column if not exists background_job_id uuid references public.background_jobs(id) on delete set null,
  add column if not exists provider text,
  add column if not exists confidence integer,
  add column if not exists needs_confirmation boolean not null default false,
  add column if not exists raw_response jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index ai_invocations_org_scene_idx
  on public.ai_invocations (organization_id, scene, created_at desc);
create index ai_invocations_object_idx
  on public.ai_invocations (organization_id, object_type, object_id);
create index ai_tool_invocations_invocation_idx
  on public.ai_tool_invocations (ai_invocation_id, created_at);
create index background_jobs_queue_idx
  on public.background_jobs (status, run_after, job_type);
create index background_jobs_invocation_idx
  on public.background_jobs (ai_invocation_id);
create index prompts_key_version_idx
  on public.prompts (organization_id, prompt_key, version desc);
create index streamer_metrics_streamer_key_idx
  on public.streamer_metrics (organization_id, streamer_id, metric_key);
create index supplier_scores_supplier_key_idx
  on public.supplier_scores (organization_id, supplier_id, score_key);
create index recommendation_outcomes_object_idx
  on public.recommendation_outcomes (organization_id, object_type, object_id);
create index project_reviews_project_idx
  on public.project_reviews (organization_id, project_id, created_at desc);
create index ai_diagnoses_streamer_idx
  on public.ai_diagnoses (organization_id, streamer_id, created_at desc);
create index ai_script_versions_key_idx
  on public.ai_script_versions (organization_id, script_key, version desc);
create index ocr_results_ai_invocation_idx
  on public.ocr_results (ai_invocation_id);
create index ocr_results_background_job_idx
  on public.ocr_results (background_job_id);

create trigger background_jobs_touch_updated_at
before update on public.background_jobs
for each row execute function public.touch_updated_at();

create trigger prompts_touch_updated_at
before update on public.prompts
for each row execute function public.touch_updated_at();

create trigger scoring_weights_touch_updated_at
before update on public.scoring_weights
for each row execute function public.touch_updated_at();

create trigger ai_script_versions_touch_updated_at
before update on public.ai_script_versions
for each row execute function public.touch_updated_at();

alter table public.ai_invocations enable row level security;
alter table public.ai_tool_invocations enable row level security;
alter table public.background_jobs enable row level security;
alter table public.prompts enable row level security;
alter table public.streamer_metrics enable row level security;
alter table public.supplier_scores enable row level security;
alter table public.scoring_weights enable row level security;
alter table public.recommendation_outcomes enable row level security;
alter table public.project_reviews enable row level security;
alter table public.ai_diagnoses enable row level security;
alter table public.ai_script_versions enable row level security;

create policy ai_invocations_staff_read
on public.ai_invocations for select
using (public.is_mcn_staff(organization_id));

create policy ai_invocations_staff_insert
on public.ai_invocations for insert
with check (public.is_mcn_staff(organization_id));

create policy ai_tool_invocations_staff_read
on public.ai_tool_invocations for select
using (public.is_mcn_staff(organization_id));

create policy ai_tool_invocations_staff_insert
on public.ai_tool_invocations for insert
with check (public.is_mcn_staff(organization_id));

create policy background_jobs_staff_access
on public.background_jobs for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy prompts_staff_access
on public.prompts for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy streamer_metrics_staff_read
on public.streamer_metrics for select
using (public.is_mcn_staff(organization_id));

create policy supplier_scores_staff_read
on public.supplier_scores for select
using (public.is_mcn_staff(organization_id));

create policy scoring_weights_staff_access
on public.scoring_weights for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy recommendation_outcomes_staff_access
on public.recommendation_outcomes for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy project_reviews_staff_access
on public.project_reviews for all
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id))
with check (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy ai_diagnoses_staff_access
on public.ai_diagnoses for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy ai_diagnoses_streamer_read_own
on public.ai_diagnoses for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy ai_script_versions_staff_access
on public.ai_script_versions for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));
