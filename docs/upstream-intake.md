# Upstream intake policy — operator fork of stablyai/orca

Operational encoding of design §2
(`ez-omo-config/.omo/notes/orca-transition/40-oracle-design.md`). The fork does not
follow the high-frequency upstream head automatically; every upstream change enters
through this policy.

## Triage cadence and intake windows

- **Weekly triage minimum** of upstream security advisories and releases.
- **Critical security or active data-loss fixes**: assess immediately; either
  patch and test within **72 hours**, or **withdraw the fork from daily use**
  (revert daily use to zellij) until fixed.
- **High-severity stability fixes**: intake within **seven days**.
- **Routine releases**: batched into tagged integration candidates **roughly monthly**.
- These windows are **proposed maximum unsupported exposure, not automatic merges**.
- A broken gate holds the previous known-good release or reverts daily use to zellij.
  Do not claim an insecure build safe merely because no patch is available.

## Per-intake record

Each intake records:

- severity
- affected Electron / Orca / OpenCode-hook version
- exploit/reproduction relevance
- upstream base (SHA/tag)
- accept/defer rationale

## Gate matrix (all must pass before promoting a build)

1. Pinned Node/pnpm build (from the durable versioned toolchain, Task 5)
2. Hook isolation + OMO coexistence (plain OpenCode, Orca PTY, nested, restart)
3. X11 keymap (navigation chords reach intended owners; design §3 spike)
4. 14-session / restart soak (design §8 Stage B budgets)
5. Rollback artifact present and previously demonstrated

## Mechanics

- Rebase topic branches; integrate upstream release-to-release into `operator/main`.
- Keep the previous executable available as the known-good rollback.
- Push URL to `upstream` (stablyai/orca) is disabled at the remote level — never push there.
