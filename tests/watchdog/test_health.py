#!/usr/bin/env python3
"""Clause 3b health-check tests: heartbeat staleness detection, flip
atomicity, cgroup-empty no-op. Also exercises the health script end-to-end
via subprocess with env-injected state/cgroup fixtures."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "orca_watchdog_lib",
    os.path.join(HERE, "..", "..", "scripts", "watchdog", "orca_watchdog_lib.py"))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)

HEALTH = os.path.join(HERE, "..", "..", "scripts", "watchdog", "orca-workspace-health")
FALLBACK = os.path.join(HERE, "..", "..", "scripts", "watchdog", "orca-workspace-fallback")


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory(prefix="orca-health-test-")
        self.state = os.path.join(self.dir.name, "state")
        os.makedirs(self.state)
        self.env = lib.Env(state=self.state,
                           selector=os.path.join(self.state, "launcher-selector"))
        self.env.ensure_dirs()
        self.cgroup = os.path.join(self.dir.name, "cgroup.procs")

    def tearDown(self):
        self.dir.cleanup()

    def set_cgroup(self, pids):
        with open(self.cgroup, "w") as fh:
            fh.write("".join("%d\n" % p for p in pids))

    def run_health(self):
        env = dict(os.environ,
                   ORCA_WATCHDOG_STATE_DIR=self.state,
                   ORCA_WATCHDOG_SELECTOR_FILE=self.env.selector)
        return subprocess.run(["python3", HEALTH, "--cgroup-procs", self.cgroup],
                              env=env, capture_output=True, text=True, timeout=10)

    def seed_selector(self, val="orca"):
        with open(self.env.selector, "w") as fh:
            fh.write(val + "\n")

    def test_fresh_heartbeat_noop(self):
        self.env.touch_heartbeat()
        self.set_cgroup([42, 43])
        self.seed_selector()
        r = self.run_health()
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.env.read_selector(), "orca")
        self.assertFalse(os.path.exists(os.path.join(self.state, "breaches.jsonl")))

    def test_stale_heartbeat_live_cgroup_flips(self):
        self.env.touch_heartbeat()
        # age the heartbeat 60 s into the past
        old = time.time() - 60
        os.utime(os.path.join(self.state, "heartbeat"), (old, old))
        self.set_cgroup([42])
        self.seed_selector()
        r = self.run_health()
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.env.read_selector(), "zellij")
        with open(os.path.join(self.state, "breaches.jsonl")) as fh:
            breaches = [json.loads(ln) for ln in fh if ln.strip()]
        self.assertEqual(breaches[-1]["actor"], "health-timer")
        self.assertIn("stale", breaches[-1]["reason"])
        self.assertTrue(os.path.exists(os.path.join(self.state, "alerts.log")))

    def test_missing_heartbeat_live_cgroup_flips(self):
        self.set_cgroup([42])
        self.seed_selector()
        r = self.run_health()
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.env.read_selector(), "zellij")

    def test_stale_heartbeat_empty_cgroup_noop(self):
        self.env.touch_heartbeat()
        old = time.time() - 60
        os.utime(os.path.join(self.state, "heartbeat"), (old, old))
        self.set_cgroup([])
        self.seed_selector()
        r = self.run_health()
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.env.read_selector(), "orca")
        self.assertFalse(os.path.exists(os.path.join(self.state, "breaches.jsonl")))

    def test_flip_atomic_content(self):
        self.env.touch_heartbeat()
        old = time.time() - 60
        os.utime(os.path.join(self.state, "heartbeat"), (old, old))
        self.set_cgroup([7])
        self.seed_selector()
        self.run_health()
        self.run_health()  # idempotent: second run must not duplicate records
        with open(self.env.selector) as fh:
            self.assertEqual(fh.read(), "zellij\n")
        with open(os.path.join(self.state, "breaches.jsonl")) as fh:
            lines = [ln for ln in fh if ln.strip()]
        self.assertEqual(len(lines), 1)

    def test_fallback_script_flips(self):
        self.seed_selector()
        env = dict(os.environ,
                   ORCA_WATCHDOG_STATE_DIR=self.state,
                   ORCA_WATCHDOG_SELECTOR_FILE=self.env.selector)
        r = subprocess.run(["python3", FALLBACK], env=env,
                           capture_output=True, text=True, timeout=10)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.env.read_selector(), "zellij")
        with open(os.path.join(self.state, "breaches.jsonl")) as fh:
            breaches = [json.loads(ln) for ln in fh if ln.strip()]
        self.assertEqual(breaches[-1]["actor"], "systemd-onfailure")


if __name__ == "__main__":
    unittest.main()
