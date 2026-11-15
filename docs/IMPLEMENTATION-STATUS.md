# Implementation status

## Foundation (PR #3)

Canonical execution-card schema v1.0, validation, explicit plugin registration with multiple instances, configuration layering, normalized execution statuses, abort propagation, and optional diagnostics. Tests use fake adapters.

## Streaming execution (this PR)

- `stream()` produces `started`, text delta, structured tool call, progress and exactly one terminal event.
- `generate()` consumes the same execution/event path and returns the terminal result.
- A plugin may implement `stream()`; existing execute-only plugins are adapted to the same event contract.
- Provider stream completion is validated before publishing successful terminal status. Missing completion, post-completion events and exceptions fail the execution.
- Request cancellation is propagated to the provider, and abandoning an iterator aborts the plugin signal. Cancellation is best effort; a provider ignoring abort can still hold a pending operation.
- Structured tool calls are forwarded to the host but never executed by ArcanAI.
- No unbounded internal diagnostic event queue for streaming data: output is yielded to the consumer; a terminal `generate()` necessarily collects output.
- Added focused conformance tests for these conditions.

## Execution supervision (this PR)

- Per-request `heartbeatMs`, `idleMs`, and `totalMs` settings. Heartbeats are emitted while waiting for provider events, without issuing concurrent reads or pretending the model made progress.
- Idle deadline is reset only by provider events; supervisor heartbeats do not reset it. Total deadline is independent of progress.
- Caller cancellation can interrupt a silent provider wait at the ArcanAI boundary; deadlines abort the request signal and report `timeout`. Provider-side cancellation remains best effort.
- Provider iterator close is requested without blocking terminal failure reporting if a provider ignores cancellation.
- Default: heartbeat every 5 seconds; no automatic idle or total cutoff. No background compatibility checks.
- Focused tests cover quiet provider heartbeats, idle timeout, total timeout under progress, cancellation of silent requests and invalid timer configuration.

These timers supervise JavaScript async work. A frozen in-process event loop cannot send heartbeats or enforce deadlines; process isolation is not promised.

## Ollama provider integration (this PR)

- Introduces a separately built `plugins/ollama` workspace, with a plugin factory and no imports of host-specific BML/Aether code.
- Uses Ollama's documented `POST /api/chat` streaming NDJSON protocol, including tool calls, reasoning, usage, and terminal status.
- Maps common `temperature`, `topP`, and `maxTokens` to Ollama options. Passes provider-specific settings to Ollama after checking reserved/conflicting fields.
- Rejects messages that cannot be accurately translated instead of silently flattening them.
- Uses injected `fetch` to contract-test protocol behavior, fragmented UTF-8/JSON lines, HTTP failures, and no implicit retries without connecting to a real Ollama server.
- Workspaces remain private/unpublished until versioning, publishing and package contract guarantees are reviewed.

## Browser-neutral core and Node card catalog (this PR)

- Replaces Node-only UUID import with Web Crypto in core, allowing the same execution contract to be used in browsers and Node 22.
- Adds explicit single-directory model-card scanning through a separate `arcanai/node/cards` subpath. Browser consumers use `parseModelCard()` and their own asset loader.
- Scanning ignores symlinks and unrelated files, validates each card, rejects duplicate IDs, and performs no plugin registration or installation.
- Includes a declarative Ollama card example and tests for catalog behavior.

## Transformers.js parity adapter

- Adds an independent Transformers.js executor plugin with pipeline/direct-model runtime port, validated option translation, concurrency guard, cancellation, timing and token metrics.
- Deterministic mock coverage for all six model identities from the BML Mara experiment set.
- Provider/model initialization remains injected during the parity bridge. This is **not** proof of live six-model benchmark parity or a full independently loading Transformers.js plugin; see [parity plan](TRANSFORMERS-PARITY.md).

## Not implemented yet

Real provider adapters; timeout enforcement or heartbeat supervision; plugin lifecycle start/stop coordination; process supervision; concurrency limits; contract negotiation; provider option schemas/conflict validation; comprehensive sensitive-data redaction; host policy ceilings; file-based model card discovery; published packages; and BML migration.

The architecture and contracts documents include proposed future interfaces. They are **not implemented guarantees**. Never enable verbose plugin logs with sensitive data in production: the current version does not redact arbitrary plugin-supplied diagnostic payloads.
