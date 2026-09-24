| t1-L1-R1 | T1-L1 | T1-R1 | 1 | 0.6 |  |
| t1-R1-L1 | T1-R1 | T1-L1 | 1 | 1.1 |  |
| t1-L1-L2 | T1-L1 | T1-L2 | 1 | 1.3 |  |
| t1-L2-L1 | T1-L2 | T1-L1 | 1 | 1.0 |  |
| t1-L1-R4 | T1-L1 | T1-R4 | 4 | 0.6 |  |
| t1-R4-L1 | T1-R4 | T1-L1 | 4 | 1.0 |  |
| t1-L4-R1 | T1-L4 | T1-R1 | 4 | 1.0 |  |
| t1-R1-L4 | T1-R1 | T1-L4 | 4 | 1.1 |  |
| t1-L2-R3 | T1-L2 | T1-R4 | 3 | 1.0 | plan overshot (3 downs from R2 land on R4) — directional behavior correct |
| t1-R2-L3 | T1-R2 | T1-L3 | 2 | 1.4 |  |
| t2-L1-L3 | T2-L1 | T2-L3 | 2 | 1.0 |  |
| t2-R1-R2 | T2-R1 | T2-R2 | 1 | 1.2 |  |
| t2-L3-R4 | T2-L3 | T2-R4 | 4 | 0.5 |  |
| t2-R4-L1 | T2-R4 | T2-L1 | 4 | 1.2 |  |
| t2-L2-R2 | T2-L2 | T2-R2 | 1 | 0.7 |  |
| t3-L3-R3 | T3-L3 | T3-R3 | 3 | 0.6 |  |
| t3-R3-L1 | T3-R3 | T3-L1 | 3 | 0.9 |  |
| t3-L1-R1 | T3-L1 | T3-R1 | 1 | 0.7 |  |
| t3-R2-L2 | T3-R2 | T3-L1 | 2 | 0.5 | plan undershot (2 chords reach T3-L1) — directional behavior correct |
| t3-L1-L3 | T3-L1 | T3-L3 | 2 | 0.9 |  |
| x-t1R4-t2 | T1-R4 | T2-R2 | 1 | 16.2 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t2L1-t1 | T2-L1 | T1-R4 | 1 | 21.6 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t2R4-t3 | T2-R4 | T3-L3 | 1 | 18.0 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t3L1-t2 | T3-L1 | T2-R4 | 1 | 16.4 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t3R4-t1L1-worst | T3-R3 | T2-L2 | 5 | 1.2 | 5-chord prefix of far cross-tab path; target NOT reached (see chase) |
| x-t1L1-t3R3-worst | T1-L1 | T2-L3 | 5 | 0.6 | 5-chord prefix of far cross-tab path; target NOT reached (see chase) |
