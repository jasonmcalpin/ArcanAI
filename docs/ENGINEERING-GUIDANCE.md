# Engineering guidance

ArcanAI uses project-local Codex skills synchronized from [jasonmcalpin/codex-engineering-guidelines](https://github.com/jasonmcalpin/codex-engineering-guidelines).

Shared skill snapshots are stored in `.agents/skills/`:

- `requirements-review`
- `architecture-review`
- `regression-fix`
- `change-verification`
- `refactoring`

The repository's `AGENTS.md` contains ArcanAI-specific contracts and must **not** be overwritten by a shared-guidance update.

## Refresh the skills

Run from the repository root:

```sh
sh scripts/update-codex-skills.sh
git diff -- .agents/skills
```

The script retrieves the default branch of the shared guidelines repository and refreshes only these five recognized shared skill directories. It does not delete unrelated local skills, and it does not change `AGENTS.md`. Review the diff, then commit the update in a PR. Network and `git` are required.

The upstream project documents general installation and validation in [its installation guide](https://github.com/jasonmcalpin/codex-engineering-guidelines/blob/main/docs/INSTALLATION.md). When new shared skills are intentionally adopted, add them to the allowlist in the update script and this document.
