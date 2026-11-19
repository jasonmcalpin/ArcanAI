# 2026-11-18 — Provider exports and implementation truth

## Goal
Verify every shipped provider is accessible through public package exports, and reconcile documentation with implemented contracts rather than confusing tests with live runtime acceptance.

## Completed
- Added public import/registration conformance coverage for OpenAI-compatible HTTP, OpenAI Responses, and Anthropic Messages alongside existing Ollama/Transformers exports.
- Updated README, Architecture, Decisions, and Implementation Status to distinguish shipped adapters, current BML/Aether integration, missing authenticated/hardware acceptance, and the Gemini continuation contract gap.
- Preserved the headless Node/macOS priority, existing model cards, and independent plugin ownership.

## Verification
Full GitHub CI build/test pending. No real Mac GPU/model, local llama.cpp/LM Studio, or hosted API credentials exercised in this documentation/test change.

## Next
Review pinned ArcanAI revisions in Aether/BML and run target Mac/Ollama/Transformers acceptance before asserting deployed provider compatibility. Do not create Gemini tooling before the provider thought-signature/continuation contract has been reviewed.
