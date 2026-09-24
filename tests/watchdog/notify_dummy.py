#!/usr/bin/env python3
"""Dummy notify service for the live watchdog-contract test: pets the
calling unit's watchdog at --interval while running for --duration."""
import argparse
import os
import socket
import sys
import time


def notify(msg):
    sock = os.environ.get("NOTIFY_SOCKET")
    if not sock:
        return
    if sock.startswith("@"):
        sock = "\0" + sock[1:]
    s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    s.sendto(msg.encode(), sock)
    s.close()


p = argparse.ArgumentParser()
p.add_argument("--interval", type=float, default=2.0)
p.add_argument("--duration", type=float, default=8.0)
p.add_argument("--pet", choices=["yes", "no"], default="yes")
a = p.parse_args()
notify("READY=1")
deadline = time.monotonic() + a.duration
while time.monotonic() < deadline:
    if a.pet == "yes":
        notify("WATCHDOG=1")
    time.sleep(a.interval)
sys.exit(0)
