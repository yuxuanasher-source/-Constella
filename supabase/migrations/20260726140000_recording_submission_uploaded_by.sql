alter table public.recording_submissions
  add column if not exists uploaded_by uuid references public.profiles(id);

comment on column public.recording_submissions.uploaded_by is
  'User who submitted the recording. Historical rows remain nullable; all new application writes provide an uploader.';

create index if not exists recording_submissions_uploaded_by_submitted_at_idx
on public.recording_submissions (uploaded_by, submitted_at desc);
