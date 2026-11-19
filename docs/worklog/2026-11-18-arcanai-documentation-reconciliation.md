# 2026-11-18 — Reconcile ArcanAI vision, implemented interfaces and roadmap

## Goal

Align durable ArcanAI documentation with earlier design decisions, current TypeScript/provider code, and the confirmed destination: headless Node inference for the native Mac Aether workflow, optional browser inference for BML and web applications, and extensibility to local and hosted provider APIs without a second agent/orchestration engine.

## Sources reviewed

- Repository `AGENTS.md`, `README.md`, architecture, contracts, decisions, implementation status, card catalog, Transformers parity and consuming guidance.
- Current `src/types.ts`, `src/core.ts`, `src/cards.ts`, `src/supervision.ts`, `src/node/cards.ts`.
- Current Ollama and Transformers.js plugin implementations, including owned `loadTransformersJsInstance(card)`.
- Earlier accepted ArcanAI decisions: explicit plugin registration, host-supplied card paths, canonical execution cards, no install/upgrade behavior, BML scoring ownership, Aether tool/orchestration ownership.

## Completed

- Updated root README from “not yet implemented SDK” to an accurate description of implemented APIs, plugins and their limits.
- Made headless Node/local Mac the primary near-term inference target and browser/WebGPU an optional, separate acceptance requirement.
- Clarified environment vs transport vs provider vs model identity vs declared/measured capabilities vs host policy.
- Kept `generate/stream`, explicit registration, the versioned JSON execution card and current plugin workspaces authoritative.
- Corrected stale “not implemented” claims in `IMPLEMENTATION-STATUS.md`, including real provider adapters, timers, card discovery and Transformers-owned runtime.
- Distinguished today's actual TypeScript API from aspirational manifests, hard ceilings, provider API adapters and lifecycle protocols in `CONTRACTS.md`.
- Updated accepted decisions, the architectural dependency order and the Transformers parity/card-catalog/consumer documentation without rewriting historical worklogs.

## Decisions

- ArcanAI runs one model inference invocation; Aether executes agent tools and owns agent lifecycle; Pantheon plans/selects; BML measures.
- No mandatory browser, Docker, controller, network fetch or SaaS service for headless Node Aether runs.
- Browser-neutral core remains an invariant. Browser compatibility does not imply live WebGPU/model qualification.
- Future OpenAI-compatible local HTTP and direct hosted provider integrations are independently implemented plugins, never provider switches inside core.
- Model cards describe execution settings only. Hosts provide paths/registrations and credentials; ArcanAI never installs or activates dependencies.
- Unsupported features fail explicitly and declared model capabilities do not replace BML evidence.

## Verification and limitations

Documentation-only: no source/runtime/package changes. Source-level claims checked against currently reachable implementation; actual build/test CI status must be reviewed on the PR. No new live macOS Ollama or headless Transformers.js inference, browser WebGPU, BML parity, or hosted API verification is claimed.

## Next

Review the reconciled contracts before code changes. Then perform contract/portability hardening and real headless Node model acceptance, followed by additive HTTP provider plugins and shared BML/Aether conformance.
