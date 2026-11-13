"""Rafiq Python tests (standard library unittest; numpy is the only dependency).

    cd ml && python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import gzip
import json
import math
import os
import unittest

import numpy as np

from rafiq import core
from rafiq.core import (EVENT, KIND, PARAMS, baseline, day_aggregates, decide_elder, elder_features, median,
                        rafiq_day_of, theil_sen, zscore)
from rafiq.iforest import IsolationForest
from rafiq.synth import simulate, start_unix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NaN = float('nan')


def rows_of(items):
    """items: (t, kind_name, value, resting, quality)."""
    items = sorted(items, key=lambda x: x[0])
    return {
        't': np.array([x[0] for x in items], dtype=np.int64),
        'kind': np.array([KIND[x[1]] for x in items], dtype=np.int64),
        'value': np.array([x[2] for x in items], dtype=np.float64),
        'resting': np.array([x[3] for x in items], dtype=bool),
        'quality': np.array([x[4] for x in items], dtype=np.int64),
    }


NO_EVENTS = {'t': np.zeros(0, np.int64), 'kind': np.zeros(0, np.int64)}


class Maths(unittest.TestCase):
    def test_median(self):
        self.assertEqual(median([3, 1, 2]), 2)
        self.assertEqual(median([4, 1, 3, 2]), 2.5)
        self.assertTrue(math.isnan(median([])))

    def test_theil_sen_ignores_one_outlier(self):
        xs = [0.0, 1.0, 2.0, 3.0, 4.0]
        ys = [0.0, 1.0, 2.0, 30.0, 4.0]       # one wild value; the slope is still ~1
        self.assertAlmostEqual(theil_sen(xs, ys), 1.0)

    def test_baseline_median_mad_and_floor(self):
        # 28 baseline days of resting HR 60..62, days d-34..d-7
        d = 100
        series = {x: {'hr_night': 60.0 + (x % 3)} for x in range(d - 34, d - 6)}
        med, sd = baseline(series, 'hr_night', d)
        self.assertEqual(med, 61.0)
        # MAD = 1 → 1.4826, above the 2.0 floor? No: floor wins
        self.assertEqual(sd, PARAMS['floor_hr_night'])
        series[d] = {'hr_night': 71.0}
        self.assertEqual(zscore(series, 'hr_night', d, (med, sd)), 5.0)

    def test_baseline_needs_seven_days(self):
        series = {x: {'hr_night': 60.0} for x in range(60, 66)}   # 6 days only
        self.assertIsNone(baseline(series, 'hr_night', 72))

    def test_relative_metric_uses_ratios(self):
        d = 100
        series = {x: {'steps': 400.0 if x % 2 else 600.0} for x in range(d - 34, d - 6)}
        med, sd = baseline(series, 'steps', d)
        self.assertEqual(med, 500.0)
        self.assertAlmostEqual(sd, 1.4826 * 0.2)      # ratios 0.8 / 1.2 → MAD 0.2
        series[d] = {'steps': 200.0}
        self.assertAlmostEqual(zscore(series, 'steps', d, (med, sd)), (0.4 - 1) / (1.4826 * 0.2))


class Day(unittest.TestCase):
    TZ = 'Africa/Cairo'

    def test_rafiq_day_runs_07_to_07_local(self):
        t0 = start_unix(2026, 11, 10)                  # 00:00 Cairo (UTC+2)
        self.assertEqual(rafiq_day_of(t0 + 6 * 3600 + 3599, self.TZ), rafiq_day_of(t0 - 1, self.TZ))
        self.assertEqual(rafiq_day_of(t0 + 7 * 3600, self.TZ), rafiq_day_of(t0 - 1, self.TZ) + 1)

    def test_dst_switch_keeps_local_hours(self):
        # Egypt moves to UTC+3 on 2027-04-30 at 00:00. 07:00 local the next morning is 04:00 UTC.
        t = int(np.datetime64('2027-04-30T04:00:00').astype('datetime64[s]').astype(int))
        self.assertEqual(core.utc_offset_seconds(t, self.TZ), 3 * 3600)
        self.assertEqual(rafiq_day_of(t, self.TZ), rafiq_day_of(t - 1, self.TZ) + 1)

    def test_aggregates_split_night_and_day_and_drop_bad_readings(self):
        t0 = start_unix(2026, 11, 10)
        r = []
        for i, hr in enumerate([70, 71, 72, 73]):                     # daytime 10:00
            r.append((t0 + 10 * 3600 + i * 600 + 300, 'heart_rate', hr, True, 90))
        for i, hr in enumerate([60, 61, 62]):                         # night 23:00
            r.append((t0 + 23 * 3600 + i * 600 + 300, 'heart_rate', hr, True, 90))
        r.append((t0 + 23 * 3600 + 3 * 600 + 300, 'heart_rate', 140, True, 30))    # low quality: ignored
        r.append((t0 + 11 * 3600 + 300, 'heart_rate', 120, False, 95))            # not resting: ignored
        agg = day_aggregates(rows_of(r), NO_EVENTS, self.TZ)
        (d, a), = agg.items()
        self.assertEqual(a['hr_day'], 71.5)
        self.assertEqual(a['hr_night'], 61.0)

    def test_stillness_after_a_fall(self):
        t0 = start_unix(2026, 11, 10) + 10 * 3600                    # 10:00 local, block aligned
        r = []
        for i in range(12):                                            # 2 h worn
            still = 1 <= i <= 4                                        # 4 still blocks after the fall
            r += [(t0 + i * 600 + 580, 'skin_temperature', 33.0, True, 255),
                  (t0 + i * 600 + 585, 'steps', 0 if still else 50, True, 255),
                  (t0 + i * 600 + 590, 'movement', 1 if still else 20, True, 255)]
        ev = {'t': np.array([t0 + 200], dtype=np.int64), 'kind': np.array([EVENT['fall']])}
        (d, a), = day_aggregates(rows_of(r), ev, self.TZ).items()
        self.assertEqual(a['falls'], 1)
        self.assertEqual(a['fall_still_min'], 40)
        cancelled = {'t': np.array([t0 + 200, t0 + 215], dtype=np.int64),
                     'kind': np.array([EVENT['fall'], EVENT['fall_cancelled']])}
        (d, a), = day_aggregates(rows_of(r), cancelled, self.TZ).items()
        self.assertEqual(a['falls'], 0)


class Synthetic(unittest.TestCase):
    def setUp(self):
        self.e = simulate(4242, n_days=50, n_real=1, n_decoys=1)

    def test_rows_look_like_band_data(self):
        r = self.e['rows']
        self.assertTrue(np.all(np.diff(r['t']) >= 0))
        hr = r['kind'] == KIND['heart_rate']
        self.assertTrue(np.all(r['resting'][hr]))                    # HR only when still
        self.assertTrue(np.all((r['value'][hr] >= 25) & (r['value'][hr] <= 250)))
        sp = r['kind'] == KIND['spo2']
        self.assertTrue(np.all((r['value'][sp] >= 50) & (r['value'][sp] <= 100)))
        self.assertTrue(np.all(r['quality'][r['kind'] == KIND['steps']] == 255))

    def test_deterministic(self):
        again = simulate(4242, n_days=50, n_real=1, n_decoys=1)
        self.assertTrue(np.array_equal(self.e['rows']['value'], again['rows']['value']))


class Forest(unittest.TestCase):
    def test_outliers_have_shorter_paths(self):
        rng = np.random.default_rng(0)
        X = rng.normal(0, 1, (2000, 5))
        m = IsolationForest(n_trees=50, sample_size=128, seed=1).fit(X)
        p_in = m.mean_path(rng.normal(0, 1, (200, 5))).mean()
        p_out = m.mean_path(np.full((1, 5), 6.0))[0]
        self.assertLess(p_out, p_in - 2)
        self.assertGreater(m.score(np.full((1, 5), 6.0))[0], 0.6)

    def test_same_seed_same_forest(self):
        X = np.random.default_rng(3).normal(0, 1, (500, 4))
        a = IsolationForest(n_trees=10, seed=7).fit(X).to_dict()
        b = IsolationForest(n_trees=10, seed=7).fit(X).to_dict()
        self.assertEqual(a['trees'], b['trees'])


class Decide(unittest.TestCase):
    def _feats(self, hr_values):
        """A person with a steady resting HR of 60, then `hr_values` on the last days."""
        series = {}
        for d in range(60):
            series[d] = {'hr_night': 60.0 + (d % 2), 'hr_day': NaN, 'spo2_night': NaN, 'spo2_low': NaN,
                         'temp_night': NaN, 'temp_day': NaN, 'steps': NaN, 'move_night': NaN, 'wear': 22.0,
                         'still_awake_h': 0.5, 'falls': 0, 'fall_still_min': 0}
        for i, v in enumerate(hr_values):
            series[60 + i] = dict(series[59], hr_night=v)
        return elder_features(series)

    def test_one_high_night_says_nothing(self):
        dec = decide_elder(self._feats([70.0]), None, None)
        self.assertEqual(dec[60]['level'], 'normal')

    def test_three_high_nights_alert_with_the_change_in_bpm(self):
        dec = decide_elder(self._feats([68.0, 68.0, 68.0]), None, None)
        self.assertEqual([dec[60 + i]['level'] for i in range(3)], ['normal', 'watch', 'alert'])
        r = dec[62]['reasons'][0]
        self.assertEqual(r['code'], 'resting_hr_up')
        self.assertEqual(r['days'], 3)
        self.assertAlmostEqual(r['params']['delta'], 7.5)

    def test_small_change_for_a_very_steady_person_is_ignored(self):
        dec = decide_elder(self._feats([64.5, 64.5, 64.5, 64.5]), None, None)   # z ≥ 2 but only +4 bpm
        self.assertEqual(dec[63]['level'], 'normal')

    def test_learning_says_nothing(self):
        series = {d: {'hr_night': 60.0, 'hr_day': NaN, 'spo2_night': NaN, 'spo2_low': NaN, 'temp_night': NaN,
                      'temp_day': NaN, 'steps': NaN, 'move_night': NaN, 'wear': 22.0, 'still_awake_h': 7.0,
                      'falls': 0, 'fall_still_min': 0} for d in range(10)}
        dec = decide_elder(elder_features(series), None, None)
        self.assertTrue(all(v['learning'] and v['level'] == 'normal' for v in dec.values()))


class Fixtures(unittest.TestCase):
    """The parity fixtures still match this code (if not: retrain with python3 -m rafiq.train)."""

    def test_fixtures_reproduce(self):
        with open(os.path.join(ROOT, 'supabase', 'functions', '_shared', 'rafiq', 'model.json')) as fh:
            model_json = json.load(fh)
        forest = IsolationForest.from_dict({
            'n_trees': model_json['forest']['n_trees'], 'sample_size': model_json['forest']['sample_size'],
            'seed': 0, 'max_depth': model_json['forest']['max_depth'], 'n_features': len(model_json['features']),
            'c_table': model_json['forest']['c_table'],
            'trees': [{'feature': t['f'], 'threshold': t['t'], 'left': t['l'], 'right': t['r'], 'size': t['s']}
                      for t in model_json['forest']['trees']]})
        for name in ('nov-2026', 'dst-apr-2027', 'fall-inactivity'):
            f = json.load(gzip.open(os.path.join(ROOT, 'tests', 'fixtures', 'rafiq', f'parity-{name}.json.gz'), 'rt'))
            rows = {k: np.array(v) for k, v in f['rows'].items()}
            rows['resting'] = rows['resting'].astype(bool)
            ev = {k: np.array(v, dtype=np.int64) for k, v in f['events'].items()}
            feats = elder_features(day_aggregates(rows, ev, f['tz']))
            for exp in f['expected']:
                got = feats[exp['day']]
                self.assertEqual(got['vector'], exp['vector'], name)
                self.assertEqual(float(forest.mean_path(np.array([got['vector']]))[0]), exp['path'], name)


if __name__ == '__main__':
    unittest.main()


class ModelFile(unittest.TestCase):
    def test_fingerprint_matches_the_trees(self):
        from rafiq.iforest import fingerprint
        with open(os.path.join(ROOT, 'supabase', 'functions', '_shared', 'rafiq', 'model.json')) as fh:
            m = json.load(fh)
        self.assertEqual(fingerprint(m['forest']['trees'], m['forest']['c_table'], m['thresholds']), m['fingerprint'])
        self.assertEqual(len(m['selftest']), 3)
