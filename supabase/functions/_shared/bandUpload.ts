// band-ingest's pure part: turn the phone's request body into the payload for
// band_ingest(), and turn band_ingest's reply into commands for the band.
// No Deno / network code here, so Vitest covers it (tests/bandUpload.test.ts).
import {
  BandProtocolError,
  EVENT_NAME,
  MAX_UPLOAD_EVENTS,
  MAX_UPLOAD_RECORDS,
  MeasureMask,
  RECORD_INFO,
  VibratePattern,
  commands,
  decodeEvent,
  decodeRecordsPacket,
  scaledValue,
  toHex,
  validateEvent,
  validateRecord,
  type WireEvent,
  type WireRecord,
} from './bandProtocol.ts';

export type IngestRecord = { kind: string; t: number; value: number; quality: number | null; resting: boolean };
export type IngestEvent = { kind: string; t: number; data: number; flags: number };
export type IngestPayload = {
  records: IngestRecord[];
  events: IngestEvent[];
  rejected: Record<string, number>;
  battery_pct?: number;
  firmware_version?: string;
};

export type Prepared =
  | { ok: true; serial: string; payload: IngestPayload }
  | { ok: false; status: number; error: string };

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function prepareUpload(body: Record<string, unknown>, nowSec: number): Prepared {
  const serial = typeof body.band_serial === 'string' ? body.band_serial.trim() : '';
  if (!/^[A-Za-z0-9-]{4,32}$/.test(serial)) return { ok: false, status: 400, error: 'bad_serial' };

  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };

  const wireRecords: WireRecord[] = [];
  const wireEvents: WireEvent[] = [];
  const packets = (body.packets ?? {}) as { records?: unknown; events?: unknown };

  for (const p of Array.isArray(packets.records) ? packets.records : []) {
    try {
      wireRecords.push(...decodeRecordsPacket(fromBase64(String(p))).records);
    } catch (e) {
      reject(e instanceof BandProtocolError ? 'bad_packet' : 'bad_base64');
    }
  }
  for (const p of Array.isArray(packets.events) ? packets.events : []) {
    try {
      wireEvents.push(decodeEvent(fromBase64(String(p))));
    } catch (e) {
      reject(e instanceof BandProtocolError ? 'bad_packet' : 'bad_base64');
    }
  }
  for (const r of Array.isArray(body.records) ? body.records : []) {
    const x = r as WireRecord;
    if ([x?.type, x?.time, x?.raw, x?.quality, x?.flags].every(isInt)) wireRecords.push(x);
    else reject('malformed');
  }
  for (const ev of Array.isArray(body.events) ? body.events : []) {
    const x = ev as WireEvent;
    if ([x?.type, x?.time, x?.data, x?.flags].every(isInt)) wireEvents.push(x);
    else reject('malformed');
  }

  if (wireRecords.length > MAX_UPLOAD_RECORDS || wireEvents.length > MAX_UPLOAD_EVENTS) {
    return { ok: false, status: 413, error: 'too_many_items' };
  }

  const records: IngestRecord[] = [];
  for (const r of wireRecords) {
    const v = validateRecord(r, nowSec);
    if (!v.ok) { reject(v.reason); continue; }
    records.push({
      kind: RECORD_INFO[r.type].kind,
      t: r.time,
      value: scaledValue(r),
      quality: r.quality <= 100 ? r.quality : null,
      resting: (r.flags & 0x01) !== 0,
    });
  }
  // Events are only checked for shape: an SOS / FALL with a wrong clock still
  // has to reach the server (it alerts as "time unknown").
  const events: IngestEvent[] = [];
  for (const e of wireEvents) {
    const v = validateEvent(e);
    if (!v.ok) { reject(v.reason); continue; }
    events.push({ kind: EVENT_NAME[e.type], t: e.time, data: e.data, flags: e.flags });
  }

  const b = body.battery_pct;
  return {
    ok: true,
    serial,
    payload: {
      records,
      events,
      rejected,
      battery_pct: isInt(b) && b >= 0 && b <= 100 ? b : undefined,
      firmware_version: typeof body.firmware_version === 'string' ? body.firmware_version.slice(0, 32) : undefined,
    },
  };
}

export type IngestResult = {
  needs_confirmation?: string[];
  alerts?: { kind: string; severity: string }[];
  ack_events?: { kind: string; t: number }[];
};

/** Commands the phone writes back to the band after an upload. */
export function replyCommands(result: IngestResult): { name: string; hex: string }[] {
  const out: { name: string; hex: string }[] = [];
  const typeOf = Object.fromEntries(Object.entries(EVENT_NAME).map(([k, v]) => [v, Number(k)]));
  for (const a of result.ack_events ?? []) {
    if (typeOf[a.kind]) out.push({ name: 'ACK_EVENT', hex: toHex(commands.ackEvent(typeOf[a.kind], a.t)) });
  }
  const need = result.needs_confirmation ?? [];
  if (need.length) {
    let mask = 0;
    if (need.includes('heart_rate')) mask |= MeasureMask.HeartRate;
    if (need.includes('spo2')) mask |= MeasureMask.SpO2;
    out.push({ name: 'MEASURE_NOW', hex: toHex(commands.measureNow(mask)) });
  }
  if ((result.alerts ?? []).some((a) => a.kind === 'sos' || a.kind === 'fall_detected')) {
    out.push({ name: 'VIBRATE', hex: toHex(commands.vibrate(VibratePattern.AlertSent, 1)) });
  }
  return out;
}
