"""Synthetic Salem Band data: realistic elders, with labelled events.

Output has exactly the shape of the real data, so the same code later trains on
a real export:
  rows   = what band-ingest writes to `vitals` (source 'band'): every 10-minute
           block the band is worn → skin_temperature, steps, movement; a ~30 s
           heart-rate + SpO2 measurement only when the wearer is still
           (resting = true), with a quality 0–100. Nothing while off the wrist.
  events = `band_events` (FALL, FALL_CANCELLED).
  labels = injected events: what happened, which Rafiq days.

Every elder has their own normal: age 65–95, resting heart rate, oxygen,
wrist temperature, activity, sleep times, nap habit, charging time, how often
they forget the band or take it off at night, sensor dropouts, low-quality
readings, day-to-day drift and a slow seasonal temperature change.

Real events (Rafiq should notice):   hr_rise, spo2_night, fever, inactivity, fall
Decoys (Rafiq should stay quiet):    holiday, exercise, bad_night, hot_spell, false_fall
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from .core import EVENT, KIND, rafiq_day_of

TZ = 'Africa/Cairo'
BLOCKS = 144                      # 10-minute blocks per day
DAY0 = 42                         # 07:00 is block 42: the start of a Rafiq day

REAL = ['hr_rise', 'spo2_night', 'fever', 'inactivity', 'fall']
DECOYS = ['holiday', 'exercise', 'bad_night', 'hot_spell', 'false_fall']


def start_unix(year=2026, month=11, day=1, tz=TZ) -> int:
    return int(datetime(year, month, day, tzinfo=ZoneInfo(tz)).timestamp())


def make_profile(rng) -> dict:
    age = int(rng.integers(65, 96))
    return {
        'age': age,
        'hr_base': float(np.clip(rng.normal(68, 7), 52, 88)),
        'hr_night_drop': float(rng.uniform(4, 9)),
        'spo2_base': float(np.clip(rng.normal(96.6 - (age - 65) * 0.04, 1.0), 92.5, 98.5)),
        'apnea': bool(rng.random() < 0.15),                 # some normal nights with short dips
        'temp_base': float(rng.normal(33.0, 0.6)),
        'temp_night_rise': float(rng.uniform(0.5, 1.2)),
        'steps_day': float(np.clip(np.exp(rng.normal(np.log(4200), 0.5)), 800, 11000)),
        'bed_h': float(np.clip(rng.normal(22.5, 0.7), 20.5, 24.5)),
        'wake_h': float(np.clip(rng.normal(6.4, 0.6), 4.5, 8.5)),
        'naps': bool(rng.random() < 0.4),
        'charge_h': float(rng.uniform(8, 20)),
        'charge_len_blocks': int(rng.integers(3, 10)),
        'p_forget_day': float(rng.uniform(0, 0.05)),
        'off_at_night': bool(rng.random() < 0.15),          # takes it off at night on many nights
        'p_dropout': float(rng.uniform(0.005, 0.03)),
        'p_lowq': float(rng.uniform(0.03, 0.1)),
        'p_sit': float(rng.uniform(0.35, 0.6)),
        'season_phase': float(rng.uniform(0, 2 * np.pi)),
    }


def plan_events(rng, n_days: int, n_real: int, n_decoys: int, first: int = 40) -> list[dict]:
    """Non-overlapping events in Rafiq days [first, n_days-6), at least 5 days apart."""
    kinds = list(rng.choice(REAL, size=n_real, replace=True)) + list(rng.choice(DECOYS, size=n_decoys, replace=True))
    rng.shuffle(kinds)
    events = []
    cursor = first + int(rng.integers(0, 8))
    for k in kinds:
        k = str(k)
        if k == 'hr_rise':
            ramp = int(rng.integers(4, 11)); length = ramp + 3
            params = {'ramp': ramp, 'delta': float(rng.uniform(8, 18))}
        elif k == 'spo2_night':
            length = int(rng.integers(3, 7)); params = {'drop': float(rng.uniform(3, 6))}
        elif k == 'fever':
            length = int(rng.integers(2, 6)); params = {'delta': float(rng.uniform(0.8, 1.8))}
        elif k == 'inactivity':
            length = int(rng.integers(2, 8)); params = {'factor': float(rng.uniform(0.1, 0.4))}
        elif k in ('fall', 'false_fall'):
            length = 1; params = {'hour': float(rng.uniform(9, 19)), 'still_min': int(rng.integers(20, 91))}
        elif k == 'holiday':
            length = int(rng.integers(5, 11)); params = {'factor': float(rng.uniform(0.55, 0.72))}
        elif k == 'exercise':
            length = int(rng.integers(7, 15)); params = {'factor': float(rng.uniform(1.4, 1.8))}
        elif k == 'bad_night':
            length = 1; params = {}
        else:  # hot_spell
            length = int(rng.integers(2, 5)); params = {'delta': float(rng.uniform(0.3, 0.5))}
        if cursor + length >= n_days - 6:
            break
        events.append({'type': k, 'real': k in REAL, 'start': cursor, 'end': cursor + length - 1, 'params': params})
        cursor += length + int(rng.integers(5, 15))
    return events


def simulate(seed: int, n_days: int = 120, n_real: int | None = None, n_decoys: int | None = None,
             start: int | None = None, labels: list[dict] | None = None) -> dict:
    """One elder. Returns {'profile', 'rows', 'events', 'labels', 'tz', 'start', 'day0'} (day0 = first Rafiq day)."""
    rng = np.random.default_rng(seed)
    p = make_profile(rng)
    if n_real is None:
        n_real = int(rng.choice([0, 1, 1, 2, 2, 3]))
    if n_decoys is None:
        n_decoys = int(rng.choice([0, 1, 1, 2]))
    planned = plan_events(rng, n_days, n_real, n_decoys)
    labels = planned if labels is None else labels      # a scripted story (demo) replaces the random one
    t0 = start_unix() if start is None else start

    nb = n_days * BLOCKS
    b = np.arange(nb)
    hour = (b % BLOCKS) / 6.0                       # local hour at block start
    cal_day = b // BLOCKS                            # local calendar day
    rday = (b - DAY0) // BLOCKS                      # Rafiq day (block 0..41 belong to day -1)

    # ---------------------------------------------------- sleep, naps, wear
    bed = p['bed_h'] + rng.normal(0, 0.4, n_days + 1)
    wake = p['wake_h'] + rng.normal(0, 0.35, n_days + 1)
    # asleep: from bed time of day d until wake time of day d+1
    asleep = np.zeros(nb, bool)
    for d in range(n_days):
        s = int(round(d * BLOCKS + bed[d] * 6)); e = int(round((d + 1) * BLOCKS + wake[d + 1] * 6))
        asleep[max(s, 0):min(e, nb)] = True
    asleep[: int(round(wake[0] * 6))] = True
    napping = np.zeros(nb, bool)
    if p['naps']:
        for d in range(n_days):
            if rng.random() < 0.7:
                s = int(d * BLOCKS + rng.uniform(13.2, 14.2) * 6); napping[s:s + int(rng.integers(5, 12))] = True

    worn = np.ones(nb, bool)
    for d in range(n_days):
        cs = int(d * BLOCKS + (p['charge_h'] + rng.normal(0, 0.5)) * 6)
        worn[cs:cs + p['charge_len_blocks']] = False                       # daily charging
        if rng.random() < p['p_forget_day']:
            worn[d * BLOCKS + 48: d * BLOCKS + 132] = False                # forgot it 08:00-22:00
        if p['off_at_night'] and rng.random() < 0.6:
            s = int(round(d * BLOCKS + bed[d] * 6)); e = int(round((d + 1) * BLOCKS + wake[d + 1] * 6))
            worn[s:min(e, nb)] = False
    recorded = worn & (rng.random(nb) >= p['p_dropout'])                    # sensor dropouts

    # ---------------------------------------------------- day-level drift
    def ar1(sd, phi=0.7):
        x = np.zeros(n_days + 2); e = rng.normal(0, sd, n_days + 2)
        for i in range(1, n_days + 2):
            x[i] = phi * x[i - 1] + e[i]
        return x
    hr_off = ar1(1.2); temp_off = ar1(0.08)
    season = 0.25 * np.sin(2 * np.pi * np.arange(n_days + 2) / 90 + p['season_phase'])
    steps_factor = np.exp(rng.normal(0, 0.25, n_days + 2)) * np.where((np.arange(n_days + 2) % 7) == 4, 0.85, 1.0)
    rd_i = np.clip(rday, 0, n_days + 1)

    # ---------------------------------------------------- event effects (per block)
    hr_add = np.zeros(nb); spo2_add = np.zeros(nb); spo2_extra_sd = np.zeros(nb)
    temp_add = np.zeros(nb); steps_mul = np.ones(nb); still_force = np.zeros(nb, bool)
    ev_t: list[int] = []; ev_k: list[int] = []
    for ev in labels:
        k = ev['type']; s0, s1 = ev['start'], ev['end']; P_ = ev['params']
        in_ev = (rday >= s0) & (rday <= s1)
        if k == 'hr_rise':
            frac = np.clip((rday - s0 + 1) / P_['ramp'], 0, 1)
            hr_add += np.where(in_ev, frac * P_['delta'], 0)
        elif k == 'spo2_night':
            m = in_ev & asleep
            spo2_add -= np.where(m, P_['drop'], 0); spo2_extra_sd += np.where(m, 1.2, 0)
        elif k == 'fever':
            temp_add += np.where(in_ev, P_['delta'], 0); hr_add += np.where(in_ev, 8 * P_['delta'], 0)
            steps_mul *= np.where(in_ev, 0.6, 1.0)
        elif k == 'inactivity':
            steps_mul *= np.where(in_ev, P_['factor'], 1.0)
        elif k in ('holiday', 'exercise'):
            steps_mul *= np.where(in_ev, P_['factor'], 1.0)
        elif k == 'bad_night':
            m = in_ev & asleep
            hr_add += np.where(m, 6, 0); spo2_add -= np.where(m, 1.5, 0)
        elif k == 'hot_spell':
            temp_add += np.where(in_ev, P_['delta'], 0)
        elif k in ('fall', 'false_fall'):
            fb = (s0 * BLOCKS + DAY0) + int((P_['hour'] - 7) * 6)
            # the fall happens while awake, with the band on
            worn[fb:fb + 12] = True; recorded[fb:fb + 12] = True; asleep[fb:fb + 12] = False; napping[fb:fb + 12] = False
            tf = t0 + fb * 600 + int(rng.integers(30, 570))
            ev_t.append(tf); ev_k.append(EVENT['fall'])
            if k == 'false_fall':
                ev_t.append(tf + int(rng.integers(5, 25))); ev_k.append(EVENT['fall_cancelled'])
            else:
                n_still = int(np.ceil(P_['still_min'] / 10))
                still_force[fb + 1: fb + 1 + n_still] = True
                worn[fb + 1: fb + 1 + n_still] = True; recorded[fb + 1: fb + 1 + n_still] = True
                end_day = (s0 + 1) * BLOCKS + DAY0
                steps_mul[fb + 1 + n_still:end_day] *= 0.5

    # ---------------------------------------------------- activity
    awake = ~asleep & ~napping
    prof = (1 + 0.6 * np.exp(-((hour - 10) / 2) ** 2) + 0.5 * np.exp(-((hour - 17) / 2) ** 2))
    awake_blocks_per_day = 96.0
    rate = p['steps_day'] / awake_blocks_per_day * prof / 1.35 * steps_factor[rd_i] * steps_mul
    moving = awake & (rng.random(nb) >= p['p_sit'])
    lam = np.where(moving, rate / (1 - p['p_sit']), 0.0)
    steps = np.minimum(rng.poisson(np.maximum(lam, 0)), 3000).astype(float)
    move = np.where(awake, np.where(steps > 0, steps * 0.05 + rng.poisson(5, nb), rng.poisson(2.5, nb)),
                    rng.poisson(1.1, nb) + (rng.random(nb) < 0.08) * rng.poisson(6, nb)).astype(float)
    steps[still_force] = 0; move[still_force] = rng.integers(0, 2, still_force.sum())
    move = np.minimum(move, 10000)

    resting = (move <= 5) & (steps <= 10)

    # ---------------------------------------------------- vitals
    lowq = rng.random(nb) < p['p_lowq']
    quality = np.where(lowq, rng.integers(20, 60, nb), np.clip(rng.normal(86, 8, nb), 60, 100).round()).astype(int)
    noise_mul = np.where(lowq, 4.0, 1.0)
    hr = (p['hr_base'] + hr_off[rd_i] - np.where(asleep, p['hr_night_drop'], 0) + hr_add
          + rng.normal(0, 2.0, nb) * noise_mul)
    spo2 = (p['spo2_base'] - np.where(asleep, 0.7, 0) + spo2_add + rng.normal(0, 0.7, nb) * noise_mul
            + rng.normal(0, 1, nb) * spo2_extra_sd - np.where(lowq, 2.0, 0))
    if p['apnea']:
        dips = asleep & (rng.random(nb) < 0.06)
        spo2 = spo2 - np.where(dips, rng.uniform(3, 7, nb), 0)
    temp = (p['temp_base'] + np.where(asleep | napping, p['temp_night_rise'], 0) + season[rd_i] + temp_off[rd_i]
            + temp_add + rng.normal(0, 0.1, nb))

    measured = recorded & resting & (rng.random(nb) < 0.92)

    # ---------------------------------------------------- rows (sorted by time)
    t_block = t0 + b * 600
    parts = []
    def add(mask, kind, vals, res, q, offset):
        idx = np.where(mask)[0]
        parts.append((t_block[idx] + offset, np.full(len(idx), kind), vals[idx], res[idx], q[idx]))
    ones = np.ones(nb, bool); q255 = np.full(nb, 255)
    add(measured, KIND['heart_rate'], np.clip(np.round(hr), 25, 250), ones, quality, 300)
    add(measured, KIND['spo2'], np.clip(np.round(spo2), 50, 100), ones, quality, 330)
    add(recorded, KIND['skin_temperature'], np.round(np.clip(temp, 20, 45), 2), resting, q255, 580)
    add(recorded, KIND['steps'], steps, resting, q255, 585)
    add(recorded, KIND['movement'], move, resting, q255, 590)
    t = np.concatenate([x[0] for x in parts]); order = np.argsort(t, kind='stable')
    rows = {
        't': t[order].astype(np.int64),
        'kind': np.concatenate([x[1] for x in parts])[order].astype(np.int64),
        'value': np.concatenate([x[2] for x in parts])[order].astype(np.float64),
        'resting': np.concatenate([x[3] for x in parts])[order].astype(bool),
        'quality': np.concatenate([x[4] for x in parts])[order].astype(np.int64),
    }
    eo = np.argsort(np.array(ev_t, dtype=np.int64), kind='stable') if ev_t else np.zeros(0, int)
    events = {'t': np.array(ev_t, dtype=np.int64)[eo] if ev_t else np.zeros(0, np.int64),
              'kind': np.array(ev_k, dtype=np.int64)[eo] if ev_t else np.zeros(0, np.int64)}
    first_rday = rafiq_day_of(t0 + DAY0 * 600, TZ)
    return {'profile': p, 'rows': rows, 'events': events, 'labels': labels, 'tz': TZ, 'start': t0, 'day0': first_rday}
