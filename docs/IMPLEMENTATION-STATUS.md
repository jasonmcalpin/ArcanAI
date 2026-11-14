# Implementation status

## First foundation slice

Implements canonical schema v1.0 **execution section**, validation, explicit plugin instance registry, single-request generation dispatch, config merging, result statuses, abort propagation, and opt-in diagnostic events. Conformance-style tests use a fake adapter; no real provider adapter has been implemented.

## Not implemented yet

Native provider adapters, streaming event contract, plugin lifecycle start/stop, timeouts and heartbeat supervision, concurrency control/backpressure, contract-version negotiation and semver checking, provider option schemas/conflict handling, security redaction for arbitrary plugin logs, host policy ceilings, model-card file scanning, published package bundles, and integration with existing BML cards.

This is an initial code slice, not a claim that the complete designs in ARCHITECTURE.md and CONTRACTS.md are implemented. Never expose unredacted plugin-provided diagnostic data in production environments; the first slice has no automatic sensitive-data redactor.
