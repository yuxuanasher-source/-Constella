-- 录屏 AI 分析：落地语音转写结果。
-- transcript_text / transcript_utterances 由豆包（火山引擎）ASR 流水线写入，
-- asr_provider 记录转写提供方（如 doubao_asr）；确定性回退时三列保持空。
alter table public.recording_ai_analyses
  add column if not exists transcript_text text,
  add column if not exists transcript_utterances jsonb not null default '[]'::jsonb,
  add column if not exists asr_provider text;
