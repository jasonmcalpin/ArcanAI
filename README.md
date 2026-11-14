# ArcanAI

Host-independent model execution through explicitly registered, replaceable provider plugins.

**Status:** architecture defined; the interfaces below are design targets, not yet an implemented SDK.

ArcanAI owns the canonical, versioned **model execution card format** and the plugin contracts that consume it. Hosts such as Browser Model Lab (BML), Aether, and other applications use those same cards and plugins. ArcanAI routes structured model requests, passes through validated provider-specific options, normalizes outputs/status, and provides opt-in structured diagnostic logging.

**Not ArcanAI responsibilities:** installing or upgrading plugins/models/services, package management, automatic compatibility polling, retries, durable jobs, agent orchestration, host tool execution, or benchmark scoring. The project owner handles dependency maintenance; the host handles jobs and recovery. An unavailable plugin is reported as a missing requirement without an installation attempt.

## Architecture documentation

- [Architecture](docs/ARCHITECTURE.md) — purpose, vocabulary, ownership boundaries, invariants, lifecycle, and acceptance criteria
- [Contracts](docs/CONTRACTS.md) — proposed model cards, registration, execution/events, common/provider settings, status, cancellation, deadlines, diagnostics, and conformance tests
- [Decision record](docs/DECISIONS.md) — accepted choices, rejected scope, and implementation details still requiring review

## Core design in one view

```text
Host (BML / Aether / application)
  -> ArcanAI SDK (card validation, registered instance, request/events)
    -> Plugin adapter (prompt/config translation, provider call, response normalization)
      -> Provider / model runtime
```

Plugin registration is **explicit**; one plugin can have multiple configured instances. Model cards declaratively describe execution settings, and the same card/plugin combination means the same thing in every host. Verbose mode narrates requests, responses, and errors via sanitized structured events; production defaults to minimal diagnostics.

The shared coding-agent guidance is maintained separately in [codex-engineering-guidelines](https://github.com/jasonmcalpin/codex-engineering-guidelines) and can be synchronized into this repository.
