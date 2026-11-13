# Rafiq — training (Python)

Rafiq learns each elder's own normal from Salem Band data and flags what is
unusual **for that person**. Everything here is our own code: no external AI,
no LLM, no pre-trained model, no scikit-learn — Python 3.9+ and numpy only.
Production never runs Python: the trained model is exported as plain JSON and
scored in TypeScript (`supabase/functions/_shared/rafiq/`).

## Layers

| Layer | What | Where (Python ⇄ TypeScript) |
|---|---|---|
| A | Daily aggregates per "Rafiq day" (07:00 → 07:00 local: the day plus the night after it), personal baselines (median + MAD over days D-34…D-7, as Trend Watch), robust z-scores, 7/30-day Theil–Sen slopes, 3-day half-life EWMA | `rafiq/core.py` ⇄ `_shared/rafiq/core.ts` |
| B | Isolation Forest, written from scratch (100 trees × 256 samples) on 20 features from layer A | `rafiq/iforest.py` ⇄ `_shared/rafiq/forest.ts` |
| C | Decision: rules (unusual for the person AND a minimum real change) + the model (confirms a rule, or flags an unusual mix alone) → normal / watch / alert / urgent with a reason | `rafiq/core.py` (`decide_elder`) ⇄ `_shared/rafiq/core.ts` |

Python and TypeScript are bit-identical (only + − × ÷, sorting and
comparisons; constants that need `log`/`pow` are shipped in the model JSON).
`tests/rafiqParity.test.ts` replays the fixtures and demands exact equality.

## Run

```bash
cd ml
python3 -m unittest discover -s tests -v   # unit tests (18)
python3 -m rafiq.train                     # build data, train, evaluate, export (~1 min)
python3 -m rafiq.train --quick             # smoke test
```

Outputs:
- `supabase/functions/_shared/rafiq/model.json` — the model (version, features, all
  constants, thresholds, trees). The edge function imports it.
- `ml/reports/rafiq-v1.md` / `.json` — evaluation on held-out elders.
- `tests/fixtures/rafiq/parity-*.json.gz` — inputs and every expected value for
  the TypeScript parity tests. **Re-run `npm test` after retraining.**

## Synthetic data (`rafiq/synth.py`)

Same fields and rates as the real `vitals` table (source `band`): skin
temperature, steps and movement every 10 minutes while worn; heart rate + SpO2
only when still (`is_resting`), with a quality 0–100; nothing off the wrist;
falls as `band_events`. Each elder has their own age (65–95), resting heart
rate, oxygen, wrist temperature, activity, sleep and nap times, charging time,
forgotten days, night-time removal, dropouts, low-quality readings, day-to-day
drift and a slow seasonal temperature change.

Labelled events: resting heart rate rising over 4–10 days (+8–18 bpm), night
oxygen dips (3–6 points, 3–6 nights), fever (+0.8–1.8 °C with a faster heart),
sudden inactivity (10–40% of usual, 2–7 days), a fall followed by 20–90 min of
stillness. Decoys that should stay quiet: a holiday (55–72% of usual steps), a
new exercise habit, one bad night, hot weather, a fall the elder cancelled.

## Retraining on real data

1. Export `vitals` (`source = 'band'`: elder_id, kind, value_numeric,
   captured_at, is_resting, quality) and `band_events` (elder_id, kind,
   band_time) — the founder runs the export; never commit it.
2. Write a loader that returns, per elder, the same `rows` / `events` dicts
   `synth.simulate()` returns (kind codes in `core.KIND` / `core.EVENT`) and the
   elder's timezone; feed them through `day_aggregates` → `elder_features` in
   `dataset.elder_record`.
3. Train on all days (the forest is unsupervised: no labels needed). Choose
   thresholds on a separate group of elders, as `train.py` does.
4. Evaluation needs labels: start collecting them from the app (alerts the
   family marked "this was real / not needed") — until then keep reporting on
   synthetic data, and compare the real false-alarm rate with the synthetic one.
5. Bump `VERSION` in `train.py`. Every score row stores the model version.

## What needs real band data to improve

- **Thresholds and floors** (minimum changes, robust-SD floors, activity ratios)
  are educated guesses tuned on synthetic data; real day-to-day variability of
  elders on this band will move them.
- **Night oxygen**: the synthetic band reports whole-percent SpO2 with a simple
  noise model; real wrist SpO2 (motion, poor perfusion, cold hands) is noisier.
- **Wrist temperature vs. weather and season**: modelled crudely here; real data
  decides whether temperature can ever be trusted alone.
- **Falls**: the band's own fall detection and the 30-second "Are you OK?" flow
  handle falls in real time; Rafiq only reviews the day after. Real fall data is
  rare — keep it that way.
- **The model's job**: on synthetic data the rules already catch most events;
  the Isolation Forest mainly adds sensitivity to unusual combinations. Its real
  value can only be judged on real elders.
