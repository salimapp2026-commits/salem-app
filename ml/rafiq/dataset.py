"""Build per-elder, per-day features from synthetic elders (or, later, real exports).

Three disjoint sets of elders (different random seeds):
  train — fits the Isolation Forest (all days, events included: unsupervised,
          exactly as it will be trained on real data, where nobody labels days)
  val   — picks the model thresholds
  test  — held out; only used for the reported numbers
"""
from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor

from .core import day_aggregates, elder_features
from .synth import simulate

SEEDS = {'train': 1000, 'val': 5000, 'test': 9000}


def elder_record(seed: int, n_days: int = 120) -> dict:
    e = simulate(seed, n_days=n_days)
    agg = day_aggregates(e['rows'], e['events'], e['tz'])
    feats = elder_features(agg)
    labels = [{**l, 'start': l['start'] + e['day0'], 'end': l['end'] + e['day0']} for l in e['labels']]
    return {'seed': seed, 'day0': e['day0'], 'profile': e['profile'], 'labels': labels, 'feats': feats}


def build(split: str, n: int, n_days: int = 120, workers: int | None = None) -> list[dict]:
    seeds = [SEEDS[split] + i for i in range(n)]
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    with ProcessPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(elder_record, seeds, [n_days] * n, chunksize=4))
