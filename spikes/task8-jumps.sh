#!/usr/bin/env bash
# Task 8 jump runner. Usage: task8-jumps.sh <jumpname> <originTabIdx> <originPaneIdx> <targetPaneIdx> <chord1[:chord2...]>
# Chords comma-separated xdotool syntax (alt+l etc.). Pane idx = DOM index (tab1 0-7, tab2 8-14, tab3 15-20).
set -uo pipefail
cd /home/ezotoff/src/orca-nav/spikes
export CDP_PORT=18242 DISPLAY=:1
WID=136314884
TABC=(391 611 831)   # tab click x coords, y=20

name=$1; origTab=$2; origPane=$3; tgtPane=$4; chords=$5

paneCenter() { node cdp.mjs eval "(()=>{const ps=[...document.querySelectorAll('.pane')]; const r=ps[$1].getBoundingClientRect(); return Math.round(r.x+r.width*0.4)+','+Math.round(r.y+Math.min(60,r.height*0.3))})()" | tr -d '"'; }
activeIdx() { node cdp.mjs eval "(()=>{const ps=[...document.querySelectorAll('.pane')]; const i=ps.findIndex(p=>p.contains(document.activeElement)&&p.getBoundingClientRect().width>0); return i})()" | tr -d '"'; }

# 1. activate origin tab
xdotool mousemove --window $WID ${TABC[$origTab]} 20 click 1; sleep 0.6
# 2. focus origin pane
c=$(paneCenter $origPane); xdotool mousemove --window $WID ${c%,*} ${c#*,} click 1; sleep 0.6
a=$(activeIdx)
if [ "$a" != "$origPane" ]; then echo "ROW $name SETUP-FAIL active=$a want=$origPane"; exit 2; fi
# 3. clear instrumentation
node cdp.mjs eval "window.__t8inst={keys:[],focuses:[]}" >/dev/null
# 4. send chords
IFS=',' read -ra CH <<< "$chords"
t0=$(date +%s%3N)
for k in "${CH[@]}"; do xdotool key --window $WID "$k"; sleep 0.22; done
sleep 0.35
# 5. read result
res=$(node cdp.mjs eval "JSON.stringify({keys:window.__t8inst.keys,focuses:window.__t8inst.focuses.slice(-6),active:(()=>{const ps=[...document.querySelectorAll('.pane')];return ps.findIndex(p=>p.contains(document.activeElement)&&p.getBoundingClientRect().width>0)})()})")
tWall=$(( $(date +%s%3N) - t0 ))
echo "ROW $name src=$origPane dst=$tgtPane nchords=${#CH[@]} active=$( node cdp.mjs eval "(()=>{const ps=[...document.querySelectorAll('.pane')];return ps.findIndex(p=>p.contains(document.activeElement)&&p.getBoundingClientRect().width>0)})()" | tr -d '"' ) wallms=$tWall"
echo "DATA $res"
