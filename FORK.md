# FORK.md — Orca operator fork record

Fork of [stablyai/orca](https://github.com/stablyai/orca), maintained by the operator
([EZotoff/orca](https://github.com/EZotoff/orca)) per the orca-transition plan (Task 4)
and the design in `ez-omo-config/.omo/notes/orca-transition/40-oracle-design.md` §2.

## Recorded base

| Field | Value |
|---|---|
| Base SHA | `1b9d218df508e50b8ffac2a969edc7854c4907b8` |
| Base date | 2026-09-20 14:58:35 -0700 (commit date) |
| Base version | 1.4.197 (`package.json` at base; not a release tag checkout — base is the upstream `main` commit the clone was on) |
| Forked on | 2026-09-23 |
| Maintained branch | `operator/main` (base + fork commits) |

The base is recorded and reproducible: `git checkout 1b9d218df5` on any clone of
upstream reproduces the exact tree this fork started from. Do not follow upstream
head automatically; intakes go through `docs/upstream-intake.md`.

## Remotes

- `origin` → `https://github.com/EZotoff/orca` (operator fork; read/write)
- `upstream` → `https://github.com/stablyai/orca` (read-only; push URL deliberately disabled)

Never push to `stablyai/orca`.

## Ownership boundary (design §2, verbatim)

**Modify narrowly:** shared keybinding registry/action dispatch and Settings → Shortcuts; split/tab navigation; dashboard layout and AgentKanbanBoard mounting; first-party Supervisor relay data adapter/view; OpenCode hook-service default and corresponding relay-side installer; only the minimal runtime-RPC focus bridge if existing methods prove insufficient.

**Leave alone:** `src/relay/` PTY lifecycle and node-pty, agent CLI config/spawning beyond hook env, workspace/session persistence schema unless a tested UI need forces it, the OpenCode binary/OMO fork and existing plugins, mobile/cloud relay, provider credentials, and Orca's plugin SDK major version.

Prefer a first-party view rather than broadening experimental plugin APIs merely to host one local relay; revisit if independent third-party panels become a real requirement.

## Branching policy

- `operator/main` is the small maintained product branch; short topic branches are
  rebased onto it and merged when done.
- Tag each known-good local build; record upstream base, test evidence and rollback
  artifact with the tag.
- Integrate upstream release-to-release into `operator/main` (never auto-follow head);
  see `docs/upstream-intake.md` for triage cadence, intake windows and the gate matrix.

## Operator additions beyond the modify-narrowly list

First-party features added by the operator fork (design/plan refs in each doc):

- Overview panel + rail + widgets, Supervisor relay view, identity bridge,
  focus action — see `docs/` and `spikes/` in this repo (orca-transition plan
  Tasks 10–14).
- Telegram file sharing v1 (Task 20): explicit share action on the overview
  panel; credentials sealed in main via safeStorage. Setup and security:
  `docs/fileshare.md`.
