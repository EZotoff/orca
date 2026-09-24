#!/usr/bin/env python3
"""Sampler unit tests: classification, exclusion, breach/flip, pet/withhold.
Uses fixture /proc trees + cgroup listings + a fake sd_notify capture socket."""
from __future__ import annotations

import argparse
import json
import os
import socket
import tempfile
import unittest

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "orca_watchdog_lib",
    os.path.join(HERE, "..", "..", "scripts", "watchdog", "orca_watchdog_lib.py"))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)

from importlib.machinery import SourceFileLoader
sampler_path = os.path.join(HERE, "..", "..", "scripts", "watchdog", "orca-workspace-sampler")
spec2 = importlib.util.spec_from_file_location(
    "sampler", sampler_path, loader=SourceFileLoader("sampler", sampler_path))
sampler = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(sampler)

PAGE = 4096


def make_stat(pid, ppid, comm, utime=100, stime=100):
    # fields 3..24 of /proc/pid/stat (after "pid (comm) ")
    f = ["S"] + ["1"] * 20  # fields 3..22+
    f[1] = str(ppid)        # field 4 (ppid)
    f[11] = str(utime)      # field 14
    f[12] = str(stime)      # field 15
    f[19] = "1234567"       # field 22 starttime
    return "%d (%s) %s\n" % (pid, comm, " ".join(f))


class Fixture:
    def __init__(self):
        self.dir = tempfile.TemporaryDirectory(prefix="orca-wd-test-")
        self.proc = os.path.join(self.dir.name, "proc")
        self.state = os.path.join(self.dir.name, "state")
        os.makedirs(os.path.join(self.proc, "1"))
        self.slice_dir = os.path.join(self.dir.name, "app.slice")
        self.cgroup_procs = os.path.join(self.slice_dir, "orca-operator.service",
                                         "cgroup.procs")
        os.makedirs(os.path.dirname(self.cgroup_procs), exist_ok=True)
        self.pid_records = os.path.join(self.dir.name, "daemon")
        os.makedirs(self.pid_records)
        self.sock_path = os.path.join(self.dir.name, "notify.sock")
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.sock.bind(self.sock_path)
        self.sock.settimeout(0.05)
        self._next_pid = [100]

    def add(self, comm, cmdline, ppid=1, rss_pages=10):
        pid = self._next_pid[0]
        self._next_pid[0] += 1
        d = os.path.join(self.proc, str(pid))
        os.makedirs(d)
        with open(os.path.join(d, "stat"), "w") as fh:
            fh.write(make_stat(pid, ppid, comm))
        with open(os.path.join(d, "cmdline"), "wb") as fh:
            fh.write(("\0".join(cmdline) + "\0").encode())
        with open(os.path.join(d, "statm"), "w") as fh:
            fh.write("1 %d 0 0 0 0 0\n" % rss_pages)
        return pid

    def set_cgroup(self, pids):
        with open(self.cgroup_procs, "w") as fh:
            fh.write("".join("%d\n" % p for p in pids))

    def register_daemon(self, pid):
        with open(os.path.join(self.pid_records, "daemon-v36.pid"), "w") as fh:
            fh.write("%d\n" % pid)

    def env(self):
        return lib.Env(state=self.state,
                       selector=os.path.join(self.state, "launcher-selector"),
                       proc_root=self.proc, notify_socket=self.sock_path)

    def drain_notify(self):
        msgs = []
        try:
            while True:
                msgs.append(self.sock.recv(4096).decode())
        except socket.timeout:
            pass
        return msgs

    def samples(self):
        out = []
        path = os.path.join(self.state, "samples.jsonl")
        if os.path.exists(path):
            with open(path) as fh:
                out = [json.loads(ln) for ln in fh if ln.strip()]
        return out

    def decisions(self):
        path = os.path.join(self.state, "decisions.jsonl")
        if not os.path.exists(path):
            return []
        with open(path) as fh:
            return [json.loads(ln) for ln in fh if ln.strip()]

    def run_sampler_with_prefix(self, cycles, orca_prefix):
        args = argparse.Namespace(
            cgroup_procs=self.cgroup_procs,
            pid_record_glob=os.path.join(self.pid_records, "daemon-*.pid"),
            interval=0, once=False, cycles=cycles, orca_prefix=orca_prefix)
        return sampler.run(self.env(), args)

    def run_sampler(self, cycles):
        args = argparse.Namespace(
            cgroup_procs=self.cgroup_procs,
            pid_record_glob=os.path.join(self.pid_records, "daemon-*.pid"),
            interval=0, once=False, cycles=cycles, orca_prefix=None)
        return sampler.run(self.env(), args)

    def cleanup(self):
        self.sock.close()
        self.dir.cleanup()


RC = "/home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7"


class SamplerTests(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()

    def tearDown(self):
        self.fx.cleanup()

    def healthy_fixture(self):
        main = self.fx.add("orca-ide", [RC + "/orca-ide", "--no-sandbox",
                                        "--user-data-dir=" + RC + "/scratch-userdata"],
                           rss_pages=50000)
        rend = self.fx.add("orca-ide", [RC + "/orca-ide", "--type=renderer",
                                        "--user-data-dir=x"], ppid=main)
        gpu = self.fx.add("orca-ide", [RC + "/orca-ide", "--type=gpu-process"],
                          ppid=main)
        util = self.fx.add("orca-ide", [RC + "/orca-ide", "--type=utility",
                                        "--utility-sub-type=network.mojom.NetworkService"],
                           ppid=main)
        zyg = self.fx.add("orca-ide", [RC + "/orca-ide", "--type=zygote"], ppid=main)
        crash = self.fx.add("chrome_crashpad_handler",
                            [RC + "/chrome_crashpad_handler", "--monitor-self"])
        daemon = self.fx.add("node", [RC + "/orca-ide",
                                      RC + "/resources/app.asar.unpacked/out/main/daemon-entry.js",
                                      "--socket", "x.sock"])
        self.fx.register_daemon(daemon)
        self.fx.set_cgroup([main, rend, gpu, util, zyg, crash, daemon])
        return main, daemon

    def test_healthy_pets_and_records(self):
        self.healthy_fixture()
        rc = self.fx.run_sampler(cycles=3)
        self.assertEqual(rc, 0)
        env = self.fx.env()
        self.assertEqual(env.read_selector(), "orca")
        self.assertIsNotNone(env.heartbeat_age())
        samples = self.fx.samples()
        self.assertEqual(len(samples), 3)
        counts = samples[0]["counts"]
        self.assertEqual(counts["electron-main"], 1)
        self.assertEqual(counts["electron-renderer"], 1)
        self.assertEqual(counts["electron-gpu"], 1)
        self.assertEqual(counts["electron-utility"], 1)
        self.assertEqual(counts["electron-zygote"], 1)
        self.assertEqual(counts["orca-helper"], 1)
        self.assertEqual(counts["orcad"], 1)
        self.assertTrue(all(s["valid"] for s in samples))
        self.assertTrue(all(d["healthy"] for d in self.fx.decisions()))
        self.assertEqual(samples[0]["rss_total_bytes"], (50000 + 6 * 10) * PAGE)
        msgs = self.fx.drain_notify()
        self.assertIn("READY=1", msgs)
        self.assertGreaterEqual(msgs.count("WATCHDOG=1"), 3)

    def test_agent_pty_exclusion(self):
        main, daemon = self.healthy_fixture()
        oc = self.fx.add("opencode", ["/home/ezotoff/.opencode/bin/opencode"],
                         ppid=main, rss_pages=20000)
        shell = self.fx.add("zsh", ["/usr/bin/zsh"], ppid=oc, rss_pages=300)
        self.fx.set_cgroup([p for p in (main, daemon, oc, shell)])
        self.fx.run_sampler(cycles=1)
        s = self.fx.samples()[0]
        self.assertEqual(sorted(s["excluded_agent_ptys"]), [oc, shell])
        self.assertEqual(s["counts"]["agent-pty"], 2)
        # excluded RSS not in the Orca aggregate
        self.assertEqual(s["per_pid"][str(oc)]["rss_bytes"], 20000 * PAGE)

    def test_unknown_counts_conservatively(self):
        main, daemon = self.healthy_fixture()
        unk = self.fx.add("mysteryd", ["/usr/local/bin/mysteryd", "--serve"],
                          rss_pages=100)
        self.fx.set_cgroup([main, daemon, unk])
        self.fx.run_sampler(cycles=1)
        s = self.fx.samples()[0]
        self.assertEqual(s["counts"]["unknown"], 1)
        # unknown member is INSIDE the conservative set (aggregated, healthy)
        self.assertTrue(s["valid"])
        self.assertTrue(self.fx.decisions()[0]["healthy"])
        self.assertIn(str(unk), s["per_pid"])
        self.assertEqual(s["per_pid"][str(unk)]["class"], "unknown")

    def test_missing_main_withholds_and_flips_after_sustained_breach(self):
        _, daemon = self.healthy_fixture()
        pid = int(open(self.fx.pid_records + "/daemon-v36.pid").read())
        self.fx.set_cgroup([pid])  # daemon only, electron-main gone
        self.fx.run_sampler(cycles=3)
        env = self.fx.env()
        self.assertEqual(env.read_selector(), "zellij")
        self.assertTrue(all(not d["healthy"] for d in self.fx.decisions()))
        self.assertEqual(self.fx.decisions()[-1]["action"], "selector-flip")
        with open(os.path.join(self.fx.state, "breaches.jsonl")) as fh:
            breaches = [json.loads(ln) for ln in fh if ln.strip()]
        self.assertEqual(breaches[-1]["actor"], "sampler")
        self.assertEqual(breaches[-1]["to"], "zellij")

    def test_short_breach_does_not_flip(self):
        _, daemon = self.healthy_fixture()
        pid = int(open(self.fx.pid_records + "/daemon-v36.pid").read())
        self.fx.set_cgroup([pid])
        self.fx.run_sampler(cycles=2)  # below RSS_BREACH_STREAK=3
        self.assertEqual(self.fx.env().read_selector(), "orca")
        self.assertEqual(self.fx.decisions()[-1]["action"], "none")

    def test_escaped_registered_daemon_is_gate_failure(self):
        main, daemon = self.healthy_fixture()
        # daemon registered but RUNNING OUTSIDE the operator cgroup
        self.fx.set_cgroup([main])
        self.fx.run_sampler(cycles=3)
        s = self.fx.samples()[0]
        self.assertEqual(len(s["escaped_daemons"]), 1)
        self.assertEqual(s["escaped_daemons"][0]["where"], "outside-operator-cgroup")
        self.assertFalse(self.fx.decisions()[0]["healthy"])
        self.assertEqual(self.fx.env().read_selector(), "zellij")

    def test_missing_registered_daemon(self):
        main, _ = self.healthy_fixture()
        # daemon record points at a PID that no longer exists
        with open(self.fx.pid_records + "/daemon-v36.pid", "w") as fh:
            fh.write("99999\n")
        self.fx.set_cgroup([main])
        self.fx.run_sampler(cycles=3)
        s = self.fx.samples()[0]
        self.assertEqual(len(s["missing_daemons"]), 1)
        self.assertFalse(self.fx.decisions()[0]["healthy"])
        self.assertEqual(self.fx.env().read_selector(), "zellij")

    def test_invalid_sample_unhealthy(self):
        self.assertFalse(lib.evaluate({"valid": False})[0])
        self.assertEqual(lib.evaluate({"valid": False})[1], ["invalid-sample"])

    def test_scope_discovery_main_daemon_outside_unit_cgroup(self):
        # Live finding 2026-09-24: the app migrates electron main + daemon
        # into a sibling app-orca-<pid>.scope; zygote argv is ONE space-joined
        # element. Scope members matching the RC prefix are healthy, not
        # escaped; foreign scopes (other install) are ignored.
        main, daemon = self.healthy_fixture()
        # emulate the live shape: main+daemon in a scope, not in unit cgroup
        scope_dir = self.fx.slice_dir
        scope = os.path.join(scope_dir, "app-orca-%d.scope" % main)
        os.makedirs(scope)
        with open(os.path.join(scope, "cgroup.procs"), "w") as fh:
            fh.write("%d\n%d\n" % (main, daemon))
        foreign = self.fx.add("orca-ide",
                              ["/home/ezotoff/src/orca-nav/spikes/throwaway-nav/app/orca-ide"])
        fscope = os.path.join(scope_dir, "app-orca-%d.scope" % foreign)
        os.makedirs(fscope)
        with open(os.path.join(fscope, "cgroup.procs"), "w") as fh:
            fh.write("%d\n" % foreign)
        # space-joined argv shape for the main (Chromium setproctitle)
        d = os.path.join(self.fx.proc, str(main))
        with open(os.path.join(d, "cmdline"), "wb") as fh:
            fh.write(("%s --no-sandbox --user-data-dir=x" % (RC + "/orca-ide")).encode() + b"\0")
        # unit cgroup empty: in the live shape the zygotes stay behind, but
        # an empty cgroup is the harder case (main only via scope discovery)
        self.fx.set_cgroup([])
        self.fx.run_sampler_with_prefix(cycles=1, orca_prefix=RC)
        s = self.fx.samples()[0]
        self.assertEqual(s["counts"]["electron-main"], 1)
        self.assertEqual(s["counts"]["orcad"], 1)
        self.assertEqual(s["escaped_daemons"], [])
        self.assertEqual(s["missing_daemons"], [])
        self.assertTrue(self.fx.decisions()[0]["healthy"])
        self.assertEqual(s["scope_pids"], {str(main): "app-orca-%d.scope" % main,
                                           str(daemon): "app-orca-%d.scope" % main})

    def test_space_joined_argv_classified(self):
        pid = self.fx.add("orca-ide", ["%s/orca-ide --type=renderer --no-sandbox" % RC])
        cls = lib.classify({pid: lib.read_pid_meta(str(pid), self.fx.proc)})
        self.assertEqual(cls[pid], "electron-renderer")

    def test_flip_atomicity_and_idempotence(self):
        env = self.fx.env()
        env.ensure_dirs()
        env.write_atomic("launcher-selector", "orca\n")
        self.assertTrue(env.flip_selector("test", "tester"))
        with open(env.selector) as fh:
            self.assertEqual(fh.read(), "zellij\n")
        self.assertFalse(env.flip_selector("test-again", "tester"))
        with open(os.path.join(self.fx.state, "breaches.jsonl")) as fh:
            lines = [ln for ln in fh if ln.strip()]
        self.assertEqual(len(lines), 1)


if __name__ == "__main__":
    unittest.main()
