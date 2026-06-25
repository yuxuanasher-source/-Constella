# Miracle Legend Local Test Data Design

## Goal

Provide an explicit local-only dataset for Miracle-like and Legend-like game products, streamer profiles, lifecycle records, and instrumentation checks. The dataset must be easy to load for acceptance testing and easy to delete with one command.

## Scope

- Add a local script entry for loading the fixture dataset.
- Add a local script entry for clearing the same dataset.
- Keep `supabase/seed.sql` empty and unchanged.
- Create product/project records for two game categories: Miracle-like and Legend-like.
- Create streamer records with platform accounts, recording links, applications, joined project rows, live tasks, live reports, settlement-ready samples, notifications, audit logs, and usage events.
- Verify instrumentation by querying `usage_events` and `audit_logs` after load.
- Verify cleanup by asserting the dataset marker no longer exists after clear.

## Non-Goals

- No product UI button for creating or deleting the dataset.
- No default seed data in source-controlled Supabase seed files.
- No production account, payment, or third-party provider setup.
- No changes to RLS policy behavior just to make fixture loading easier.

## Dataset Boundary

The dataset is isolated under one local organization with a stable code such as `local_miracle_legend_v1`. Most business records already cascade from `organizations`, so cleanup can delete the organization after dependent records that do not cascade are handled explicitly.

Records that cannot be safely identified by organization cascade, such as created auth users, are identified by a script-owned email suffix such as `@ml-test.invalid`. The clear command deletes only users and profiles that match that suffix and the dataset organization membership.

The script refuses to run unless one of these local-safety checks passes:

- `NEXT_PUBLIC_SUPABASE_URL` points to localhost or `127.0.0.1`.
- `ALLOW_LOCAL_TESTDATA=1` is set explicitly.

## Commands

Add package scripts:

```bash
pnpm testdata:load
pnpm testdata:verify
pnpm testdata:clear
```

`testdata:load` is idempotent: it clears any existing dataset with the same marker, then inserts a fresh copy.

`testdata:verify` checks that:

- the dataset organization exists;
- Miracle-like and Legend-like projects exist;
- streamers are present and linked to projects;
- live tasks and reports exist;
- usage events exist for `active_streamer`, `ai`, `storage_mb`, and `export`;
- audit logs exist for project, streamer, live operation, settlement, and instrumentation actions.

`testdata:clear` removes the dataset and then verifies zero remaining rows for the dataset organization, dataset project codes, and dataset auth user suffix.

## Data Shape

The loader creates:

- one organization and subscription row;
- staff users for owner, operations, business operator, and finance;
- two streamer users and at least one unbound streamer profile;
- one supplier;
- two projects: one Miracle-like recruiting or active project and one Legend-like active or settling project;
- streamer account rows for short-video and live platforms;
- project applications and recording submissions;
- joined project streamer rows with settlement rule snapshots;
- live tasks in pending, reported, approved, and completed states;
- live reports with green and yellow evidence examples;
- settlement batch and item records for payable and receivable flows where schema constraints allow;
- notifications for streamer and staff workflows;
- audit logs for high-risk and normal actions;
- usage events that exercise instrumentation counters.

## Instrumentation

The loader writes usage events through the existing metering contract where practical. At minimum, the inserted rows must be shaped exactly like production `usage_events` records:

- `active_streamer` for active streamer count;
- `ai` for diagnosis or project review usage;
- `storage_mb` for recording and screenshot evidence;
- `export` for acceptance export coverage.

Each instrumentation group also has an audit log so the acceptance smoke can prove both metering and audit observability work for the dataset.

## Cleanup

Cleanup uses the dataset organization as the primary boundary. It deletes or cascades records in an order that respects foreign keys:

1. delete settlement items and batches that reference dataset projects;
2. clear live report settlement references if needed;
3. delete live reports, screenshots, OCR rows, tasks, applications, project streamer rows, streamer account rows, streamer recording links, notifications, usage rows, and audit rows under the organization;
4. delete projects, streamers, suppliers, organization members, subscriptions, and the organization;
5. delete script-created profiles and auth users by the owned email suffix.

The clear command never deletes rows that do not match the dataset organization, dataset project codes, or owned email suffix.

## Testing

Use TDD for implementation:

- first add tests for dataset marker generation and local-safety guards;
- add tests for load, verify, and clear command planning;
- add integration-smoke coverage when Supabase local credentials are present;
- add a regression guard that `supabase/seed.sql` remains intentionally empty.

Manual acceptance after implementation:

```bash
pnpm testdata:load
pnpm testdata:verify
pnpm testdata:clear
pnpm testdata:verify
```

The final verify after clear should fail with a clear "dataset not loaded" result or support an explicit `--expect-empty` mode.

## Acceptance

- A local developer can load Miracle-like and Legend-like product data with one command.
- A local developer can clear all injected records with one command.
- Instrumentation checks can prove usage events and audit logs were created.
- The default Supabase seed remains empty.
- The production demo-data guard does not need weakening.
- Cleanup is scoped and cannot remove unrelated local data accidentally.
