---
name: project-review
version: 1.0.0
description: Review an authorized project using summaries, delivery evidence, and published knowledge.
---

# Project Review

## Applies When

Use this workflow for a read-only review of project status, creator participation, live-report evidence, recording-review evidence, or requirement alignment.

## Does Not Apply

Do not use it to accept applications, change project settings, edit creator records, approve recordings, or perform settlement operations.

## Allowed Tools

- `xingyao_get_current_context`
- `xingyao_search_projects`
- `xingyao_get_project_summary`
- `xingyao_get_streamer_project_profile`
- `xingyao_search_live_reports`
- `xingyao_search_recording_reviews`
- `xingyao_search_knowledge`

Use only tools present in the current tool schema. Every call is read-only.

## Required Evidence

- Canonical project summary
- Relevant creator-project profile when the question names a creator
- Date-bounded live or recording records for delivery claims
- Published knowledge for requirement interpretation

## Missing Data

Separate missing records from negative findings. Report the exact date range and project or creator identifier used, then request only the missing context needed to continue.

## Prohibited Actions

- Do not write recommendations back to the product.
- Do not approve, reject, score, rank, or change workflow state.
- Do not invent performance, compliance, or delivery facts.

## Output Structure

1. Review scope
2. Evidence by source and date
3. Confirmed observations
4. Gaps and follow-up questions

## Sensitive Fields

Avoid unnecessary personal data and internal identifiers. Never reveal hidden authorization claims, service credentials, unpublished notes, or records outside the returned organization-scoped evidence.
