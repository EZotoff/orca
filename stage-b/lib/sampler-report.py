#!/usr/bin/env python3
"""Stage B soak RSS/CPU report (orca-transition Task 25, design §8).

Reads the Task-23 watchdog sampler output (samples.jsonl) for the soak window
and produces per-PID + aggregate RSS/CPU statistics plus a pre-registered
budget evaluation. Budgets come from stage-b/soak-config.json and are NEVER
tuned here — this script only evaluates against them.

Usage:
  sampler-report.py --samples <samples.jsonl> --config <soak-config.json>
                    --start <iso> [--end <iso>] --outdir <dir>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def parse_ts(s: str) -> float:
    # sampler writes local-time ISO with milliseconds, e.g. 2026-09-24T07:20:00.123
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").timestamp()


def load_samples(path: str) -> list[dict]:
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def window(rows, start, end):
    out = []
    for r in rows:
        try:
            t = parse_ts(r["ts"])
        except (KeyError, ValueError):
            continue
        if t < start:
            continue
        if end is not None and t > end:
            continue
        out.append((t, r))
    return out


def per_pid_stats(rows):
    stats: dict[str, dict] = {}
    for _, r in rows:
        if not r.get("valid"):
            continue
        for pid, info in (r.get("per_pid") or {}).items():
            s = stats.setdefault(pid, {
                "class": info.get("class"),
                "starttime": info.get("starttime"),
                "max_rss_bytes": 0,
                "samples": 0,
            })
            s["max_rss_bytes"] = max(s["max_rss_bytes"], info.get("rss_bytes", 0))
            s["samples"] += 1
    return stats


def window_averages(rows, window_sec):
    """Average cpu_cores_est over consecutive windows of window_sec."""
    out = []
    cur = []
    cur_start = None
    for t, r in rows:
        if not r.get("valid") or r.get("cpu_cores_est") is None:
            continue
        if cur_start is None:
            cur_start = t
        if t - cur_start >= window_sec:
            if cur:
                out.append({"start": cur_start, "avg_cores": sum(cur) / len(cur), "n": len(cur)})
            cur = []
            cur_start = t
        cur.append(r["cpu_cores_est"])
    if cur:
        out.append({"start": cur_start, "avg_cores": sum(cur) / len(cur), "n": len(cur)})
    return out


def sustained_streak(rows, cores, window_sec):
    """Longest run (seconds) where the rolling window average exceeds cores."""
    best = 0.0
    cur = 0.0
    for t, r in rows:
        if not r.get("valid") or r.get("cpu_cores_est") is None:
            continue
        if r["cpu_cores_est"] > cores:
            cur += 10.0
            best = max(best, cur)
        else:
            cur = 0.0
    return best


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", default=None)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--baseline-bytes", type=int, default=None,
                    help="start-of-full-load baseline RSS; overrides the first sample")
    args = ap.parse_args()

    cfg = json.load(open(args.config, encoding="utf-8"))
    b = cfg["budgets"]
    start = parse_ts(args.start)
    end = parse_ts(args.end) if args.end else None

    rows = window(load_samples(args.samples), start, end)
    valid = [(t, r) for t, r in rows if r.get("valid")]
    invalid = len(rows) - len(valid)

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "window": {"start": args.start, "end": args.end, "samples": len(rows), "valid": len(valid), "invalid": invalid},
        "budgets": b,
        "perPid": per_pid_stats(rows),
    }

    if valid:
        baseline = args.baseline_bytes if args.baseline_bytes is not None else valid[0][1]["rss_total_bytes"]
        baseline_source = "operator-recorded" if args.baseline_bytes is not None else "first-sample"
        rss_series = [(t, r["rss_total_bytes"]) for t, r in valid]
        max_rss = max(v for _, v in rss_series)
        final_rss = rss_series[-1][1]
        result["rss"] = {
            "baseline_bytes": baseline,
            "baseline_source": baseline_source,
            "max_bytes": max_rss,
            "final_bytes": final_rss,
            "max_over_baseline_bytes": max_rss - baseline,
            "final_over_baseline_bytes": final_rss - baseline,
        }
        # final four active hours growth (only meaningful once >=4h of samples exist)
        t_end = rss_series[-1][0]
        t_four = t_end - 4 * 3600
        final4 = [(t, v) for t, v in rss_series if t >= t_four]
        span_h = (rss_series[-1][0] - rss_series[0][0]) / 3600.0
        if span_h >= 4.0 and len(final4) >= 2:
            hours = max((final4[-1][0] - final4[0][0]) / 3600.0, 1e-9)
            growth = final4[-1][1] - final4[0][1]
            result["final4h"] = {
                "hours": hours,
                "growth_bytes": growth,
                "growth_bytes_per_hour": growth / hours,
            }
        else:
            result["final4h"] = {"insufficient_window": True, "span_hours": span_h}
        # final four active hours growth
        t_end = rss_series[-1][0]
        t_four = t_end - 4 * 3600
        final4 = [(t, v) for t, v in rss_series if t >= t_four]
        if len(final4) >= 2:
            hours = max((final4[-1][0] - final4[0][0]) / 3600.0, 1e-9)
            growth = final4[-1][1] - final4[0][1]
            result["final4h"] = {
                "hours": hours,
                "growth_bytes": growth,
                "growth_bytes_per_hour": growth / hours,
            }
        # CPU windows
        result["cpu"] = {
            "windows_15min": window_averages(valid, 900),
            "sustained_over_1core_sec": sustained_streak(valid, b["cpu_sustained_cores"], 300),
        }

    # budget evaluation
    evals = []
    if "rss" in result:
        over = result["rss"]["max_over_baseline_bytes"]
        evals.append({
            "budget": "rss_over_baseline",
            "limit_bytes": b["rss_over_baseline_bytes"],
            "observed_bytes": over,
            "pass": over <= b["rss_over_baseline_bytes"],
        })
    if "final4h" in result and not result["final4h"].get("insufficient_window"):
        g = result["final4h"]["growth_bytes_per_hour"]
        evals.append({
            "budget": "final4h_growth",
            "limit_bytes_per_hour": b["final4h_growth_bytes_per_hour"],
            "observed_bytes_per_hour": g,
            "pass": g <= b["final4h_growth_bytes_per_hour"],
        })
    if "cpu" in result:
        worst = max((w["avg_cores"] for w in result["cpu"]["windows_15min"]), default=0.0)
        evals.append({
            "budget": "idle_cpu_15min_avg",
            "limit_cores": b["idle_cpu_cores_15min_avg"],
            "observed_worst_cores": worst,
            "pass": worst <= b["idle_cpu_cores_15min_avg"],
        })
        sus = result["cpu"]["sustained_over_1core_sec"]
        evals.append({
            "budget": "cpu_sustained",
            "limit_sec": b["cpu_sustained_window_sec"],
            "observed_sec": sus,
            "pass": sus <= b["cpu_sustained_window_sec"],
        })
    result["evaluation"] = evals
    result["allPass"] = all(e["pass"] for e in evals) if evals else None

    os.makedirs(args.outdir, exist_ok=True)
    with open(os.path.join(args.outdir, "rss-cpu.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
        fh.write("\n")

    # markdown summary
    lines = ["# Stage B soak — RSS/CPU report", ""]
    lines.append(f"Window: {args.start} → {args.end or 'now'}  ")
    lines.append(f"Samples: {len(rows)} ({len(valid)} valid, {invalid} invalid)")
    lines.append("")
    if "rss" in result:
        r = result["rss"]
        lines.append("## Aggregate RSS")
        lines.append("")
        lines.append("| metric | bytes | MiB |")
        lines.append("|---|---|---|")
        lines.append(f"| baseline (start-of-full-load) | {r['baseline_bytes']} | {r['baseline_bytes']/1048576:.1f} |")
        lines.append(f"| max | {r['max_bytes']} | {r['max_bytes']/1048576:.1f} |")
        lines.append(f"| final | {r['final_bytes']} | {r['final_bytes']/1048576:.1f} |")
        lines.append(f"| max over baseline | {r['max_over_baseline_bytes']} | {r['max_over_baseline_bytes']/1048576:.1f} |")
        lines.append("")
    if "final4h" in result and not result["final4h"].get("insufficient_window"):
        f = result["final4h"]
        lines.append(f"Final-4h growth: {f['growth_bytes_per_hour']/1048576:.1f} MiB/h over {f['hours']:.2f} h")
        lines.append("")
    elif "final4h" in result:
        lines.append(f"Final-4h growth: insufficient window ({result['final4h'].get('span_hours', 0):.2f} h < 4 h)")
        lines.append("")
    if "cpu" in result:
        lines.append("## CPU")
        lines.append("")
        lines.append(f"15-min windows: {len(result['cpu']['windows_15min'])}; "
                     f"worst avg {max((w['avg_cores'] for w in result['cpu']['windows_15min']), default=0):.3f} cores")
        lines.append(f"Longest sustained >1 core: {result['cpu']['sustained_over_1core_sec']:.0f} s")
        lines.append("")
    lines.append("## Budget evaluation")
    lines.append("")
    lines.append("| budget | limit | observed | pass |")
    lines.append("|---|---|---|---|")
    for e in evals:
        lim = e.get("limit_bytes") or e.get("limit_bytes_per_hour") or e.get("limit_cores") or e.get("limit_sec")
        obs = e.get("observed_bytes") or e.get("observed_bytes_per_hour") or e.get("observed_worst_cores") or e.get("observed_sec")
        lines.append(f"| {e['budget']} | {lim} | {obs} | {'PASS' if e['pass'] else 'BREACH'} |")
    lines.append("")
    lines.append(f"**allPass: {result['allPass']}**")
    lines.append("")
    with open(os.path.join(args.outdir, "rss-cpu.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(json.dumps({"allPass": result["allPass"], "evaluation": evals, "samples": len(rows)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
