---
name: report-precheck
version: 1.0.0
description: Precheck authorized live and recording reports for completeness without changing workflow state.
---

# Report Precheck

## Applies When

Use this workflow to compare submitted live-report or recording-review evidence with the authorized project context before a human review.

## Does Not Apply

Do not use it to submit, approve, reject, edit, or delete a report or recording review.

## Allowed Tools

- `xingyao_get_current_context`
- `xingyao_get_project_summary`
- `xingyao_search_live_reports`
- `xingyao_search_recording_reviews`

Use only tools present in the current tool schema. Every call is read-only.

## Required Evidence

- Project summary
- Explicit project or creator filter when available
- Bounded date range
- Returned report or review fields that establish completeness

## Missing Data

Label each unavailable field as missing, not failed. Do not infer the contents of attachments or reports that were not returned by an authorized tool.

## Prohibited Actions

- Do not change any review status or evidence.
- Do not produce an approval decision on behalf of a person.
- Do not call general filesystem, browser, terminal, code execution, or network tools.

## Output Structure

1. Precheck scope
2. Evidence present
3. Missing or inconsistent fields
4. Human review items

## Sensitive Fields

Minimize creator personal data and attachment identifiers. Never reveal hidden actor claims, tokens, private storage paths, or records outside the current organization grant.
