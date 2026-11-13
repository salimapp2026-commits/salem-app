import { describe, expect, it } from 'vitest';
import {
  EventType,
  Flag,
  QUALITY_NA,
  RecordType,
  encodeEvent,
  fromHex,
  packRecords,
  type WireRecord,
} from '../supabase/functions/_shared/bandProtocol.ts';
import { prepareUpload, replyCommands } from '../supabase/functions/_shared/bandUpload.ts';

const T = 1791878400; // 2026-10-13 08:00:00 UTC
const NOW = T + 60;
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const MTU247_PACKET =
  '01 03 01 00 E5 CD 6A 48 00 5C 01 02 1E E5 CD 6A 61 00 58 01 03 3C E5 CD 6A 11 0D FF 00';

describe('prepareUpload — what band-ingest sends to band_ingest()', () => {
  it('decodes the doc packet from base64 and scales values', () => {
    const p = prepareUpload({ band_serial: 'SB-0001', packets: { records: [b64(fromHex(MTU247_PACKET))] } }, NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.payload.records).toEqual([
      { kind: 'heart_rate', t: T, value: 72, quality: 92, resting: true },
      { kind: 'spo2', t: T + 30, value: 97, quality: 88, resting: true },
      { kind: 'skin_temperature', t: T + 60, value: 33.45, quality: null, resting: false },
    ]);
    expect(p.payload.rejected).toEqual({});
  });

  it('a 30-hour history sync at MTU 23 survives packing, base64 and decoding', () => {
    const recs: WireRecord[] = [];
    for (let i = 0; i < 180; i++) {
      recs.push({ type: RecordType.Steps, time: T - i * 600, raw: 50, quality: QUALITY_NA, flags: Flag.FromHistory });
    }
    const packets = packRecords(recs, 23);
    expect(packets).toHaveLength(90);
    const p = prepareUpload({ band_serial: 'SB-0001', packets: { records: packets.map(b64) } }, NOW);
    expect(p.ok && p.payload.records.length).toBe(180);
  });

  it('drops impossible readings and counts each reason', () => {
    const p = prepareUpload({
      band_serial: 'SB-0001',
      records: [
        { type: 1, time: T, raw: 300, quality: 90, flags: 1 },   // HR 300
        { type: 2, time: T, raw: 97, quality: 255, flags: 1 },   // SpO2 without quality
        { type: 1, time: 600, raw: 70, quality: 90, flags: 0 },  // clock never set
        { type: 9, time: T, raw: 1, quality: 1, flags: 0 },      // unknown type
        { type: 1, time: T, raw: 70 },                           // missing fields
        { type: 1, time: T, raw: 70, quality: 90, flags: 1 },    // fine
      ],
      packets: { records: ['AQ==', '!!not base64!!'] },          // 1 byte: too short; bad base64
    }, NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.payload.records).toHaveLength(1);
    expect(p.payload.rejected).toEqual({
      out_of_range: 1, bad_quality: 1, clock_not_set: 1, unknown_type: 1, malformed: 1, bad_packet: 1, bad_base64: 1,
    });
  });

  it('keeps an SOS whose clock was never set (it must still alert)', () => {
    const sos = encodeEvent({ type: EventType.Sos, time: 600, data: 25, flags: Flag.ClockNotSet });
    const p = prepareUpload({ band_serial: 'SB-0001', packets: { events: [b64(sos)] } }, NOW);
    expect(p.ok && p.payload.events).toEqual([{ kind: 'sos', t: 600, data: 25, flags: 2 }]);
  });

  it('rejects a bad serial and oversized uploads', () => {
    expect(prepareUpload({ band_serial: 'x' }, NOW)).toEqual({ ok: false, status: 400, error: 'bad_serial' });
    expect(prepareUpload({ band_serial: "SB'; drop" }, NOW)).toMatchObject({ ok: false, error: 'bad_serial' });
    const many = Array(2001).fill({ type: 4, time: T, raw: 1, quality: 255, flags: 0 });
    expect(prepareUpload({ band_serial: 'SB-0001', records: many }, NOW)).toMatchObject({ ok: false, status: 413 });
  });

  it('battery and firmware are optional and bounded', () => {
    const p = prepareUpload({ band_serial: 'SB-0001', battery_pct: 140, firmware_version: 'x'.repeat(50) }, NOW);
    expect(p.ok && p.payload.battery_pct).toBeUndefined();
    expect(p.ok && p.payload.firmware_version).toHaveLength(32);
  });
});

describe('replyCommands — what the phone writes back to the band', () => {
  it('ACK_EVENT for each stored event, VIBRATE after an SOS', () => {
    expect(replyCommands({
      ack_events: [{ kind: 'fall', t: T }],
      alerts: [{ kind: 'fall_detected', severity: 'critical' }],
    })).toEqual([
      { name: 'ACK_EVENT', hex: '01 03 02 00 E5 CD 6A' },
      { name: 'VIBRATE', hex: '01 02 04 01' },
    ]);
  });
  it('MEASURE_NOW with the right mask when a critical needs confirming', () => {
    expect(replyCommands({ needs_confirmation: ['heart_rate'] })).toEqual([{ name: 'MEASURE_NOW', hex: '01 06 01' }]);
    expect(replyCommands({ needs_confirmation: ['heart_rate', 'spo2'] })).toEqual([{ name: 'MEASURE_NOW', hex: '01 06 03' }]);
  });
  it('nothing to do → no commands; no vibrate for info alerts', () => {
    expect(replyCommands({})).toEqual([]);
    expect(replyCommands({ alerts: [{ kind: 'low_battery', severity: 'info' }] })).toEqual([]);
  });
});
