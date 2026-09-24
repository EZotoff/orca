#!/usr/bin/env bash
set -uo pipefail
cd /home/ezotoff/src/orca-nav/spikes
RAW=nav-raw-live.log
focus() { xdotool mousemove $1 $2 click 1; sleep 0.45; }
active() { node cdp.mjs eval "(()=>{const ae=document.activeElement; const p=ae&&ae.closest&&ae.closest('.pane'); if(!p) return {err:'no pane'}; const r=p.getBoundingClientRect(); return {cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2)}})()"; }
consume() { node cdp.mjs eval "window.__consumeLog ?? []"; }
press() {
  local name=$1 cx=$2 cy=$3 key=$4
  echo "### $name origin=($cx,$cy) key=$key $(date -Iseconds)" | tee -a "$RAW"
  focus $cx $cy
  node cdp.mjs dump-log >/dev/null
  node cdp.mjs eval "window.__consumeLog = []" >/dev/null
  echo "-- origin-active: $(active)" | tee -a "$RAW"
  xdotool key "$key"
  sleep 0.6
  echo "-- cdp-window-events:" | tee -a "$RAW"
  node cdp.mjs dump-log | tee -a "$RAW"
  echo "-- consume-log: $(consume)" | tee -a "$RAW"
  echo "-- dest-active: $(active)" | tee -a "$RAW"
}
