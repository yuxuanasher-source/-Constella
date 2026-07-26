alter table public.streamer_profile_insights
drop constraint if exists streamer_profile_insights_source_type_check;

alter table public.streamer_profile_insights
add constraint streamer_profile_insights_source_type_check check (
  source_type in ('recording_ai_analysis', 'admission_review')
);

create index if not exists admission_review_evaluations_application_org_stage_idx
on public.admission_review_evaluations (application_id, organization_id, stage);
