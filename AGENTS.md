# AGENTS.md

This repo is a skills container, not an app. No source code, build, test, lint, or deploy. Only `.agents/skills/` + `skills-lock.json`.

## Skills

- Installed from `mattpocock/skills` via `npx skills@latest add mattpocock/skills`. Manage with that CLI; never hand-edit `.agents/skills/` (managed output) or `skills-lock.json` (hashes).
- Load skills with the `skill` tool by name (e.g. `{"name": "ask-matt"}`). They are not shell commands: `/setup-matt-pocock-skills` typed in a terminal is not recognized.
- Router: `ask-matt` — consult it when unsure which skill/flow fits; it maps the idea-to-ship flow, on-ramps, and standalone skills.
- Precondition: `setup-matt-pocock-skills` runs once before the first engineering flow (issue tracker, triage labels, domain docs). It edits `AGENTS.md`/`CLAUDE.md` itself; never create the other file when one already exists.

## Agent skills

### Issue tracker

Issues tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
