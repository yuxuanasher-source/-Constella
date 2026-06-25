# Login Closed Loop Design

## Goal

Optimize the `/login` page to match the provided split-screen business login reference while keeping every visible entry tied to a real workflow or an explicit provider configuration state.

## Scope

- Rebuild the login layout with a blue business story panel and a focused right-side auth workspace.
- Keep email/password login wired to Supabase Auth.
- Route authenticated MCN staff to `/console/projects` and streamers to `/m/tasks`; a safe internal `next` path may override only when it matches the authenticated role.
- Support remembered login preference by storing the last email and selected role for seven days.
- Support password reset through `supabase.auth.resetPasswordForEmail`.
- Support phone OTP through Supabase SMS OTP request and verification.
- Support WeChat and Feishu entry points only when configured; otherwise they show a business-visible "unconfigured" state.
- Support MCN account opening requests by inserting into `public.mcn_onboarding_requests`.

## Non-Goals

- No hard-coded demo account, sample organization, or fake project data.
- No simulated third-party login success.
- No production deploy or external provider credential setup.

## Architecture

`app/(auth)/login/login-workflows.ts` owns pure routing, mode parsing, provider status, and onboarding validation. Server actions in `app/(auth)/login/actions.ts` call Supabase and reuse those helpers. The page in `app/(auth)/login/page.tsx` renders the visual experience and mode-specific forms.

The onboarding request table is added by `supabase/migrations/20260603152500_mcn_onboarding_requests.sql` with public insert-only RLS so unauthenticated applicants can submit without exposing the queue.

## Testing

`app/(auth)/login/login-workflows.test.ts` covers role routing, safe `next` handling, mode normalization, notice state, provider configuration, and MCN application validation.
