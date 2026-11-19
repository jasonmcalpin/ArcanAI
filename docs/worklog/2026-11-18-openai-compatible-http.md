# 2026-11-18 — OpenAI-compatible HTTP inference plugin

## Goal
Enable Aether and other hosts to use independently configured compatible local model endpoints without putting HTTP provider semantics into ArcanAI core.

## Completed work
- Added a standalone OpenAI-compatible Chat Completions SSE plugin with explicit endpoint/credentials.
- Maps portable generation settings, supports text and normalized usage, reassembles structured tool-call deltas, rejects unsupported content and options.
- Fails closed on HTTP/protocol/incomplete-stream errors and propagates cancellation.
- Added deterministic mocked transport tests; exported provider through ArcanAI's public package.
- Updated consumer docs.

## Verification
CI build and tests required; no real LM Studio/llama.cpp endpoint has been exercised.

## Dependencies
A host-configured reachable compatible endpoint and model. No daemon provisioning, new runtime library or credentials are automatically installed. Credentials optional for local endpoints.

## Next
Validate actual local service variants, then implement direct OpenAI and Anthropic API plugins against their own protocol contracts.
