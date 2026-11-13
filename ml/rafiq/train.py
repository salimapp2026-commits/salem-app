"""Train, evaluate and export Rafiq.

    cd ml && python3 -m rafiq.train            # synthetic data (default)
    cd ml && python3 -m rafiq.train --quick    # small run, for a smoke test

Writes:
  supabase/functions/_shared/rafiq/model.json   the model the edge function scores with
  ml/reports/rafiq-<version>.md / .json          evaluation on the held-out elders
  tests/fixtures/rafiq/parity-*.json.gz          inputs + every expected value, for the
                                                 Python ⇄ TypeScript parity tests

Retraining on real data later: replace dataset.build() with a loader that
returns the same per-elder records from a `vitals` + `band_events` export
(rows/events have the same fields), keep everything else. See ml/README.md.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import time
from datetime import date

import numpy as np

from .core import DECIDE, EWMA_ALPHA, FEATURES, PARAMS, day_aggregates, decide_elder, elder_features
from .dataset import build
from .evaluate import decide_all, evaluate, normal_day_paths
from .iforest import IsolationForest, fingerprint
from .synth import REAL, simulate, start_unix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODEL_PATH = os.path.join(ROOT, 'supabase', 'functions', '_shared', 'rafiq', 'model.json')
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures', 'rafiq')
REPORTS = os.path.join(ROOT, 'ml', 'reports')

VERSION = 'rafiq-v1'
ALERT_Q = 0.999     # model "alert": scores above 99.9% of ordinary validation days
WATCH_Q = 0.995     # model "watch": above 99.5%


def nn(x):
    """NaN → None for JSON (TypeScript turns null back into NaN)."""
    if isinstance(x, float) and x != x:
        return None
    return x


def export_model(model: IsolationForest, thresholds: dict, meta: dict) -> dict:
    forest = model.to_dict()
    out = {
        'version': VERSION,
        'trained_on': meta,
        'features': FEATURES,
        'params': PARAMS,
        'decide': DECIDE,
        'ewma_alpha': EWMA_ALPHA,
        'thresholds': thresholds,
        'forest': {
            'n_trees': forest['n_trees'], 'sample_size': forest['sample_size'], 'max_depth': forest['max_depth'],
            'c_table': forest['c_table'], 'c_norm': forest['c_norm'],
            'trees': [{'f': t['feature'], 't': t['threshold'], 'l': t['left'], 'r': t['right'], 's': t['size']}
                      for t in forest['trees']],
        },
    }
    out['fingerprint'] = fingerprint(out['forest']['trees'], out['forest']['c_table'], thresholds)
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    with open(MODEL_PATH, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    return out


def add_selftest(fixture_name: str, n: int = 3):
    """Three real feature vectors and their exact forest paths, from a parity fixture, so the
    deployed scorer can prove it scores exactly like Python before it runs."""
    with gzip.open(os.path.join(FIXTURES, f'parity-{fixture_name}.json.gz'), 'rt') as fh:
        exp = json.load(fh)['expected']
    pick = [exp[len(exp) // 2], exp[-3], exp[-1]][:n]
    with open(MODEL_PATH) as fh:
        out = json.load(fh)
    out['selftest'] = [{'vector': e['vector'], 'path': e['path']} for e in pick]
    with open(MODEL_PATH, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))


def parity_fixture(name: str, seed: int, n_days: int, start: int, model: IsolationForest, thresholds: dict,
                   n_real: int, n_decoys: int):
    e = simulate(seed, n_days=n_days, n_real=n_real, n_decoys=n_decoys, start=start)
    agg = day_aggregates(e['rows'], e['events'], e['tz'])
    feats = elder_features(agg)
    days = sorted(feats)
    X = np.array([feats[d]['vector'] for d in days])
    paths = {d: float(p) for d, p in zip(days, model.mean_path(X))}
    dec = decide_elder(feats, paths, thresholds)
    expected = []
    for d in days:
        F = feats[d]
        expected.append({
            'day': d,
            'agg': {k: nn(v) for k, v in F['agg'].items()},
            'z': {k: nn(v) for k, v in F['z'].items()},
            'base': F['base'],
            'features': {k: nn(v) for k, v in F['features'].items()},
            'vector': F['vector'],
            'learning': F['learning'],
            'path': paths[d],
            'level': dec[d]['level'],
            'reasons': [{'code': r['code'], 'level': r['level'], 'days': r['days'],
                         'params': {k: (nn(v) if not isinstance(v, list) else v) for k, v in r['params'].items()}}
                        for r in dec[d]['reasons']],
        })
    r = e['rows']
    fixture = {
        'name': name, 'seed': seed, 'tz': e['tz'], 'model_version': VERSION, 'labels': e['labels'],
        'rows': {'t': r['t'].tolist(), 'kind': r['kind'].tolist(), 'value': r['value'].tolist(),
                 'resting': [int(x) for x in r['resting'].tolist()], 'quality': r['quality'].tolist()},
        'events': {'t': e['events']['t'].tolist(), 'kind': e['events']['kind'].tolist()},
        'expected': expected,
    }
    os.makedirs(FIXTURES, exist_ok=True)
    with gzip.open(os.path.join(FIXTURES, f'parity-{name}.json.gz'), 'wt') as fh:
        json.dump(fixture, fh, separators=(',', ':'))
    return len(r['t']), len(days)


def pct(x):
    return '—' if x is None else f'{100 * x:.0f}%'


def write_report(results: dict, meta: dict, thresholds: dict):
    os.makedirs(REPORTS, exist_ok=True)
    with open(os.path.join(REPORTS, f'{VERSION}.json'), 'w') as fh:
        json.dump({'meta': meta, 'thresholds': thresholds, 'results': results}, fh, indent=1, default=str)
    names = {'hr_rise': 'Resting heart rate rising over days', 'spo2_night': 'Oxygen dips at night',
             'fever': 'Fever (warmer + faster heart)', 'inactivity': 'Sudden inactivity',
             'fall': 'Fall followed by stillness'}
    lines = [f'# Rafiq {VERSION} — evaluation on held-out synthetic elders', '',
             f"Trained {meta['date']} on {meta['train_elders']} synthetic elders; thresholds chosen on "
             f"{meta['val_elders']} others; numbers below are on {meta['test_elders']} elders never seen before "
             f"({results['combined']['scored_days']} scored days ≈ {results['combined']['elder_weeks']:.0f} elder-weeks).", '',
             '| Event | Events | Noticed (watch, in-app) | Pushed (alert/urgent) | Days to push (median) | Precision of its pushes | Model alone noticed |',
             '|---|---|---|---|---|---|---|']
    C = results['combined']
    MO = results['model_only']
    for t in REAL:
        p = C['per_type'][t]
        lines.append(f"| {names[t]} | {p['events']} | {pct(p['recall_watch'])} | {pct(p['recall_alert'])} | "
                     f"{'—' if p['median_days_alert'] is None else int(p['median_days_alert'])} | {pct(p['precision_alert'])} | "
                     f"{pct(MO['per_type'][t]['recall_watch'])} |")
    lines += ['', '| Overall | Rules + model | Rules only | Model only |', '|---|---|---|---|']
    R, M = results['rules_only'], results['model_only']
    rows = [('Precision of pushes', 'precision_alert', pct), ('Precision of in-app notices', 'precision_watch', pct),
            ('False pushes per elder per week', 'false_alerts_per_elder_week', lambda x: f'{x:.3f}'),
            ('False in-app notices per elder per week', 'false_watch_per_elder_week', lambda x: f'{x:.3f}'),
            ('Ordinary days with a push', 'false_alert_day_rate', lambda x: f'{100 * x:.2f}%')]
    for label, key, f in rows:
        lines.append(f'| {label} | {f(C[key])} | {f(R[key])} | {f(M[key])} |')
    lines += ['', '| Decoy (should stay quiet) | Count | Noticed (in-app) | Pushed |', '|---|---|---|---|']
    for k, v in sorted(C['decoys'].items()):
        lines.append(f"| {k} | {v['n']} | {v['watch']} | {v['alert']} |")
    with open(os.path.join(REPORTS, f'{VERSION}.md'), 'w') as fh:
        fh.write('\n'.join(lines) + '\n')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true')
    a = ap.parse_args(argv)
    sizes = {'train': 40, 'val': 20, 'test': 20} if a.quick else {'train': 300, 'val': 100, 'test': 150}
    t0 = time.time()
    data = {k: build(k, n) for k, n in sizes.items()}
    print(f'built {sizes} in {time.time() - t0:.0f}s', flush=True)

    X = np.array([f['vector'] for e in data['train'] for f in e['feats'].values() if not f['learning']])
    model = IsolationForest().fit(X)
    pv = normal_day_paths(data['val'], model)
    alert_path = float(np.quantile(pv, 1 - ALERT_Q))
    watch_path = float(np.quantile(pv, 1 - WATCH_Q))
    c = model.c_table[model.psi]
    thresholds = {'alert_path': alert_path, 'watch_path': watch_path,
                  'alert_score': 2.0 ** (-alert_path / c), 'watch_score': 2.0 ** (-watch_path / c),
                  'alert_quantile': ALERT_Q, 'watch_quantile': WATCH_Q}
    meta = {'date': date.today().isoformat(), 'synthetic': True, 'train_elders': sizes['train'],
            'val_elders': sizes['val'], 'test_elders': sizes['test'], 'train_days': int(X.shape[0]),
            'days_per_elder': 120, 'seed': model.seed}
    export_model(model, thresholds, meta)

    test = data['test']
    results = {
        'combined': evaluate(test, decide_all(test, model, thresholds)),
        'rules_only': evaluate(test, decide_all(test)),
        'model_only': evaluate(test, decide_all(test, model, thresholds, use_rules=False)),
    }
    write_report(results, meta, thresholds)
    a_ = parity_fixture('nov-2026', 9901, 75, start_unix(2026, 11, 1), model, thresholds, 2, 1)
    b_ = parity_fixture('dst-apr-2027', 9902, 60, start_unix(2027, 4, 1), model, thresholds, 1, 1)
    # a fall (band event) and a week of inactivity, for an elder who often takes the band off at night
    parity_fixture('fall-inactivity', 9997, 75, start_unix(2026, 11, 1), model, thresholds, 3, 1)
    add_selftest('nov-2026')
    from .split_for_deploy import split
    split()                      # small parts for the edge-function deploy
    print(f'model → {os.path.relpath(MODEL_PATH, ROOT)} ({os.path.getsize(MODEL_PATH) // 1024} KB); '
          f'fixtures {a_} {b_}; done in {time.time() - t0:.0f}s')
    print(open(os.path.join(REPORTS, f'{VERSION}.md')).read())


if __name__ == '__main__':
    sys.exit(main())
