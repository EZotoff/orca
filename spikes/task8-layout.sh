#!/usr/bin/env bash
# Task 8 layout builder: 3 tabs, 21 panes, mixed real-opencode + synthetic sessions.
set -uo pipefail
cd /home/ezotoff/src/orca-nav/spikes
export CDP_PORT=18242 DISPLAY=:1
WID=136314884

panes() { node cdp.mjs eval "JSON.stringify([...document.querySelectorAll('.pane')].map(p=>{const r=p.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),a:p.contains(document.activeElement)}}))"; }
count() { node cdp.mjs eval "[...document.querySelectorAll('.pane')].length"; }
split_right() { xdotool key --window $WID ctrl+shift+d; sleep 0.9; }
split_down() {
  # right-click center of currently-active pane, click menu item
  local c; c=$(node cdp.mjs eval "(()=>{const p=[...document.querySelectorAll('.pane')].find(p=>p.contains(document.activeElement)); if(!p) return '0,0'; const r=p.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2)})()" | tr -d '"')
  xdotool mousemove --window $WID ${c%,*} ${c#*,} click 3; sleep 0.5
  node cdp.mjs eval "(()=>{const w=document.querySelector('[data-radix-popper-content-wrapper]'); if(!w) return 'nomenu'; let el=[...w.querySelectorAll('*')].find(e=>e.textContent.trim().startsWith('Split Terminal Down')&&e.children.length>0); if(!el) return 'notfound'; el.click(); return 'ok'})()"
  sleep 0.9
}
focus_xy() { xdotool mousemove --window $WID $1 $2 click 1; sleep 0.45; }
type_cmd() { xdotool type --window $WID --delay 20 "$1"; sleep 0.25; xdotool key --window $WID Return; sleep 0.4; }
newtab() { xdotool key --window $WID ctrl+shift+t; sleep 1.2; }

cmd=$1
case $cmd in
geom) panes ;;
normalize)
  # close panes until 1 remains (Ctrl+W closes active pane)
  while [ "$(count)" -gt 1 ]; do xdotool key --window $WID ctrl+w; sleep 0.6; done
  echo "normalized to $(count)"
  ;;
tab1|tab2|tab3)
  rows=$2; cols=3  # unused
  # build 2 columns x N rows: split right once, then split down (N-1) in each column
  split_right
  # left column: focus left pane top area
  L=$(node cdp.mjs eval "(()=>{const ps=[...document.querySelectorAll('.pane')].sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x); const r=ps[0].getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+Math.min(60,r.height/2))})()" | tr -d '"')
  focus_xy ${L%,*} ${L#*,}
  for i in $(seq 1 $(($2-1))); do split_down; done
  # right column
  R=$(node cdp.mjs eval "(()=>{const ps=[...document.querySelectorAll('.pane')].sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x); const r=ps[ps.length-1].getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+Math.min(60,r.height/2))})()" | tr -d '"')
  focus_xy ${R%,*} ${R#*,}
  for i in $(seq 1 $(($3-1))); do split_down; done
  echo "$cmd built: $(count) panes"
  panes
  ;;
newtab) newtab; echo "newtab: $(count) panes" ;;
fill)
  # fill active pane with command $2
  type_cmd "$2"
  ;;
jump-ready) panes ;;
esac
