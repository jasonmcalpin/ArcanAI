# 2026-11-18 — Direct Anthropic Messages provider

## Goal
Offer hosted Claude model execution using the provider's native Messages streaming protocol while preserving ArcanAI host independence.

## Implemented
- Dedicated HTTPS, explicit host credentials, Anthropic API version and options.
- Preserves text and available thinking deltas; reassembles structured tool-use JSON blocks and records usage.
- Translates existing tool-result history, system messages and supported text messages; unsupported developer roles and modalities fail closed.
- Handles HTTP, SSE error, cancellation and incomplete-stream failures with no implicit retry or tool execution.
- Deterministic API fixture coverage.

## Dependencies
Operator-issued Anthropic API credential, model access and pricing. No automatic account setup or model provisioning.

## Verification
CI build/test required. Live authenticated model/endpoint acceptance unverified.

## Deferred
Richer image/audio, advanced hosted tools, redacted thinking pass-through and provider-specific history extensions.
