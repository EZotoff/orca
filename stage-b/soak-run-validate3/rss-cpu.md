# Stage B soak — RSS/CPU report

Window: 2026-09-24T07:23:15+02:00 → 2026-09-24T07:25:24+02:00  
Samples: 12 (12 valid, 0 invalid)

## Aggregate RSS

| metric | bytes | MiB |
|---|---|---|
| baseline (start-of-full-load) | 696193024 | 663.9 |
| max | 1191911424 | 1136.7 |
| final | 823812096 | 785.6 |
| max over baseline | 495718400 | 472.8 |

Final-4h growth: 3972.9 MiB/h over 0.03 h

## CPU

15-min windows: 1; worst avg -0.072 cores
Longest sustained >1 core: 10 s

## Budget evaluation

| budget | limit | observed | pass |
|---|---|---|---|
| rss_over_baseline | 1073741824 | 495718400 | PASS |
| final4h_growth | 104857600 | 4165906433.7366896 | BREACH |
| idle_cpu_15min_avg | 0.2 | -0.07208333333333329 | PASS |
| cpu_sustained | 300 | 10.0 | PASS |

**allPass: False**

