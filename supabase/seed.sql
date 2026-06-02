insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'owner@jy-demo.local',
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Owner"}',
    false,
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'ops@jy-demo.local',
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Ops Manager"}',
    false,
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'operator@jy-demo.local',
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Business Operator"}',
    false,
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-4444-444444444444',
    'authenticated',
    'authenticated',
    'finance@jy-demo.local',
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Finance"}',
    false,
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-5555-5555-555555555555',
    'authenticated',
    'authenticated',
    'streamer@jy-demo.local',
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Streamer One"}',
    false,
    '',
    '',
    '',
    ''
  )
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'owner@jy-demo.local',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@jy-demo.local"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'ops@jy-demo.local',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"22222222-2222-2222-2222-222222222222","email":"ops@jy-demo.local"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'operator@jy-demo.local',
    '33333333-3333-3333-3333-333333333333',
    '{"sub":"33333333-3333-3333-3333-333333333333","email":"operator@jy-demo.local"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'finance@jy-demo.local',
    '44444444-4444-4444-4444-444444444444',
    '{"sub":"44444444-4444-4444-4444-444444444444","email":"finance@jy-demo.local"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'streamer@jy-demo.local',
    '55555555-5555-5555-5555-555555555555',
    '{"sub":"55555555-5555-5555-5555-555555555555","email":"streamer@jy-demo.local"}',
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider, provider_id) do nothing;

insert into public.profiles (id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'owner@jy-demo.local', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'ops@jy-demo.local', 'Ops Manager'),
  ('33333333-3333-3333-3333-333333333333', 'operator@jy-demo.local', 'Business Operator'),
  ('44444444-4444-4444-4444-444444444444', 'finance@jy-demo.local', 'Finance'),
  ('55555555-5555-5555-5555-555555555555', 'streamer@jy-demo.local', 'Streamer One')
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name,
    updated_at = now();

insert into public.organizations (id, name, code) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Jingying Demo MCN', 'jy-demo')
on conflict (id) do update
set name = excluded.name,
    code = excluded.code,
    updated_at = now();

insert into public.organization_members (organization_id, user_id, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'ops_manager', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'operator_business', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'finance', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'streamer', 'active')
on conflict (organization_id, user_id) do update
set role = excluded.role,
    status = excluded.status,
    updated_at = now();

insert into public.suppliers (id, organization_id, name, contact_name, contact_phone, note) values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Galaxy Supplier',
    'Lin Ops',
    '13800000000',
    'Demo supplier'
  )
on conflict (organization_id, name) do update
set contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone,
    note = excluded.note,
    updated_at = now();

insert into public.streamers (
  id,
  organization_id,
  user_id,
  display_name,
  real_name,
  phone,
  wechat,
  source_type,
  primary_supplier_id,
  cooperation_status,
  categories,
  platforms,
  styles,
  skills,
  default_settlement_method,
  default_price,
  risk_level,
  auto_trust,
  clean_report_count,
  duration_baseline,
  created_by
) values
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '55555555-5555-5555-5555-555555555555',
    'Streamer One',
    'Zhang Demo',
    '13900000001',
    'streamer_one',
    'signed',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'active',
    array['RPG', 'SLG'],
    array['Douyin'],
    array['Stable Explainer'],
    array['New Player Guide'],
    'cpt',
    80,
    'low',
    'trusted',
    8,
    180,
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    null,
    'Streamer Two',
    'Li Star',
    '13900000002',
    'streamer_two',
    'supplier_recommended',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'active',
    array['Card'],
    array['Kuaishou'],
    array['Interactive'],
    array['Welfare Conversion'],
    'cpt',
    70,
    'low',
    'probation',
    2,
    120,
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    null,
    'Risk Watch Streamer',
    'Wang North',
    '13900000003',
    'streamer_risk',
    'external',
    null,
    'paused',
    array['MMO'],
    array['Video Channel'],
    array['Traffic Push'],
    array['Short Burst'],
    'cpt',
    60,
    'medium',
    'restricted',
    0,
    null,
    '22222222-2222-2222-2222-222222222222'
  )
on conflict (id) do update
set display_name = excluded.display_name,
    real_name = excluded.real_name,
    phone = excluded.phone,
    wechat = excluded.wechat,
    source_type = excluded.source_type,
    primary_supplier_id = excluded.primary_supplier_id,
    cooperation_status = excluded.cooperation_status,
    categories = excluded.categories,
    platforms = excluded.platforms,
    styles = excluded.styles,
    skills = excluded.skills,
    default_settlement_method = excluded.default_settlement_method,
    default_price = excluded.default_price,
    risk_level = excluded.risk_level,
    auto_trust = excluded.auto_trust,
    clean_report_count = excluded.clean_report_count,
    duration_baseline = excluded.duration_baseline,
    updated_at = now();

insert into public.projects (
  id,
  organization_id,
  code,
  name,
  status,
  supplier_id,
  created_by,
  owner_id,
  ops_manager_id,
  starts_at,
  ends_at,
  recruiting_deadline,
  open_signup,
  allow_direct_invite,
  force_recording,
  force_system_timing,
  default_settlement_method,
  default_hourly_rate,
  default_settlement_rule,
  published_at
) values (
  '99999999-9999-9999-9999-999999999999',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'PRJ-202606-001',
  'New Game Launch Week',
  'recruiting',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  now() + interval '3 days',
  now() + interval '10 days',
  current_date + 2,
  true,
  true,
  true,
  true,
  'cpt',
  80,
  '{"method":"cpt","hourly_rate":80,"min_minutes":60,"prorate_by_minute":true}',
  now()
)
on conflict (id) do update
set status = excluded.status,
    supplier_id = excluded.supplier_id,
    owner_id = excluded.owner_id,
    ops_manager_id = excluded.ops_manager_id,
    default_hourly_rate = excluded.default_hourly_rate,
    default_settlement_rule = excluded.default_settlement_rule,
    published_at = excluded.published_at,
    updated_at = now();

insert into public.project_assignments (organization_id, project_id, user_id) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '99999999-9999-9999-9999-999999999999',
    '33333333-3333-3333-3333-333333333333'
  )
on conflict (project_id, user_id) do nothing;

insert into public.auto_review_rules (
  organization_id,
  version,
  status,
  scope,
  auto_review_enabled,
  created_by
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  1,
  'shadow',
  '{"level":"organization"}',
  false,
  '11111111-1111-1111-1111-111111111111'
)
on conflict (organization_id, version) do update
set status = excluded.status,
    scope = excluded.scope,
    auto_review_enabled = excluded.auto_review_enabled,
    updated_at = now();

insert into public.notifications (
  organization_id,
  recipient_user_id,
  notification_type,
  title,
  content,
  object_type,
  object_id,
  source
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'system',
  'Demo data loaded',
  'The P0 foundation demo data includes organization, five roles, streamers, project, audit, and notifications.',
  'organization',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'seed'
);
