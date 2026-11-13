# Rafiq rafiq-v1 — evaluation on held-out synthetic elders

Trained 2026-10-23 on 300 synthetic elders; thresholds chosen on 100 others; numbers below are on 150 elders never seen before (15894 scored days ≈ 2271 elder-weeks).

| Event | Events | Noticed (watch, in-app) | Pushed (alert/urgent) | Days to push (median) | Precision of its pushes | Model alone noticed |
|---|---|---|---|---|---|---|
| Resting heart rate rising over days | 41 | 100% | 93% | 5 | 83% | 76% |
| Oxygen dips at night | 33 | 85% | 85% | 2 | 96% | 30% |
| Fever (warmer + faster heart) | 42 | 100% | 95% | 1 | 100% | 83% |
| Sudden inactivity | 44 | 100% | 86% | 2 | 98% | 0% |
| Fall followed by stillness | 48 | 100% | 100% | 1 | 100% | 2% |

| Overall | Rules + model | Rules only | Model only |
|---|---|---|---|
| Precision of pushes | 94% | 94% | 94% |
| Precision of in-app notices | 58% | 59% | 73% |
| False pushes per elder per week | 0.007 | 0.007 | 0.001 |
| False in-app notices per elder per week | 0.091 | 0.083 | 0.013 |
| Ordinary days with a push | 0.15% | 0.14% | 0.02% |

| Decoy (should stay quiet) | Count | Noticed (in-app) | Pushed |
|---|---|---|---|
| bad_night | 22 | 0 | 0 |
| exercise | 40 | 4 | 0 |
| false_fall | 23 | 1 | 0 |
| holiday | 33 | 20 | 2 |
| hot_spell | 19 | 6 | 0 |
