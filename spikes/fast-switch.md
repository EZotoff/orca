# G2b fast-switch gate — measured against the REAL identity bridge

**Date:** 2026-09-24 · **Branch:** `operator/g2-density` (merges `operator/identity-bridge` via `4dd9ca0afc`) · **Verdict: PASS**

Gate (plan §gates): the binding ≥20-jump ≤1 s measurement of a validated jump — identity
lookup via the bridge's resolve → `terminal.focus` with the exact verified handle → focus
verification — end-to-end, spread across multiple projects/panes. This is the re-verification
the G2a/G2b split required at Task 14 (the G2a numbers were provisional, measured against the
prototype store seam).

## Method — what ran for real

Each jump exercised the production `operator/identity-bridge` implementation, none of the G2
prototype (`window.__g2` was not involved):

- `SupervisorRelayFocusService.jump()` (real, `src/main/supervisor-relay/supervisor-relay-focus.ts`)
  — card lookup + resolve-then-focus entirely on the trusted side.
- `IdentityBridge.resolveOutcome()` (real, `src/main/identity-bridge/identity-bridge.ts`) —
  full reconcile against live inventory + hook correlations on every resolve, persisted through
  the real `IdentityBridgeStore` (durable JSON write per reconcile).
- `terminal.focus { navigation: 'host' }` over the **real E2EE runtime transport**
  (`sendRemoteRuntimeRequest`, the same socket family `callRuntimeEnvironment` uses) to a **real
  `orcad` runtime** (built from this tree, `out/orcad/orcad.js`, port 18255) hosting **real PTYs**.
- Focus verified per jump: `terminal.list {handles:[...]}` confirms the handle is live/connected
  AND its `tabId` equals the tabId the runtime reported focused AND equals the bridge record's tab.
  Timing = identity-lookup start → focus verified (the verification RPC is inside the measured
  window — conservative).

Fixture seams (injectable by design; Task 16 wires the live sources): `LiveInventorySource` fed
from the orcad runtime's real `terminal.list` payload; `HookCorrelationSource` carrying one
synthetic authenticated-hook report per fixture terminal, admitted into the bridge ONLY through
the real reconcile-verify path (all 8 verified, 0 rejected at seed time). The in-app
`registerSupervisorRelayIpc` still reconciles against empty sources until Task 16 — by design
every card renders unhosted there — so the gate ran the same main-process classes the IPC wiring
instantiates, driven from a harness (`spikes/g2b-measure.mjs`) instead of the renderer click.

Fixture: 8 terminals (each its own tab/leaf) across 3 projects — `~/src/orca-g2`,
`spikes/g2-fixture-repo`, throwaway `proj3` — cycled 3× = 24 jumps.

## Per-jump results

| # | from | to | outcome | total ms | focus ms | verify ms | verified |
|---|------|----|---------|---------:|---------:|----------:|----------|
| 1 | start | card-0 | focused | 43.30 | 35.21 | 8.04 | yes |
| 2 | card-0 | card-1 | focused | 38.76 | 30.60 | 8.15 | yes |
| 3 | card-1 | card-2 | focused | 69.92 | 33.48 | 36.42 | yes |
| 4 | card-2 | card-3 | focused | 38.26 | 31.37 | 6.88 | yes |
| 5 | card-3 | card-4 | focused | 34.87 | 29.43 | 5.43 | yes |
| 6 | card-4 | card-5 | focused | 38.31 | 31.97 | 6.33 | yes |
| 7 | card-5 | card-6 | focused | 33.37 | 28.23 | 5.13 | yes |
| 8 | card-6 | card-7 | focused | 30.70 | 24.05 | 6.64 | yes |
| 9 | card-7 | card-0 | focused | 26.50 | 20.76 | 5.73 | yes |
| 10 | card-0 | card-1 | focused | 37.50 | 32.48 | 5.02 | yes |
| 11 | card-1 | card-2 | focused | 41.26 | 35.13 | 6.12 | yes |
| 12 | card-2 | card-3 | focused | 45.07 | 40.84 | 4.23 | yes |
| 13 | card-3 | card-4 | focused | 42.51 | 28.98 | 13.53 | yes |
| 14 | card-4 | card-5 | focused | 30.18 | 24.76 | 5.41 | yes |
| 15 | card-5 | card-6 | focused | 30.63 | 25.35 | 5.27 | yes |
| 16 | card-6 | card-7 | focused | 29.63 | 24.19 | 5.42 | yes |
| 17 | card-7 | card-0 | focused | 28.98 | 23.53 | 5.44 | yes |
| 18 | card-0 | card-1 | focused | 28.32 | 23.71 | 4.60 | yes |
| 19 | card-1 | card-2 | focused | 23.98 | 20.50 | 3.47 | yes |
| 20 | card-2 | card-3 | focused | 25.35 | 22.21 | 3.13 | yes |
| 21 | card-3 | card-4 | focused | 27.86 | 24.43 | 3.42 | yes |
| 22 | card-4 | card-5 | focused | 30.82 | 25.30 | 5.52 | yes |
| 23 | card-5 | card-6 | focused | 31.69 | 26.31 | 5.37 | yes |
| 24 | card-6 | card-7 | focused | 31.71 | 25.98 | 5.73 | yes |

Raw rows: `spikes/g2b-jump-rows.jsonl`.

## Stats vs gate

| metric | value | gate | margin |
|--------|------:|------|--------|
| n (verified jumps) | 24 | ≥20 | +4 |
| p50 | 31.71 ms | ≤1 s | ~32× under |
| p95 | 45.07 ms | ≤1 s | ~22× under |
| max | 69.92 ms | ≤1 s | ~14× under |
| jumps >1 s | 0 | 0 | — |

**PASS.** The bridge's per-resolve reconcile (live inventory RPC + durable store write) plus the
E2EE `terminal.focus` round-trip plus verification totals ~32 ms median — the resolve→focus
pipeline is nowhere near the 1 s budget, so cutover (Task 26) is not latency-blocked by the bridge.

## Relation to the earlier prototype-seam numbers

The G2a artifact (`spikes/g2-density.md`, `spikes/g2-jump-rows.jsonl`) recorded 24 jumps at
p50=15 / p95=19 / max=20 ms — but those ran through the prototype store seam
(`window.__g2.jump` inside the throwaway Electron build), which performed an in-renderer tab
activation with no identity verification, no reconcile, no IPC, and no runtime RPC. Per the plan's
G2a/G2b split those numbers were PROVISIONAL. This run replaces them as the binding G2b evidence:
same fixture methodology (multi-project spread, ≥20 jumps, same measure-and-jsonl pattern), but
every jump is bridge-verified over the real E2EE runtime transport. The ~17 ms p50 delta is the
real cost of trust: per-resolve reconcile (live `terminal.list` + durable bridge-store write) and
the focus verification round-trip. The bridge is now the `operator/identity-bridge`
implementation (persisted records, reconcile rejection classes, `resolveOutcome`, unhosted
handling) — not a stub mapping.

## Caveats

- Inventory/hook-correlation seams carry fixture data (real orcad terminals; synthetic hook
  reports). Task 16's live sources replace them; reconcile cost may grow with real correlation
  volume, but the gate's 14–32× headroom absorbs it.
- Jumps were driven from a main-process-side harness through the same classes the IPC handler
  instantiates, not via a renderer click; the renderer→IPC hop adds no main-side work (scalar
  card id in, scalar outcome out).
- `navigation: 'host'` on a headless orcad returns `navigated:false` (no desktop surface to
  raise); on the real desktop host the same RPC raises Orca's host surface. The resolve→focus→
  verify latency measured here is the portion the gate budgets.
