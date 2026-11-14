# ArcanAI engineering instructions

## Project authority
ArcanAI is a host-independent plugin/capability system. Keep its public contracts usable without dependencies on Aether, Pantheon, Taro, or BML; those integrations belong in separately owned adapters.

- Prefer replaceable, cohesive modules with narrowly defined contracts and independent lifecycle and failure ownership.
- Assess modularity by independence of decisions and replacement cost, not by the number of packages.
- Define plugin manifest versioning, compatibility, permission/trust boundaries, lifecycle behavior, and observable failures explicitly as they are implemented; never imply unimplemented security guarantees.
- Keep plugin metadata, catalogs, and variable specifications in validated data files rather than encoding independently editable inventories in runtime code.
- Treat refactoring and replacement as normal when concrete change pressure exposes a better boundary; retain externally observable contracts or provide explicit migrations.
- Do not create hypothetical extension layers without a supported use case.

## Shared engineering guidance
Follow the common standards maintained at https://github.com/jasonmcalpin/codex-engineering-guidelines, including its adaptability and modularity principles. The reusable project-local skills in `.agents/skills/` are synchronized snapshots from that source; see `docs/ENGINEERING-GUIDANCE.md` for update instructions. Repository-specific instructions here take precedence over shared generalities.

For substantive changes: identify the outcome and contracts, review existing architecture before extending it, state acceptance criteria, verify affected failure paths and callers, and report actual checks executed. Do not claim CI or runtime validation without evidence.
