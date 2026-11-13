"""How well Rafiq finds the injected events, and how often it cries wolf.

Unit of counting: an EPISODE = one reason (e.g. "resting heart rate up") active
on consecutive days. That is what a family experiences as one alert (Rafiq
pushes a reason once, then at most once a day later), not every day it stays on.

  correct episode  — overlaps a real event, or the 2 days after it
  false alarm      — anything else, including episodes caused by the decoys
                     (holiday, new exercise, one bad night, hot weather,
                     a fall the elder cancelled)

Per real event type:
  recall          — share of events Rafiq noticed (at watch, and at alert/urgent)
  days to notice  — from the first day of the event to the first day Rafiq spoke
  precision       — of the episodes whose reason points at that event type,
                    the share that were real
Overall:
  false alarms per elder per week — at "alert" (pushed) and "watch" (in-app)
  false-alarm day rate            — share of ordinary days with an alert
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from .core import FEATURES, LEVELS, decide_elder
from .synth import REAL

REASON_TYPE = {
    'resting_hr_up': 'hr_rise', 'spo2_night_down': 'spo2_night', 'spo2_low_hr_high': 'spo2_night',
    'temp_up': 'fever', 'activity_down': 'inactivity', 'inactive_awake': 'inactivity',
    'fall_then_still': 'fall', 'unusual_pattern': 'pattern',
}
GRACE_DAYS = 2


def lv(x: str) -> int:
    return LEVELS.index(x)


def decide_all(elders, model=None, thresholds=None, use_rules=True):
    out = []
    for e in elders:
        paths = None
        if model is not None:
            days = sorted(e['feats'])
            X = np.array([e['feats'][d]['vector'] for d in days])
            mp = model.mean_path(X)
            paths = {d: float(p) for d, p in zip(days, mp)}
        out.append(decide_elder(e['feats'], paths, thresholds, use_rules))
    return out


def episodes(dec: dict) -> list[dict]:
    """Contiguous runs of each reason code (a missing day doesn't split a run)."""
    eps = []
    open_: dict[str, dict] = {}
    for d in sorted(dec):
        present = {r['code']: r for r in dec[d]['reasons']}
        for code in list(open_):
            if code not in present:
                eps.append(open_.pop(code))
        for code, r in present.items():
            if code in open_:
                ep = open_[code]
                ep['end'] = d
                if lv(r['level']) > lv(ep['level']):
                    ep['level'] = r['level']
                if lv(r['level']) >= lv('alert') and ep['alert_day'] is None:
                    ep['alert_day'] = d
            else:
                open_[code] = {'code': code, 'start': d, 'end': d, 'level': r['level'],
                               'alert_day': d if lv(r['level']) >= lv('alert') else None}
    eps.extend(open_.values())
    return eps


def evaluate(elders, decisions) -> dict:
    stats = {t: {'n': 0, 'watch': 0, 'alert': 0, 'days_watch': [], 'days_alert': []} for t in REAL}
    decoy = defaultdict(lambda: {'n': 0, 'watch': 0, 'alert': 0})
    ep_tp = defaultdict(lambda: {'watch': 0, 'alert': 0})
    ep_fp = defaultdict(lambda: {'watch': 0, 'alert': 0})
    fp_alert = fp_watch = 0
    tp_alert = tp_watch = 0
    scored_days = 0
    ordinary_days = 0; ordinary_alert_days = 0

    for e, dec in zip(elders, decisions):
        real = [l for l in e['labels'] if l['real']]
        fake = [l for l in e['labels'] if not l['real']]
        days = sorted(dec)
        scored = [d for d in days if not dec[d]['learning']]
        scored_days += len(scored)

        def in_real(d):
            return any(l['start'] <= d <= l['end'] + GRACE_DAYS for l in real)

        for d in scored:
            if not in_real(d):
                ordinary_days += 1
                if lv(dec[d]['level']) >= lv('alert'):
                    ordinary_alert_days += 1

        # recall per real event
        for l in real:
            s = stats[l['type']]; s['n'] += 1
            window = [d for d in days if l['start'] <= d <= l['end'] + 1]
            w = [d for d in window if lv(dec[d]['level']) >= lv('watch')]
            a = [d for d in window if lv(dec[d]['level']) >= lv('alert')]
            if w:
                s['watch'] += 1; s['days_watch'].append(w[0] - l['start'] + 1)
            if a:
                s['alert'] += 1; s['days_alert'].append(a[0] - l['start'] + 1)
        for l in fake:
            dd = decoy[l['type']]; dd['n'] += 1
            window = [d for d in days if l['start'] <= d <= l['end'] + 1]
            if any(lv(dec[d]['level']) >= lv('watch') for d in window):
                dd['watch'] += 1
            if any(lv(dec[d]['level']) >= lv('alert') for d in window):
                dd['alert'] += 1

        for ep in episodes(dec):
            match = [l for l in real if ep['start'] <= l['end'] + GRACE_DAYS and ep['end'] >= l['start']]
            kind = REASON_TYPE[ep['code']]
            is_alert = ep['alert_day'] is not None
            if match:
                tp_watch += 1; ep_tp[kind]['watch'] += 1
                if is_alert:
                    tp_alert += 1; ep_tp[kind]['alert'] += 1
            else:
                fp_watch += 1; ep_fp[kind]['watch'] += 1
                if is_alert:
                    fp_alert += 1; ep_fp[kind]['alert'] += 1

    weeks = scored_days / 7
    per_type = {}
    for t in REAL:
        s = stats[t]
        tp, fp = ep_tp[t]['alert'], ep_fp[t]['alert']
        per_type[t] = {
            'events': s['n'],
            'recall_watch': s['watch'] / s['n'] if s['n'] else None,
            'recall_alert': s['alert'] / s['n'] if s['n'] else None,
            'median_days_watch': float(np.median(s['days_watch'])) if s['days_watch'] else None,
            'median_days_alert': float(np.median(s['days_alert'])) if s['days_alert'] else None,
            'precision_alert': tp / (tp + fp) if tp + fp else None,
        }
    return {
        'elders': len(elders), 'scored_days': scored_days, 'elder_weeks': weeks,
        'per_type': per_type,
        'decoys': {k: dict(v) for k, v in decoy.items()},
        'precision_alert': tp_alert / (tp_alert + fp_alert) if tp_alert + fp_alert else None,
        'precision_watch': tp_watch / (tp_watch + fp_watch) if tp_watch + fp_watch else None,
        'false_alerts_per_elder_week': fp_alert / weeks if weeks else None,
        'false_watch_per_elder_week': fp_watch / weeks if weeks else None,
        'false_alert_day_rate': ordinary_alert_days / ordinary_days if ordinary_days else None,
        'false_by_reason': {k: dict(v) for k, v in ep_fp.items()},
    }


def normal_day_paths(elders, model) -> np.ndarray:
    """Mean path lengths on ordinary scored days (no real event near): for choosing thresholds."""
    out = []
    for e in elders:
        real = [l for l in e['labels'] if l['real']]
        days = [d for d in sorted(e['feats']) if not e['feats'][d]['learning']
                and not any(l['start'] - 1 <= d <= l['end'] + 3 for l in real)]
        if days:
            out.append(model.mean_path(np.array([e['feats'][d]['vector'] for d in days])))
    return np.concatenate(out)


__all__ = ['decide_all', 'episodes', 'evaluate', 'normal_day_paths', 'FEATURES']
