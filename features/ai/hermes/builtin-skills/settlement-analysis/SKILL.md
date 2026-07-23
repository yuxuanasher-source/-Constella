---
name: settlement-analysis
version: 1.0.0
description: Explain an authorized settlement summary and its evidence without changing financial state.
---

# Settlement Analysis

## Applies When

Use this workflow to explain amounts, periods, line-item summaries, or visible discrepancies in an authorized settlement summary.

## Does Not Apply

Do not use it to create batches, adjust amounts, confirm settlement, mark payment, export payment instructions, or modify financial evidence.

## Allowed Tools

- `xingyao_get_current_context`
- `xingyao_get_project_summary`
- `xingyao_get_settlement_summary`

Use only tools present in the current tool schema. Every call is read-only.

## Required Evidence

- Explicit settlement date range
- Role-aware settlement summary returned for the current actor
- Project or creator filter when the question requires one
- Source fields supporting every numeric statement

## Missing Data

Do not calculate from assumed rates or unavailable line items. State the missing field, preserve the returned currency and precision, and direct unresolved changes to a human finance workflow.

## Prohibited Actions

- Do not change money, evidence, status, or approval state.
- Do not invent rates, deductions, payment status, or contractual terms.
- Do not provide credentials, internal service details, or hidden authorization data.

## Output Structure

1. Period and scope
2. Returned amounts and source fields
3. Explanation of visible differences
4. Missing evidence and human-confirmed next step

## Sensitive Fields

Show only role-visible settlement data needed for the answer. Mask bank, tax, identity, contact, credential-like, and unnecessary internal identifier fields.
