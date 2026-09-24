# Stage B soak — RSS/CPU report

Window: 2026-09-24T07:20:13+02:00 → 2026-09-24T07:22:49+02:00  
Samples: 16 (16 valid, 0 invalid)

## Aggregate RSS

| metric | bytes | MiB |
|---|---|---|
| baseline (start-of-full-load) | 1189232640 | 1134.1 |
| max | 1276624896 | 1217.5 |
| final | 767680512 | 732.1 |
| max over baseline | 87392256 | 83.3 |

Final-4h growth: -10153.5 MiB/h over 0.04 h

## CPU

15-min windows: 1; worst avg 0.347 cores
Longest sustained >1 core: 0 s

## Budget evaluation

| budget | limit | observed | pass |
|---|---|---|---|
| rss_over_baseline | 1073741824 | 87392256 | PASS |
| final4h_growth | 104857600 | -10646698736.600374 | PASS |
| idle_cpu_15min_avg | 0.2 | 0.3469375 | BREACH |
| cpu_sustained | 300 | 0.0 | PASS |

**allPass: False**

