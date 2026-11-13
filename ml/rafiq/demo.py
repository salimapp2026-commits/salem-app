"""A scripted synthetic elder for the in-app demo / replay (founder's test elder).

    cd ml && python3 -m rafiq.demo --out /path/to/demo.json

61 days of Salem Band data ending NOW (nothing in the future), Africa/Cairo:
  • days  0–15  Rafiq learns the person's normal
  • days 30–33  activity drops to ~30% of usual        → alert "less active"
  • days 44–46  a warm spell (+0.4 °C skin, nothing else) → at most a quiet "watch"
  • days 56–58  fever: warmer skin and a faster heart  → alert, one push
Rows have the exact fields band-ingest writes to `vitals`. JSON only; the
runner (scripts/rafiq/run.mjs) inserts it for the @salem.test elder.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import date, timedelta

from .synth import TZ, simulate, start_unix

STORY = [
    {'type': 'inactivity', 'real': True, 'start': 30, 'end': 33, 'params': {'factor': 0.3}},
    {'type': 'hot_spell', 'real': False, 'start': 44, 'end': 46, 'params': {'delta': 0.4}},
    {'type': 'fever', 'real': True, 'start': 56, 'end': 58, 'params': {'delta': 1.3}},
]
KIND_NAME = {1: 'heart_rate', 2: 'spo2', 3: 'skin_temperature', 4: 'steps', 5: 'movement'}


def build(today: date | None = None, seed: int = 4711) -> dict:
    today = today or date.today()
    first = today - timedelta(days=61)
    e = simulate(seed, n_days=62, start=start_unix(first.year, first.month, first.day), labels=STORY)
    now = int(time.time())
    r = e['rows']
    keep = r['t'] <= now
    return {
        'tz': TZ, 'first_day': first.isoformat(), 'story': STORY,
        'rows': {
            't': r['t'][keep].tolist(),
            'kind': [KIND_NAME[k] for k in r['kind'][keep].tolist()],
            'value': r['value'][keep].tolist(),
            'resting': [bool(x) for x in r['resting'][keep].tolist()],
            'quality': [None if q == 255 else int(q) for q in r['quality'][keep].tolist()],
        },
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    d = build()
    with open(a.out, 'w') as fh:
        json.dump(d, fh, separators=(',', ':'))
    print(f"{len(d['rows']['t'])} rows from {d['first_day']}")
