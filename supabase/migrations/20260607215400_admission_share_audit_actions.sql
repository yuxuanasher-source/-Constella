alter type public.audit_action
  add value if not exists 'create_share_board';

alter type public.audit_action
  add value if not exists 'revoke_share_board';

alter type public.audit_action
  add value if not exists 'vendor_review_submit';

alter type public.audit_action
  add value if not exists 'vendor_review_sync';
