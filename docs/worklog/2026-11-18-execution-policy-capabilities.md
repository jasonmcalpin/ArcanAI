# 2026-11-18 — Host execution ceilings and capability declarations

## Goal
Preserve the canonical model-card API while making request capability assumptions and aggregate output retention bounded.

## Changes
- Add optional provider-instance adapter capability declarations distinct from model qualification.
- Reject explicitly required unsupported/unknown features before invoking provider.
- Add host-owned token ceilings and per-invocation aggregate text, reasoning, tool and diagnostic limits.
- Reject card or request token overrides that exceed the registered host's hard limit.
- Add negative regression coverage; preserve existing provider adapters and card v1.0.

## Verification
GitHub CI build/test required. No macOS hardware acceptance performed.

## Dependencies
No new runtime services, environment variables or packages. Limits are optional host configuration with default capture budgets.

## Deferred
Model-level capability evidence, provider-specific limit negotiation and external event-consumer budgets belong to later integration work.
