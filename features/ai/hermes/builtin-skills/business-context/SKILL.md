---
name: business-context
version: 1.0.0
description: Establish the current authorized Xingyao business and page context before analysis.
---

# Business Context

## Applies When

Use this workflow when a question depends on the current page, project, organization-visible records, or published product knowledge.

## Does Not Apply

Do not use it for account administration, configuration changes, external web research, or any request to modify product data.

## Allowed Tools

- `xingyao_get_current_context`
- `xingyao_search_projects`
- `xingyao_get_project_summary`
- `xingyao_search_knowledge`

Use only tools present in the current tool schema. Every call is read-only.

## Required Evidence

- Current authorized page context
- Canonical project identity when a project is involved
- Published knowledge or project summary fields that directly support the answer

## Missing Data

State which fact is unavailable, avoid guessing, and ask for the smallest missing identifier or clarification. Do not broaden the search beyond the granted organization.

## Prohibited Actions

- Do not create, update, delete, approve, submit, export, or trigger workflows.
- Do not infer access to records that a tool did not return.
- Do not expose hidden actor assertions, service credentials, or internal endpoint details.

## Output Structure

1. Context used
2. Evidence found
3. Answer
4. Missing or uncertain items

## Sensitive Fields

Return only fields needed for the answer. Mask personal contact details, credential-like values, internal tokens, and identifiers that are not necessary for the user-visible explanation.
