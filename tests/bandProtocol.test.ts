import { describe, expect, it } from 'vitest';
import {
  BandProtocolError,
  EventType,
  Flag,
  MeasureMask,
  QUALITY_NA,
  RecordType,
  VibratePattern,
  clockLabel,
  commands,
  decodeCommand,
  decodeEvent,
  decodeRecordsPacket,
  encodeEvent,
  encodeRecordsPacket,
  freshness,
  fromHex,
  packRecords,
  recordsPerPacket,
  scaledValue,
  toHex,
  validateEvent,
  validateRecord,
  type WireRecord,
} from '../supabase/functions/_shared/bandProtocol.ts';

// Every hex string below is copied from docs/BAND_PROTOCOL.md — if one of
// these fails, the doc and the code disagree and the firmware will too.
const T = 1791878400; // 0x6ACDE500 = 2026-10-13 08:00:00 UTC
const NOW = T + 60;

const MTU247_PACKET =
  '01 03 01 00 E5 CD 6A 48 00 5C 01 02 1E E5 CD 6A 61 00 58 01 03 3C E5 CD 6A 11 0D FF 00';
const MTU23_PACKET = '01 02 04 00 E5 CD 6A 78 00 FF 00 05 00 E5 CD 6A 0E 00 FF 00';
const HISTORY_PACKET = '01 01 01 E0 C8 CD 6A 46 00 5A 05';

const hr72: WireRecord = { type: RecordType.HeartRate, time: T, raw: 72, quality: 92, flags: Flag.Resting };
const spo97: WireRecord = { type: RecordType.SpO2, time: T + 30, raw: 97, quality: 88, flags: Flag.Resting };
const temp: WireRecord = { type: RecordType.SkinTemp, time: T + 60, raw: 3345, quality: QUALITY_NA, flags: 0 };

describe('MTU / records per packet', () => {
  it('MTU 247 → 26 records, MTU 23 → 2', () => {
    expect(recordsPerPacket(247)).toBe(26);
    expect(recordsPerPacket(23)).toBe(2);
  });
  it('is capped at 26 and never negative', () => {
    expect(recordsPerPacket(517)).toBe(26);
    expect(recordsPerPacket(5)).toBe(0);
  });
  it('a full MTU-23 packet is exactly 20 bytes, a full MTU-247 one fits in 244', () => {
    expect(encodeRecordsPacket([hr72, spo97]).length).toBe(20);
    expect(encodeRecordsPacket(Array(26).fill(hr72)).length).toBe(236);
  });
  it('packRecords splits by MTU', () => {
    const recs = Array(5).fill(hr72);
    expect(packRecords(recs, 23).map((p) => p.length)).toEqual([20, 20, 11]);
    expect(packRecords(recs, 247)).toHaveLength(1);
    expect(() => packRecords(recs, 10)).toThrow(BandProtocolError);
  });
});

describe('records packets (doc byte examples)', () => {
  it('encodes the MTU 247 example exactly', () => {
    expect(toHex(encodeRecordsPacket([hr72, spo97, temp]))).toBe(MTU247_PACKET);
  });
  it('decodes the MTU 247 example', () => {
    const d = decodeRecordsPacket(fromHex(MTU247_PACKET));
    expect(d.version).toBe(1);
    expect(d.endOfHistory).toBe(false);
    expect(d.records).toEqual([hr72, spo97, temp]);
    expect(scaledValue(d.records[2])).toBeCloseTo(33.45, 5);
  });
  it('round-trips the MTU 23 example', () => {
    const d = decodeRecordsPacket(fromHex(MTU23_PACKET));
    expect(d.records.map((r) => [r.type, r.raw, r.quality])).toEqual([
      [RecordType.Steps, 120, 255],
      [RecordType.Movement, 14, 255],
    ]);
    expect(toHex(encodeRecordsPacket(d.records))).toBe(MTU23_PACKET);
  });
  it('decodes the history example (06:00, resting + from history)', () => {
    const [r] = decodeRecordsPacket(fromHex(HISTORY_PACKET)).records;
    expect(r).toEqual({ type: 1, time: T - 7200, raw: 70, quality: 90, flags: Flag.Resting | Flag.FromHistory });
  });
  it('count 0 is the end-of-history marker', () => {
    const d = decodeRecordsPacket(fromHex('01 00'));
    expect(d.endOfHistory).toBe(true);
    expect(d.records).toEqual([]);
  });
  it('rejects a wrong version, a short packet and a length/count mismatch', () => {
    expect(() => decodeRecordsPacket(fromHex('02 00'))).toThrow(/version/);
    expect(() => decodeRecordsPacket(fromHex('01'))).toThrow(/short/);
    expect(() => decodeRecordsPacket(fromHex('01 02 01 00 E5 CD 6A 48 00 5C 01'))).toThrow(/count/);
  });
  it('handles a signed value and a Uint8Array that is a view into a larger buffer', () => {
    const neg = encodeRecordsPacket([{ ...temp, raw: -5 }]);
    const big = new Uint8Array(neg.length + 4);
    big.set(neg, 4);
    expect(decodeRecordsPacket(big.subarray(4)).records[0].raw).toBe(-5);
  });
});

describe('events (doc byte examples)', () => {
  const cases: [string, ReturnType<typeof decodeEvent>][] = [
    ['01 02 00 E5 CD 6A 18 01 00', { type: EventType.Fall, time: T, data: 280, flags: 0 }],
    ['01 07 0C E5 CD 6A 00 00 00', { type: EventType.FallCancelled, time: T + 12, data: 0, flags: 0 }],
    ['01 01 F0 D6 CD 6A 19 00 04', { type: EventType.Sos, time: T - 3600, data: 25, flags: Flag.FromHistory }],
    ['01 05 00 E5 CD 6A 0F 00 00', { type: EventType.LowBattery, time: T, data: 15, flags: 0 }],
  ];
  it.each(cases)('%s decodes and re-encodes', (hex, ev) => {
    expect(decodeEvent(fromHex(hex))).toEqual(ev);
    expect(toHex(encodeEvent(ev))).toBe(hex);
  });
  it('rejects a wrong length or version', () => {
    expect(() => decodeEvent(fromHex('01 02 00 E5 CD 6A 18 01'))).toThrow(/9 bytes/);
    expect(() => decodeEvent(fromHex('09 02 00 E5 CD 6A 18 01 00'))).toThrow(/version/);
  });
  it('validates type and reserved flags', () => {
    expect(validateEvent({ type: 0x09, time: T, data: 0, flags: 0 })).toEqual({ ok: false, reason: 'unknown_type' });
    expect(validateEvent({ type: 1, time: T, data: 0, flags: 0x10 })).toEqual({ ok: false, reason: 'reserved_flags' });
    expect(validateEvent({ type: 1, time: T, data: 25, flags: 4 })).toEqual({ ok: true });
  });
});

describe('commands (doc byte examples)', () => {
  it('encodes every command exactly', () => {
    expect(toHex(commands.setTime(T))).toBe('01 01 00 E5 CD 6A');
    expect(toHex(commands.vibrate(VibratePattern.Double, 1))).toBe('01 02 02 01');
    expect(toHex(commands.ackEvent(EventType.Fall, T))).toBe('01 03 02 00 E5 CD 6A');
    expect(toHex(commands.sendHistory(T - 48 * 3600))).toBe('01 04 00 42 CB 6A');
    expect(toHex(commands.setInterval(10))).toBe('01 05 0A');
    expect(toHex(commands.measureNow(MeasureMask.HeartRate | MeasureMask.SpO2))).toBe('01 06 03');
    expect(
      toHex(commands.setReminders([
        { minuteOfDay: 8 * 60, pattern: VibratePattern.Reminder },
        { minuteOfDay: 20 * 60 + 30, pattern: VibratePattern.Reminder },
      ])),
    ).toBe('01 07 02 E0 01 05 CE 04 05');
  });
  it('SET_REMINDERS with no entries clears the list', () => {
    expect(toHex(commands.setReminders([]))).toBe('01 07 00');
  });
  it('guards limits', () => {
    expect(() => commands.setInterval(4)).toThrow();
    expect(() => commands.setInterval(61)).toThrow();
    expect(() => commands.setReminders(Array(9).fill({ minuteOfDay: 0, pattern: 5 }))).toThrow();
  });
  it('decodeCommand splits opcode and payload (simulator side)', () => {
    const c = decodeCommand(commands.measureNow(3));
    expect(c.opcode).toBe(0x06);
    expect(Array.from(c.payload)).toEqual([3]);
    expect(() => decodeCommand(fromHex('02 06'))).toThrow(/version/);
  });
});

describe('validateRecord', () => {
  it('accepts the doc examples', () => {
    for (const r of [hr72, spo97, temp]) expect(validateRecord(r, NOW)).toEqual({ ok: true });
  });
  it.each([
    ['HR 24', { ...hr72, raw: 24 }, 'out_of_range'],
    ['HR 251', { ...hr72, raw: 251 }, 'out_of_range'],
    ['SpO2 101', { ...spo97, raw: 101 }, 'out_of_range'],
    ['SpO2 49', { ...spo97, raw: 49 }, 'out_of_range'],
    ['temp 19.99', { ...temp, raw: 1999 }, 'out_of_range'],
    ['temp 45.01', { ...temp, raw: 4501 }, 'out_of_range'],
    ['steps 3001', { ...temp, type: RecordType.Steps, raw: 3001 }, 'out_of_range'],
    ['movement -1', { ...temp, type: RecordType.Movement, raw: -1 }, 'out_of_range'],
    ['HR without quality', { ...hr72, quality: 255 }, 'bad_quality'],
    ['temp quality 150', { ...temp, quality: 150 }, 'bad_quality'],
    ['unknown type', { ...hr72, type: 0x09 }, 'unknown_type'],
    ['reserved flag', { ...hr72, flags: 0x08 }, 'reserved_flags'],
    ['clock-not-set flag', { ...hr72, flags: Flag.ClockNotSet }, 'clock_not_set'],
    ['time near 1970', { ...hr72, time: 600 }, 'clock_not_set'],
    ['two days ahead', { ...hr72, time: NOW + 2 * 86400 }, 'too_far_in_future'],
  ] as const)('rejects %s', (_label, rec, reason) => {
    expect(validateRecord(rec as WireRecord, NOW)).toEqual({ ok: false, reason });
  });
  it('accepts the range edges', () => {
    for (const raw of [25, 250]) expect(validateRecord({ ...hr72, raw }, NOW).ok).toBe(true);
    for (const raw of [2000, 4500]) expect(validateRecord({ ...temp, raw }, NOW).ok).toBe(true);
  });
  it('low quality is still a valid record (stored, then excluded later)', () => {
    expect(validateRecord({ ...hr72, quality: 10 }, NOW)).toEqual({ ok: true });
  });
});

describe('freshness — the 15-minute rule', () => {
  it('fresh within 15 minutes, old after', () => {
    expect(freshness(T, 0, T + 15 * 60)).toBe('fresh');
    expect(freshness(T, 0, T + 15 * 60 + 1)).toBe('old');
  });
  it('a time slightly ahead is clock drift; further ahead counts as future', () => {
    expect(freshness(T + 120, 0, T)).toBe('fresh');
    expect(freshness(T + 121, 0, T)).toBe('future');
  });
  it('an unset clock is never fresh', () => {
    expect(freshness(T, Flag.ClockNotSet, T)).toBe('clock_not_set');
    expect(freshness(1000, 0, T)).toBe('clock_not_set');
  });
  it('a replayed history record is judged by its time, not its flag', () => {
    expect(freshness(T, Flag.FromHistory, T + 60)).toBe('fresh');
  });
  it('respects the configured window', () => {
    expect(freshness(T, 0, T + 6 * 60, 5)).toBe('old');
  });
});

describe('clockLabel', () => {
  it('formats HH:MM in Cairo time', () => {
    // Egypt is on summer time (UTC+3) until the end of October.
    expect(clockLabel(T, 'Africa/Cairo')).toBe('11:00');
    expect(clockLabel(T, 'UTC')).toBe('08:00');
  });
});
