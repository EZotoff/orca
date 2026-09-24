#!/usr/bin/env python3
"""Bracketed-paste byte probe. Enables DECSET 2004 on the controlling TTY,
then echoes every byte received (escaped) to stdout and a log file.

If a paste arrives as ONE bracketed-paste sequence, output shows a single
ESC[200~ ... ESC[201~ wrap. If it arrives per-line/per-key, the wraps either
do not appear (mode off from the app's perspective) or interleave per line.
"""
import os
import sys

LOG = os.environ.get("BP_LOG", "/home/ezotoff/src/orca-g4/spikes/g4-bp-probe.log")


def esc(b: bytes) -> str:
    out = []
    for byte in b:
        if byte == 0x1B:
            out.append("ESC")
        elif byte == 0x0D:
            out.append("\\r")
        elif byte == 0x0A:
            out.append("\\n")
        elif 0x20 <= byte < 0x7F:
            out.append(chr(byte))
        else:
            out.append(f"\\x{byte:02x}")
    return "".join(out)


def main() -> None:
    # Advertise bracketed-paste mode support so xterm.js wraps pastes.
    sys.stdout.write("\x1b[?2004h")
    sys.stdout.flush()
    with open(LOG, "ab", buffering=0) as log:
        log.write(f"\n=== probe start {os.environ.get('BP_TAG', '')} ===\n".encode())
        while True:
            chunk = os.read(0, 4096)
            if not chunk:
                break
            log.write(esc(chunk).encode() + b"\n")
            sys.stdout.write("\x1b[?2004l" + esc(chunk).encode() + b"\x1b[?2004h")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
