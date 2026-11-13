"""Rafiq core: daily aggregates (Layer A), personal baselines, features and the
Layer C decision. Pure functions, numpy only.

This file has an exact twin in TypeScript (supabase/functions/_shared/rafiq/),
and the parity tests demand BIT-IDENTICAL results. So every number here is made
with + - * / , sorting and comparisons only — no log/exp/pow, whose last bit
can differ between Python and JavaScript — and every sum or mean is taken in
the same order on both sides. Constants that need a transcendental function
(the EWMA weight) are computed once at export and shipped in the model JSON.

A "Rafiq day" D runs from 07:00 local on D to 07:00 local on D+1: the daytime
of D plus the night that follows it. The 07:00 Cairo daily run therefore
scores yesterday together with the night that just ended.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

# ---------------------------------------------------------------- constants
KIND = {'heart_rate': 1, 'spo2': 2, 'skin_temperature': 3, 'steps': 4, 'movement': 5}
EVENT = {'sos': 1, 'fall': 2, 'off_wrist': 3, 'on_wrist': 4, 'low_battery': 5, 'charging': 6, 'fall_cancelled': 7}

PARAMS = {
    'day_start_hour': 7,           # Rafiq day = 07:00 → 07:00 local
    'night_start_hour': 22,        # night segment 22:00 → 07:00
    'morning_end_hour': 12,
    'afternoon_end_hour': 18,
    'min_quality': 60,             # band HR / SpO2 below this are ignored (= band_quality_min)
    'min_readings_segment': 3,     # resting HR / SpO2 readings needed in a segment
    'min_temp_blocks': 6,          # skin-temperature readings needed in a segment
    'min_wear_hours_steps': 4,     # worn daytime hours needed for an activity rate
    'min_night_blocks_move': 18,   # worn night blocks (3 h) for night movement
    'baseline_days': 28,           # baseline = 28 days …
    'recent_days': 7,              # … ending 7 days before the scored day (as Trend Watch)
    'baseline_min_days': 7,
    'learning_min_days': 14,       # days worn ≥ min_wear_hours_day before Rafiq speaks
    'min_wear_hours_day': 8,
    'ewma_days': 14,               # EWMA over the last 14 days, half-life 3 days
    'slope_short_days': 7, 'slope_short_min': 4,
    'slope_long_days': 30, 'slope_long_min': 10,
    'z_clip': 8.0,
    'still_steps_max': 0, 'still_movement_max': 2,
    'fall_cancel_seconds': 60,
    'fall_still_cap_blocks': 24,   # 4 h
    'mad_scale': 1.4826,
    # robust-SD floors: a person with a very steady baseline isn't flagged for tiny wiggles
    'floor_hr_night': 2.0, 'floor_hr_day': 2.0, 'floor_spo2_night': 0.7, 'floor_spo2_low': 1.0,
    'floor_temp_night': 0.25, 'floor_temp_day': 0.25,
    'floor_steps': 0.10, 'floor_move_night': 0.15,   # activity: relative to the person's median
    'floor_wear': 1.0,
}
EWMA_ALPHA = 1.0 - 2.0 ** (-1.0 / 3.0)   # half-life 3 days; shipped as a number to TypeScript

# Absolute metrics (z = (x - median) / sd) and relative ones (ratio to the median).
METRICS = ['hr_night', 'hr_day', 'spo2_night', 'spo2_low', 'temp_night', 'temp_day', 'steps', 'move_night', 'wear']
RELATIVE = {'steps', 'move_night'}

FEATURES = [
    'z_hr_night', 'z_hr_day', 'z_spo2_night', 'z_spo2_low', 'z_temp_night', 'z_temp_day',
    'z_steps', 'z_move_night', 'z_wear', 'still_awake_h', 'fall_still_h',
    'slope7_hr_night', 'slope30_hr_night', 'slope7_spo2_night', 'slope7_temp_night', 'slope7_steps',
    'ewma_hr_night', 'ewma_temp_night', 'hr_temp_joint', 'missing_frac',
]

NAN = float('nan')


def isnan(x: float) -> bool:
    return x != x


# ---------------------------------------------------------------- small exact helpers
def median_sorted(s: list[float]) -> float:
    n = len(s)
    if n == 0:
        return NAN
    m = n // 2
    return s[m] if n % 2 == 1 else (s[m - 1] + s[m]) / 2


def median(vals) -> float:
    return median_sorted(sorted(float(v) for v in vals))


def theil_sen(xs: list[float], ys: list[float]) -> float:
    """Median of all pairwise slopes, pairs in (i < j) order."""
    slopes = []
    n = len(xs)
    for i in range(n):
        for j in range(i + 1, n):
            slopes.append((ys[j] - ys[i]) / (xs[j] - xs[i]))
    return median(slopes)


def clip(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


# ---------------------------------------------------------------- local time
_OFFSETS: dict[tuple[str, int], int] = {}


def utc_offset_seconds(t: int, tz: str) -> int:
    """UTC offset of `tz` at unix time t (cached per UTC hour; offsets change on hour boundaries)."""
    h = t // 3600
    key = (tz, h)
    off = _OFFSETS.get(key)
    if off is None:
        off = int(datetime.fromtimestamp(h * 3600, timezone.utc).astimezone(ZoneInfo(tz)).utcoffset().total_seconds())
        _OFFSETS[key] = off
    return off


def offsets_for(ts: np.ndarray, tz: str) -> np.ndarray:
    hours = ts // 3600
    uniq, inv = np.unique(hours, return_inverse=True)
    offs = np.array([utc_offset_seconds(int(h) * 3600, tz) for h in uniq], dtype=np.int64)
    return offs[inv]


def rafiq_day_of(t: int, tz: str) -> int:
    """Days since 1970-01-01 (local) of the Rafiq day containing t."""
    return (t + utc_offset_seconds(t, tz) - PARAMS['day_start_hour'] * 3600) // 86400


# ---------------------------------------------------------------- Layer A: one day
def day_aggregates(rows: dict, events: dict, tz: str) -> dict[int, dict]:
    """rows: dict of numpy arrays t, kind, value, resting(bool), quality(int, 255 = n/a), sorted by t.
    events: dict of arrays t, kind. Returns {rafiq_day: {metric: value or NaN, extras}}."""
    P = PARAMS
    t = rows['t'].astype(np.int64)
    if len(t) == 0:
        return {}
    off = offsets_for(t, tz)
    local = t + off
    hour = (local // 3600) % 24
    day = (local - P['day_start_hour'] * 3600) // 86400
    night = (hour >= P['night_start_hour']) | (hour < P['day_start_hour'])
    block = t // 600
    kind = rows['kind']
    value = rows['value'].astype(np.float64)
    resting = rows['resting'].astype(bool)
    q = rows['quality'].astype(np.int64)

    ev_t = events['t'].astype(np.int64) if len(events['t']) else np.zeros(0, np.int64)
    ev_k = events['kind'] if len(events['t']) else np.zeros(0, np.int64)
    ev_day = np.array([rafiq_day_of(int(x), tz) for x in ev_t], dtype=np.int64)

    out: dict[int, dict] = {}
    days = np.unique(day)
    starts = np.searchsorted(day, days, side='left')
    ends = np.searchsorted(day, days, side='right')
    for d, a, b in zip(days.tolist(), starts.tolist(), ends.tolist()):
        k = kind[a:b]; v = value[a:b]; r = resting[a:b]; qq = q[a:b]; n_ = night[a:b]; bl = block[a:b]
        good = r & (qq >= P['min_quality']) & (qq != 255)

        def seg_median(mask, minimum):
            vals = v[mask]
            return median(vals.tolist()) if len(vals) >= minimum else NAN

        hr = (k == 1) & good
        sp = (k == 2) & good
        tm = (k == 3) & ((qq == 255) | (qq >= P['min_quality']))
        hr_night = seg_median(hr & n_, P['min_readings_segment'])
        hr_day = seg_median(hr & ~n_, P['min_readings_segment'])
        spo2_night = seg_median(sp & n_, P['min_readings_segment'])
        spn = sorted(v[sp & n_].tolist())
        spo2_low = spn[int(0.1 * (len(spn) - 1))] if len(spn) >= P['min_readings_segment'] else NAN
        temp_night = seg_median(tm & n_, P['min_temp_blocks'])
        temp_day = seg_median(tm & ~n_, P['min_temp_blocks'])

        # Worn blocks: any skin-temperature / steps / movement record (nothing is recorded off the wrist).
        worn_mask = (k == 3) | (k == 4) | (k == 5)
        worn_blocks = np.unique(bl[worn_mask])
        worn_day_blocks = np.unique(bl[worn_mask & ~n_])
        worn_night_blocks = np.unique(bl[worn_mask & n_])
        wear = len(worn_blocks) / 6

        st_mask = (k == 4) & ~n_
        steps_sum = 0.0
        for x in v[st_mask].tolist():
            steps_sum += x
        day_hours = len(worn_day_blocks) / 6
        steps = steps_sum / day_hours if day_hours >= P['min_wear_hours_steps'] else NAN

        mv_night = v[(k == 5) & n_].tolist()
        move_night = NAN
        if len(worn_night_blocks) >= P['min_night_blocks_move'] and mv_night:
            acc = 0.0
            for x in mv_night:
                acc += x
            move_night = acc / len(mv_night)

        # Per-block steps / movement (daytime and all) for stillness runs.
        step_of = dict(zip(bl[k == 4].tolist(), v[k == 4].tolist()))
        move_of = dict(zip(bl[k == 5].tolist(), v[k == 5].tolist()))

        def still(b_):
            s_ = step_of.get(b_); m_ = move_of.get(b_)
            return s_ is not None and m_ is not None and s_ <= P['still_steps_max'] and m_ <= P['still_movement_max']

        longest = 0; run = 0; prev = None
        for b_ in worn_day_blocks.tolist():
            if still(b_) and prev is not None and b_ == prev + 1 and run > 0:
                run += 1
            elif still(b_):
                run = 1
            else:
                run = 0
            longest = max(longest, run)
            prev = b_
        still_awake_h = longest / 6

        # Falls: not cancelled within 60 s; stillness right after, while worn.
        falls = 0; fall_still = 0
        if len(ev_t):
            idx = np.where(ev_day == d)[0]
            fall_times = [int(ev_t[i]) for i in idx if ev_k[i] == EVENT['fall']]
            cancels = [int(ev_t[i]) for i in np.where(ev_k == EVENT['fall_cancelled'])[0]]
            worn_set = set(worn_blocks.tolist())
            for ft in fall_times:
                if any(ft <= c <= ft + P['fall_cancel_seconds'] for c in cancels):
                    continue
                falls += 1
                n_still = 0
                b_ = ft // 600 + 1
                while n_still < P['fall_still_cap_blocks'] and b_ in worn_set and still(b_):
                    n_still += 1; b_ += 1
                fall_still = max(fall_still, n_still)

        out[int(d)] = {
            'hr_night': hr_night, 'hr_day': hr_day, 'spo2_night': spo2_night, 'spo2_low': spo2_low,
            'temp_night': temp_night, 'temp_day': temp_day, 'steps': steps, 'move_night': move_night,
            'wear': wear, 'still_awake_h': still_awake_h, 'falls': falls, 'fall_still_min': fall_still * 10,
        }
    return out


# ---------------------------------------------------------------- baselines + features
def _floor(metric: str, med: float) -> float:
    f = PARAMS['floor_' + metric]
    return f  # relative metrics are already ratios, so their floor is relative too


def baseline(series: dict[int, dict], metric: str, d: int) -> tuple[float, float] | None:
    """(median, robust_sd) from days [d-34, d-7], or None. Relative metrics: ratios to the median."""
    P = PARAMS
    lo = d - P['recent_days'] - P['baseline_days'] + 1
    hi = d - P['recent_days']
    vals = [series[x][metric] for x in range(lo, hi + 1) if x in series and not isnan(series[x][metric])]
    if len(vals) < P['baseline_min_days']:
        return None
    med = median(vals)
    if metric in RELATIVE:
        if med <= 0:
            return None
        ratios = [x / med for x in vals]
        mad = median([abs(x - 1.0) for x in ratios])
    else:
        mad = median([abs(x - med) for x in vals])
    sd = P['mad_scale'] * mad
    fl = _floor(metric, med)
    return med, (sd if sd > fl else fl)


def zscore(series, metric, d, base) -> float:
    if base is None or d not in series:
        return NAN
    x = series[d][metric]
    if isnan(x):
        return NAN
    med, sd = base
    z = ((x / med) - 1.0) / sd if metric in RELATIVE else (x - med) / sd
    return clip(z, -PARAMS['z_clip'], PARAMS['z_clip'])


def learning(series, d) -> bool:
    P = PARAMS
    worn_days = sum(1 for x in range(d - P['recent_days'] - P['baseline_days'] + 1, d)
                    if x in series and series[x]['wear'] >= P['min_wear_hours_day'])
    return worn_days < P['learning_min_days']


def slope(zs: dict[int, float], d: int, days: int, minimum: int) -> float:
    xs = []; ys = []
    for x in range(d - days + 1, d + 1):
        z = zs.get(x, NAN)
        if not isnan(z):
            xs.append(float(x)); ys.append(z)
    return theil_sen(xs, ys) if len(xs) >= minimum else NAN


def ewma(zs: dict[int, float], d: int, alpha: float) -> float:
    e = NAN
    for x in range(d - PARAMS['ewma_days'] + 1, d + 1):
        z = zs.get(x, NAN)
        if isnan(z):
            continue
        e = z if isnan(e) else e + alpha * (z - e)
    return e


def elder_features(series: dict[int, dict], alpha: float = EWMA_ALPHA) -> dict[int, dict]:
    """For every day in `series`: z-scores, slopes, EWMAs, the feature vector and context."""
    days = sorted(series)
    if not days:
        return {}
    zs: dict[str, dict[int, float]] = {m: {} for m in METRICS}
    bases: dict[int, dict] = {}
    for d in days:
        bases[d] = {}
        for m in METRICS:
            b = baseline(series, m, d)
            bases[d][m] = b
            zs[m][d] = zscore(series, m, d, b)
    out = {}
    for d in days:
        s = series[d]
        z = {m: zs[m][d] for m in METRICS}
        f = {
            'z_hr_night': z['hr_night'], 'z_hr_day': z['hr_day'],
            'z_spo2_night': z['spo2_night'], 'z_spo2_low': z['spo2_low'],
            'z_temp_night': z['temp_night'], 'z_temp_day': z['temp_day'],
            'z_steps': z['steps'], 'z_move_night': z['move_night'], 'z_wear': z['wear'],
            'still_awake_h': s['still_awake_h'], 'fall_still_h': s['fall_still_min'] / 60,
            'slope7_hr_night': slope(zs['hr_night'], d, PARAMS['slope_short_days'], PARAMS['slope_short_min']),
            'slope30_hr_night': slope(zs['hr_night'], d, PARAMS['slope_long_days'], PARAMS['slope_long_min']),
            'slope7_spo2_night': slope(zs['spo2_night'], d, PARAMS['slope_short_days'], PARAMS['slope_short_min']),
            'slope7_temp_night': slope(zs['temp_night'], d, PARAMS['slope_short_days'], PARAMS['slope_short_min']),
            'slope7_steps': slope(zs['steps'], d, PARAMS['slope_short_days'], PARAMS['slope_short_min']),
            'ewma_hr_night': ewma(zs['hr_night'], d, alpha),
            'ewma_temp_night': ewma(zs['temp_night'], d, alpha),
        }
        zh = z['hr_night'] if not isnan(z['hr_night']) else z['hr_day']
        zt = z['temp_night'] if not isnan(z['temp_night']) else z['temp_day']
        f['hr_temp_joint'] = 0.0 if isnan(zh) or isnan(zt) else (0.0 if min(zh, zt) < 0 else min(zh, zt))
        f['missing_frac'] = 1.0 - (s['wear'] / 24 if s['wear'] < 24 else 1.0)
        vec = [0.0 if isnan(f[name]) else f[name] for name in FEATURES]   # missing → neutral
        out[d] = {
            'features': f, 'vector': vec, 'z': z, 'learning': learning(series, d),
            'base': {m: (None if bases[d][m] is None else [bases[d][m][0], bases[d][m][1]]) for m in METRICS},
            'agg': s,
        }
    return out


# ---------------------------------------------------------------- Layer C: decide
LEVELS = ['normal', 'watch', 'alert', 'urgent']

# A reason fires only when a change is unusual FOR THIS PERSON (robust z beyond
# watch_z) AND big enough to matter in absolute terms (the minimum deltas, as
# Trend Watch does). Temperature alone never goes past "watch": a wrist warms
# with the weather; with a higher heart rate as well it is an alert.
DECIDE = {
    'watch_z': 2.0, 'alert_z': 3.0,
    'hr_min_delta': 5.0, 'hr_strong_delta': 8.0,           # bpm above their usual
    'spo2_min_drop': 2.0, 'spo2_strong_drop': 3.0,         # points below their usual (night median)
    'spo2_low_min_drop': 3.0,                              # points, the night's low readings
    'temp_min_delta': 0.4,                                 # °C above their usual
    'activity_watch_ratio': 0.60,                          # share of their usual steps …
    'activity_alert_ratio': 0.45, 'activity_alert_days': 3,     # … pushed at ≤ 45% for 3 days
    'activity_deep_ratio': 0.35,                                # … or ≤ 35% for 2 days
    'watch_min_days': 2, 'alert_min_days': 3,
    'urgent_night_spo2_median': 90.0, 'urgent_night_hr_rise_bpm': 15.0,
    'urgent_inactive_awake_hours': 6.0, 'fall_still_minutes': 20.0,
}
RULE_CODES = ['resting_hr_up', 'spo2_night_down', 'temp_up', 'activity_down']


def _pick(a: float, b: float) -> float:
    return b if isnan(a) else a


def rule_signals(F: dict) -> dict[str, dict | None]:
    """Today's evidence per rule: None = no data today; else {'on', 'strong', 'params'}."""
    C = DECIDE
    agg, base, z = F['agg'], F['base'], F['z']
    out: dict[str, dict | None] = {}

    # resting heart rate (night, else daytime resting)
    m = 'hr_night' if not isnan(z['hr_night']) else 'hr_day'
    if isnan(z[m]) or base[m] is None:
        out['resting_hr_up'] = None
    else:
        delta = agg[m] - base[m][0]
        on = z[m] >= C['watch_z'] and delta >= C['hr_min_delta']
        out['resting_hr_up'] = {'on': on, 'strong': on and z[m] >= C['alert_z'] and delta >= C['hr_strong_delta'],
                                'params': {'delta': delta, 'usual': base[m][0], 'value': agg[m], 'z': z[m], 'part': m}}

    # oxygen at night: the night's median, or its low readings
    have_med = not isnan(z['spo2_night']) and base['spo2_night'] is not None
    have_low = not isnan(z['spo2_low']) and base['spo2_low'] is not None
    if not have_med and not have_low:
        out['spo2_night_down'] = None
    else:
        drop = base['spo2_night'][0] - agg['spo2_night'] if have_med else NAN
        low_drop = base['spo2_low'][0] - agg['spo2_low'] if have_low else NAN
        on_med = have_med and z['spo2_night'] <= -C['watch_z'] and drop >= C['spo2_min_drop']
        on_low = have_low and z['spo2_low'] <= -C['watch_z'] and low_drop >= C['spo2_low_min_drop']
        on = on_med or on_low
        out['spo2_night_down'] = {'on': on, 'strong': on_med and drop >= C['spo2_strong_drop'],
                                  'params': {'drop': drop, 'low_drop': low_drop,
                                             'usual': base['spo2_night'][0] if have_med else NAN,
                                             'value': agg['spo2_night']}}

    # skin temperature (night, else daytime)
    m = 'temp_night' if not isnan(z['temp_night']) else 'temp_day'
    if isnan(z[m]) or base[m] is None:
        out['temp_up'] = None
    else:
        delta = agg[m] - base[m][0]
        on = z[m] >= C['watch_z'] and delta >= C['temp_min_delta']
        out['temp_up'] = {'on': on, 'strong': False, 'params': {'delta': delta, 'usual': base[m][0], 'value': agg[m]}}

    # activity: share of their usual steps per worn daytime hour
    if isnan(agg['steps']) or base['steps'] is None:
        out['activity_down'] = None
    else:
        ratio = agg['steps'] / base['steps'][0]
        on = ratio <= C['activity_watch_ratio']
        out['activity_down'] = {'on': on, 'strong': ratio <= C['activity_alert_ratio'],
                                'deep': ratio <= C['activity_deep_ratio'],
                                'params': {'ratio': ratio, 'usual': base['steps'][0], 'value': agg['steps']}}
    return out


def decide_elder(feats: dict[int, dict], model_paths: dict[int, float] | None, thresholds: dict | None,
                 use_rules: bool = True) -> dict[int, dict]:
    """Day-by-day Rafiq verdicts. model_paths: average isolation path length per day (lower = more
    unusual); thresholds: {'watch_path', 'alert_path'} (score thresholds converted to path lengths).
    Returns {day: {'level', 'learning', 'reasons': [{code, level, days, params}]}}."""
    C = DECIDE
    runs = {code: 0 for code in RULE_CODES}
    act_runs = {'strong': 0, 'deep': 0}
    model_runs = {'watch': 0, 'alert': 0}
    out = {}
    for d in sorted(feats):
        F = feats[d]
        sig = rule_signals(F)
        reasons = []
        for code in (RULE_CODES if use_rules else []):
            s_ = sig[code]
            if s_ is None:
                continue          # no data today: the run carries over, nothing is said about today
            runs[code] = runs[code] + 1 if s_['on'] else 0
            if code == 'activity_down':
                act_runs['strong'] = act_runs['strong'] + 1 if s_['strong'] else 0
                act_runs['deep'] = act_runs['deep'] + 1 if s_['deep'] else 0
            if not s_['on']:
                continue
            r = runs[code]
            level = None
            if code == 'temp_up':
                hr = sig['resting_hr_up']
                if hr is not None and hr['on']:
                    level = 'alert'                    # warmer AND a higher resting heart rate
                elif r >= C['watch_min_days']:
                    level = 'watch'                    # warmer alone: never pushed
            elif code == 'activity_down':
                if act_runs['deep'] >= C['watch_min_days'] or act_runs['strong'] >= C['activity_alert_days']:
                    level = 'alert'
                elif r >= C['watch_min_days']:
                    level = 'watch'
            else:
                if r >= C['alert_min_days'] or (r >= C['watch_min_days'] and s_['strong']):
                    level = 'alert'
                elif r >= C['watch_min_days']:
                    level = 'watch'
            if level:
                reasons.append({'code': code, 'level': level, 'days': r, 'params': dict(s_['params'])})

        agg = F['agg']
        base = F['base']
        if use_rules:
            if not isnan(agg['spo2_night']) and agg['spo2_night'] <= C['urgent_night_spo2_median'] \
                    and base['hr_night'] is not None and not isnan(agg['hr_night']) \
                    and agg['hr_night'] - base['hr_night'][0] >= C['urgent_night_hr_rise_bpm']:
                reasons.append({'code': 'spo2_low_hr_high', 'level': 'urgent', 'days': 1,
                                'params': {'spo2': agg['spo2_night'], 'hr_rise': agg['hr_night'] - base['hr_night'][0]}})
            if agg['still_awake_h'] >= C['urgent_inactive_awake_hours']:
                reasons.append({'code': 'inactive_awake', 'level': 'urgent', 'days': 1,
                                'params': {'hours': agg['still_awake_h']}})
            if agg['falls'] > 0 and agg['fall_still_min'] >= C['fall_still_minutes']:
                reasons.append({'code': 'fall_then_still', 'level': 'alert', 'days': 1,
                                'params': {'minutes': agg['fall_still_min']}})

        # The model confirms a rule (watch → alert) or speaks alone about an unusual mix.
        if model_paths is not None and d in model_paths and thresholds is not None:
            p = model_paths[d]
            hit_alert = p <= thresholds['alert_path']
            hit_watch = p <= thresholds['watch_path']
            model_runs['alert'] = model_runs['alert'] + 1 if hit_alert else 0
            model_runs['watch'] = model_runs['watch'] + 1 if hit_watch else 0
            if hit_alert:
                for r_ in reasons:
                    if r_['level'] == 'watch' and r_['code'] != 'temp_up':
                        r_['level'] = 'alert'
                        r_['params']['model'] = 1
            if not reasons:
                level = None
                if model_runs['alert'] >= 2:
                    level = 'alert'
                elif hit_alert or model_runs['watch'] >= 2:
                    level = 'watch'
                if level:
                    top = sorted(((abs(F['vector'][i]), FEATURES[i]) for i in range(9)), reverse=True)[:2]
                    reasons.append({'code': 'unusual_pattern', 'level': level, 'days': max(1, model_runs['watch']),
                                    'params': {'top': [name for _, name in top]}})

        if F['learning']:
            reasons = []          # still learning this person's normal: say nothing
        level = 'normal'
        for r_ in reasons:
            if LEVELS.index(r_['level']) > LEVELS.index(level):
                level = r_['level']
        out[d] = {'level': level, 'learning': F['learning'], 'reasons': reasons}
    return out


def c_factor(n: int) -> float:
    """Average path length of an unsuccessful BST search (Isolation Forest normaliser). Python-only."""
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2.0 * (math.log(n - 1) + 0.5772156649015329) - 2.0 * (n - 1) / n
