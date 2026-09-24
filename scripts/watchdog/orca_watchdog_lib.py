#!/usr/bin/env python3
"""Orca workspace watchdog shared library (design 40-oracle-design.md §3b,
orca-transition.md Task 23 + Clause 3b amendment).

All filesystem surfaces are injectable via env for unit tests:
  ORCA_WATCHDOG_STATE_DIR     default ~/.local/state/orca-workspace-watchdog
  ORCA_WATCHDOG_SELECTOR_FILE default <state>/launcher-selector
  ORCA_WATCHDOG_PROC_ROOT     default /proc
  ORCA_WATCHDOG_NOTIFY_SOCKET default $NOTIFY_SOCKET
"""
from __future__ import annotations

import json
import os
import socket
import time

DEFAULT_STATE = os.path.expanduser("~/.local/state/orca-workspace-watchdog")

# Design §3b thresholds (Stage-B budgets).
RSS_BREACH_BYTES = 1 << 30          # +1 GiB over start-of-full-load baseline
RSS_BREACH_STREAK = 3               # sustained over 3 samples (30 s)
CPU_SUSTAINED_SAMPLES = 30          # 5 min at 10 s cadence
CPU_SUSTAINED_CORES = 1.0           # >1 core sustained
CLK_TCK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100

AGENT_PTY_EXCLUDED_CLASSES = ("agent-pty",)
ORCA_OWNED_CLASSES = (
    "electron-main", "electron-renderer", "electron-gpu", "electron-utility",
    "electron-zygote", "electron-other", "orcad", "relay", "orca-helper",
)


class Env:
    def __init__(self, **overrides):
        self.state = overrides.get("state") or os.environ.get(
            "ORCA_WATCHDOG_STATE_DIR", DEFAULT_STATE)
        self.selector = overrides.get("selector") or os.environ.get(
            "ORCA_WATCHDOG_SELECTOR_FILE", os.path.join(self.state, "launcher-selector"))
        self.proc_root = overrides.get("proc_root") or os.environ.get(
            "ORCA_WATCHDOG_PROC_ROOT", "/proc")
        self.notify_socket = overrides.get("notify_socket") or os.environ.get(
            "ORCA_WATCHDOG_NOTIFY_SOCKET") or os.environ.get("NOTIFY_SOCKET")

    # -- state writes ----------------------------------------------------
    def ensure_dirs(self):
        os.makedirs(self.state, exist_ok=True)

    def write_atomic(self, relpath: str, data: str):
        path = os.path.join(self.state, relpath)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.rename(tmp, path)

    def append_line(self, relpath: str, record: dict):
        path = os.path.join(self.state, relpath)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, separators=(",", ":")) + "\n")

    # -- selector --------------------------------------------------------
    def read_selector(self) -> str:
        try:
            with open(self.selector, "r", encoding="utf-8") as fh:
                return fh.read().strip()
        except OSError:
            return ""

    def flip_selector(self, reason: str, actor: str) -> bool:
        """Atomically set launcher selector to zellij. Idempotent. Returns True
        if this call performed the flip."""
        if self.read_selector() == "zellij":
            return False
        self.ensure_dirs()
        tmp = self.selector + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write("zellij\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.rename(tmp, self.selector)
        self.append_line("breaches.jsonl", {
            "ts": iso_now(), "actor": actor, "action": "selector-flip",
            "from": "orca", "to": "zellij", "reason": reason,
        })
        self.append_line("alerts.log", (
            f"{iso_now()} {actor}: selector flipped orca->zellij ({reason}). "
            "Hosted PTYs die with Electron on hard crash; recover sessions via "
            "oa/opencode attach (scrollback above Stage-B sentinels is lost)."))
        return True

    # -- sd_notify ---------------------------------------------------------
    def sd_notify(self, message: str) -> bool:
        sock = self.notify_socket
        if not sock:
            return False
        if sock.startswith("@"):
            sock = "\0" + sock[1:]
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            s.sendto(message.encode(), sock)
            s.close()
            return True
        except OSError:
            return False

    def touch_heartbeat(self):
        self.ensure_dirs()
        path = os.path.join(self.state, "heartbeat")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(iso_now() + "\n")
        os.utime(path, None)

    def heartbeat_age(self) -> float | None:
        path = os.path.join(self.state, "heartbeat")
        try:
            return max(0.0, time.time() - os.stat(path).st_mtime)
        except OSError:
            return None


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()) + (
        "%.3f" % (time.time() % 1))[1:]


# -- /proc sampling -------------------------------------------------------

def read_pid_meta(pid: str, proc_root: str) -> dict | None:
    pdir = os.path.join(proc_root, str(pid))
    try:
        with open(os.path.join(pdir, "stat"), "r", encoding="utf-8") as fh:
            stat = fh.read()
        with open(os.path.join(pdir, "cmdline"), "rb") as fh:
            raw = fh.read()
        try:
            with open(os.path.join(pdir, "statm"), "r", encoding="utf-8") as fh:
                statm = fh.read().split()
            rss_pages = int(statm[1])
        except (OSError, IndexError, ValueError):
            rss_pages = 0
    except OSError:
        return None
    # comm may contain spaces/parens; fields restart after the last ')'
    tail = stat[stat.rindex(")") + 2:].split()
    # field N (1-based, N>=3) == tail[N-3]
    return {
        "pid": int(pid),
        "ppid": int(tail[1]),                 # field 4
        "starttime": tail[19],                # field 22 (string keeps precision)
        "utime": int(tail[11]),               # field 14
        "stime": int(tail[12]),               # field 15
        "rss_pages": rss_pages,
        "rss_bytes": rss_pages * os.sysconf("SC_PAGE_SIZE")
        if hasattr(os, "sysconf") else rss_pages * 4096,
        "cmdline": [a for a in raw.decode("utf-8", "replace").split("\0") if a],
    }


def read_cgroup_pids(cgroup_procs: str) -> list[str]:
    try:
        with open(cgroup_procs, "r", encoding="utf-8") as fh:
            return [ln.strip() for ln in fh if ln.strip()]
    except OSError:
        return []


def discover_scope_pids(slice_dir, orca_prefix, proc_root):
    """Discover Orca-owned escape scopes (app-orca-<pid>.scope): the app
    itself migrates the electron main + daemon into a sibling scope of the
    operator unit at launch. A scope member is ours only when its argv0
    matches the operator RC prefix (binary identity, design 3b)."""
    found = {}
    if not (slice_dir and orca_prefix) or not os.path.isdir(slice_dir):
        return found
    for entry in sorted(os.listdir(slice_dir)):
        if not (entry.startswith("app-orca-") and entry.endswith(".scope")):
            continue
        procs = os.path.join(slice_dir, entry, "cgroup.procs")
        for pid in read_cgroup_pids(procs):
            m = read_pid_meta(pid, proc_root)
            if not m or not m["cmdline"]:
                continue
            a0 = m["cmdline"][0].split(" ")[0]
            if a0.startswith(orca_prefix):
                found[m["pid"]] = entry
    return found


def load_registered_daemons(proc_root: str, pid_record_glob: str) -> dict[int, str]:
    """Registered Orca relay/daemon PIDs from daemon pid-record files.
    Returns {pid: record_path}."""
    import glob as _glob
    registered: dict[int, str] = {}
    for path in _glob.glob(pid_record_glob):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                txt = fh.read().strip()
            pid = int(txt.split()[0])
            registered[pid] = path
        except (OSError, ValueError, IndexError):
            continue
    return registered


def _type_arg(cmdline: list[str]) -> str | None:
    for a in cmdline:
        if a.startswith("--type="):
            return a.split("=", 1)[1]
    return None


def _basename(x: str) -> str:
    return x.rstrip("/") .rpartition("/")[2] if x else ""


def classify(metas: dict[int, dict]) -> dict[int, str]:
    """Classify every sampled PID. agent-pty = positively identified
    OpenCode/other-agent process; its descendants (not otherwise identified
    as Orca-owned) inherit the exclusion. Unknown members stay 'unknown'
    (conservative: counted in the Orca set)."""
    cls: dict[int, str] = {}
    for pid, m in metas.items():
        raw = m["cmdline"]
        # Chromium rewrites argv into ONE space-joined element (setproctitle);
        # normalize both shapes.
        if len(raw) == 1 and " " in raw[0]:
            parts = raw[0].split(" ")
            argv0, args = parts[0], parts[1:]
        else:
            argv0 = raw[0] if raw else ""
            args = raw[1:]
        cmdline = [argv0] + args
        base0 = _basename(argv0)
        joined = " ".join(cmdline)
        if base0 == "opencode" or "/.opencode/bin/" in argv0:
            cls[pid] = "agent-pty"
        elif any("daemon-entry.js" in a for a in cmdline) or base0 in ("orcad", "orca-relay") \
                or "orca-relay" in joined:
            cls[pid] = "orcad" if "daemon-entry.js" in joined else "relay"
        elif base0 == "chrome_crashpad_handler" or "chrome_crashpad_handler" in argv0:
            cls[pid] = "orca-helper"
        elif base0 == "orca-ide" or argv0.endswith("/orca-ide"):
            t = _type_arg(cmdline)
            cls[pid] = ("electron-main" if t is None else
                        "electron-renderer" if t == "renderer" else
                        "electron-gpu" if t == "gpu-process" else
                        "electron-utility" if t == "utility" else
                        "electron-zygote" if t == "zygote" else "electron-other")
        else:
            cls[pid] = "unknown"
    # descendant propagation for agent-pty exclusions (unknown children only)
    changed = True
    while changed:
        changed = False
        for pid, m in metas.items():
            if cls[pid] == "unknown" and cls.get(m["ppid"]) == "agent-pty":
                cls[pid] = "agent-pty"
                changed = True
    return cls


def sample_once(env: Env, cgroup_procs: str, pid_record_glob: str,
                prev_cpu_ticks: int | None,
                orca_prefix: str | None = None) -> tuple[dict, int]:
    """One 10 s design cycle sample. Never raises: exceptions produce an
    invalid sample (a missing/invalid sample fails the cutover gate)."""
    ts = iso_now()
    try:
        cgroup_pid_list = read_cgroup_pids(cgroup_procs)
        scope_pids = discover_scope_pids(
            os.path.dirname(os.path.dirname(os.path.abspath(cgroup_procs))), orca_prefix,
            env.proc_root) if orca_prefix else {}
        metas = {}
        for pid in set(cgroup_pid_list) | set(load_registered_daemons(
                env.proc_root, pid_record_glob)) | set(scope_pids):
            m = read_pid_meta(pid, env.proc_root)
            if m:
                metas[m["pid"]] = m
        cls = classify(metas)
        registered = load_registered_daemons(env.proc_root, pid_record_glob)
        counts: dict[str, int] = {}
        for c in cls.values():
            counts[c] = counts.get(c, 0) + 1
        orca_set = [p for p, c in cls.items() if c not in AGENT_PTY_EXCLUDED_CLASSES]
        excluded = sorted(p for p, c in cls.items() if c in AGENT_PTY_EXCLUDED_CLASSES)
        rss_total = sum(metas[p]["rss_bytes"] for p in orca_set)
        cpu_ticks = sum(metas[p]["utime"] + metas[p]["stime"] for p in orca_set)
        cgroup_set = {int(p) for p in cgroup_pid_list}
        escaped, missing = [], []
        for rpid, rec in registered.items():
            if rpid not in metas:
                missing.append({"pid": rpid, "record": rec})
            elif rpid not in cgroup_set and rpid not in scope_pids:
                escaped.append({"pid": rpid, "record": rec,
                                 "class": cls[rpid], "where": "outside-operator-cgroup"})
            elif cls[rpid] not in ("orcad", "relay", "unknown"):
                escaped.append({"pid": rpid, "record": rec, "class": cls[rpid]})
        sample = {
            "ts": ts, "valid": True, "cgroup_pids": sorted(int(p) for p in cgroup_pid_list),
            "scope_pids": {str(p): scope for p, scope in scope_pids.items()},
            "counts": counts, "excluded_agent_ptys": excluded,
            "per_pid": {str(p): {"class": cls[p], "starttime": metas[p]["starttime"],
                                 "ppid": metas[p]["ppid"],
                                 "rss_bytes": metas[p]["rss_bytes"]}
                        for p in sorted(metas)},
            "rss_total_bytes": rss_total,
            "cpu_cores_est": ((cpu_ticks - prev_cpu_ticks) / CLK_TCK / 10.0)
            if prev_cpu_ticks is not None else None,
            "escaped_daemons": escaped, "missing_daemons": missing,
        }
        return sample, cpu_ticks
    except Exception as exc:  # conservative: invalid sample = gate failure
        return {"ts": ts, "valid": False, "error": repr(exc)}, prev_cpu_ticks or 0


def evaluate(sample: dict) -> tuple[bool, list[str]]:
    """Design §3b health condition for the sampled Orca workspace."""
    reasons: list[str] = []
    if not sample.get("valid"):
        return False, ["invalid-sample"]
    counts = sample.get("counts", {})
    if counts.get("electron-main", 0) < 1:
        reasons.append("missing-electron-main")
    if sample.get("escaped_daemons"):
        reasons.append("escaped-registered-daemon")
    if sample.get("missing_daemons"):
        reasons.append("missing-registered-daemon")
    return (not reasons), reasons
