// Salem Band protocol v1 — encoder, decoder and validation.
//
// The single implementation of docs/BAND_PROTOCOL.md. Pure TypeScript (only
// DataView / Uint8Array), so the phone app, the Node simulator, the Deno edge
// function (band-ingest) and the Vitest suite all run exactly this code.
//
// All multi-byte numbers are little-endian. Times are Unix seconds (UTC).

export const PROTOCOL_VERSION = 1;

export const BAND_UUIDS = {
  service: '0a2e0001-a812-4654-9c7b-9ddaccf1dbd4',
  records: '0a2e0002-a812-4654-9c7b-9ddaccf1dbd4',
  events: '0a2e0003-a812-4654-9c7b-9ddaccf1dbd4',
  commands: '0a2e0004-a812-4654-9c7b-9ddaccf1dbd4',
  info: '0a2e0005-a812-4654-9c7b-9ddaccf1dbd4',
  batteryService: '0000180f-0000-1000-8000-00805f9b34fb',
  batteryLevel: '00002a19-0000-1000-8000-00805f9b34fb',
  deviceInfoService: '0000180a-0000-1000-8000-00805f9b34fb',
  serialNumber: '00002a25-0000-1000-8000-00805f9b34fb',
  firmwareRevision: '00002a26-0000-1000-8000-00805f9b34fb',
} as const;

export const RECORD_SIZE = 9;
export const EVENT_SIZE = 9;
export const HEADER_SIZE = 2;
export const MAX_RECORDS_PER_PACKET = 26;

export enum RecordType {
  HeartRate = 0x01,
  SpO2 = 0x02,
  SkinTemp = 0x03,
  Steps = 0x04,
  Movement = 0x05,
}

export enum EventType {
  Sos = 0x01,
  Fall = 0x02,
  OffWrist = 0x03,
  OnWrist = 0x04,
  LowBattery = 0x05,
  Charging = 0x06,
  FallCancelled = 0x07,
}

export enum Opcode {
  SetTime = 0x01,
  Vibrate = 0x02,
  AckEvent = 0x03,
  SendHistory = 0x04,
  SetInterval = 0x05,
  MeasureNow = 0x06,
  /** PLANNED — v2 firmware. */
  SetReminders = 0x07,
}

export const Flag = {
  Resting: 0x01,
  ClockNotSet: 0x02,
  FromHistory: 0x04,
} as const;

export const VibratePattern = { Short: 1, Double: 2, Long: 3, AlertSent: 4, Reminder: 5 } as const;
export const MeasureMask = { HeartRate: 0x01, SpO2: 0x02, SkinTemp: 0x04 } as const;

/** Quality byte meaning "not applicable". */
export const QUALITY_NA = 255;

/** Any band time before 2024-01-01 means the clock was never set. */
export const MIN_VALID_TIME = 1704067200;

export class BandProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BandProtocolError';
  }
}

// ------------------------------------------------------------------ records
/** A record exactly as it travels on the wire (raw, unscaled). */
export type WireRecord = {
  type: number;
  time: number;
  raw: number; // i16 as sent
  quality: number; // 0–100 or 255
  flags: number;
};

export type WireEvent = {
  type: number;
  time: number;
  data: number; // i16
  flags: number;
};

/** Records per Records packet for a given ATT MTU (MTU 247 → 26, MTU 23 → 2). */
export function recordsPerPacket(mtu: number): number {
  const payload = mtu - 3;
  return Math.max(0, Math.min(MAX_RECORDS_PER_PACKET, Math.floor((payload - HEADER_SIZE) / RECORD_SIZE)));
}

export function encodeRecordsPacket(records: WireRecord[]): Uint8Array {
  if (records.length > 255) throw new BandProtocolError('too many records for one packet');
  const out = new Uint8Array(HEADER_SIZE + records.length * RECORD_SIZE);
  const v = new DataView(out.buffer);
  v.setUint8(0, PROTOCOL_VERSION);
  v.setUint8(1, records.length);
  records.forEach((r, i) => {
    const o = HEADER_SIZE + i * RECORD_SIZE;
    v.setUint8(o, r.type);
    v.setUint32(o + 1, r.time, true);
    v.setInt16(o + 5, r.raw, true);
    v.setUint8(o + 7, r.quality);
    v.setUint8(o + 8, r.flags);
  });
  return out;
}

export type DecodedRecords = { version: number; records: WireRecord[]; endOfHistory: boolean };

export function decodeRecordsPacket(bytes: Uint8Array): DecodedRecords {
  if (bytes.length < HEADER_SIZE) throw new BandProtocolError('records packet too short');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = v.getUint8(0);
  if (version !== PROTOCOL_VERSION) throw new BandProtocolError(`unsupported protocol version ${version}`);
  const count = v.getUint8(1);
  if (bytes.length !== HEADER_SIZE + count * RECORD_SIZE) {
    throw new BandProtocolError(`records packet length ${bytes.length} does not match count ${count}`);
  }
  const records: WireRecord[] = [];
  for (let i = 0; i < count; i++) {
    const o = HEADER_SIZE + i * RECORD_SIZE;
    records.push({
      type: v.getUint8(o),
      time: v.getUint32(o + 1, true),
      raw: v.getInt16(o + 5, true),
      quality: v.getUint8(o + 7),
      flags: v.getUint8(o + 8),
    });
  }
  return { version, records, endOfHistory: count === 0 };
}

/** Split records into packets that fit the negotiated MTU. */
export function packRecords(records: WireRecord[], mtu: number): Uint8Array[] {
  const per = recordsPerPacket(mtu);
  if (per < 1) throw new BandProtocolError(`MTU ${mtu} is too small for one record`);
  const packets: Uint8Array[] = [];
  for (let i = 0; i < records.length; i += per) packets.push(encodeRecordsPacket(records.slice(i, i + per)));
  return packets;
}

// ------------------------------------------------------------------- events
export function encodeEvent(e: WireEvent): Uint8Array {
  const out = new Uint8Array(EVENT_SIZE);
  const v = new DataView(out.buffer);
  v.setUint8(0, PROTOCOL_VERSION);
  v.setUint8(1, e.type);
  v.setUint32(2, e.time, true);
  v.setInt16(6, e.data, true);
  v.setUint8(8, e.flags);
  return out;
}

export function decodeEvent(bytes: Uint8Array): WireEvent {
  if (bytes.length !== EVENT_SIZE) throw new BandProtocolError(`event must be ${EVENT_SIZE} bytes, got ${bytes.length}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = v.getUint8(0);
  if (version !== PROTOCOL_VERSION) throw new BandProtocolError(`unsupported protocol version ${version}`);
  return { type: v.getUint8(1), time: v.getUint32(2, true), data: v.getInt16(6, true), flags: v.getUint8(8) };
}

// ----------------------------------------------------------------- commands
function cmd(op: Opcode, payload: number[] = []): Uint8Array {
  return Uint8Array.from([PROTOCOL_VERSION, op, ...payload]);
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

export const commands = {
  setTime: (now: number) => cmd(Opcode.SetTime, u32(now)),
  vibrate: (pattern: number, repeat = 1) => cmd(Opcode.Vibrate, [pattern & 0xff, repeat & 0xff]),
  ackEvent: (type: number, time: number) => cmd(Opcode.AckEvent, [type & 0xff, ...u32(time)]),
  sendHistory: (since: number) => cmd(Opcode.SendHistory, u32(since)),
  setInterval: (minutes: number) => {
    if (minutes < 5 || minutes > 60) throw new BandProtocolError('interval must be 5–60 minutes');
    return cmd(Opcode.SetInterval, [minutes]);
  },
  measureNow: (mask: number) => cmd(Opcode.MeasureNow, [mask & 0xff]),
  /** PLANNED — v2 firmware. */
  setReminders: (entries: { minuteOfDay: number; pattern: number }[]) => {
    if (entries.length > 8) throw new BandProtocolError('at most 8 reminders');
    return cmd(Opcode.SetReminders, [entries.length, ...entries.flatMap((e) => [...u16(e.minuteOfDay), e.pattern & 0xff])]);
  },
};

export type DecodedCommand = { opcode: number; payload: Uint8Array };

/** Band side (used by the simulator): split a command into opcode + payload. */
export function decodeCommand(bytes: Uint8Array): DecodedCommand {
  if (bytes.length < 2) throw new BandProtocolError('command too short');
  if (bytes[0] !== PROTOCOL_VERSION) throw new BandProtocolError(`unsupported protocol version ${bytes[0]}`);
  return { opcode: bytes[1], payload: bytes.slice(2) };
}

// ------------------------------------------------------- meaning of values
export type VitalKind = 'heart_rate' | 'spo2' | 'skin_temperature' | 'steps' | 'movement';

export const RECORD_INFO: Record<number, {
  kind: VitalKind;
  scale: number;
  unit: string;
  min: number;
  max: number;
  needsQuality: boolean;
}> = {
  [RecordType.HeartRate]: { kind: 'heart_rate', scale: 1, unit: 'bpm', min: 25, max: 250, needsQuality: true },
  [RecordType.SpO2]: { kind: 'spo2', scale: 1, unit: '%', min: 50, max: 100, needsQuality: true },
  [RecordType.SkinTemp]: { kind: 'skin_temperature', scale: 100, unit: '°C', min: 20, max: 45, needsQuality: false },
  [RecordType.Steps]: { kind: 'steps', scale: 1, unit: 'steps', min: 0, max: 3000, needsQuality: false },
  [RecordType.Movement]: { kind: 'movement', scale: 1, unit: 'count', min: 0, max: 10000, needsQuality: false },
};

export function scaledValue(r: WireRecord): number {
  const info = RECORD_INFO[r.type];
  return info ? r.raw / info.scale : NaN;
}

export type Rejection =
  | 'unknown_type'
  | 'out_of_range'
  | 'bad_quality'
  | 'clock_not_set'
  | 'too_far_in_future'
  | 'reserved_flags';

/** Is this record physically possible? (Impossible readings are dropped.) */
export function validateRecord(r: WireRecord, nowSec: number): { ok: true } | { ok: false; reason: Rejection } {
  const info = RECORD_INFO[r.type];
  if (!info) return { ok: false, reason: 'unknown_type' };
  if ((r.flags & ~0x07) !== 0) return { ok: false, reason: 'reserved_flags' };
  if ((r.flags & Flag.ClockNotSet) !== 0 || r.time < MIN_VALID_TIME) return { ok: false, reason: 'clock_not_set' };
  // More than a day ahead can't be clock drift; it's corrupt.
  if (r.time > nowSec + 86_400) return { ok: false, reason: 'too_far_in_future' };
  const value = scaledValue(r);
  if (!Number.isFinite(value) || value < info.min || value > info.max) return { ok: false, reason: 'out_of_range' };
  const q = r.quality;
  if (info.needsQuality ? q > 100 : q > 100 && q !== QUALITY_NA) return { ok: false, reason: 'bad_quality' };
  return { ok: true };
}

export type Freshness = 'fresh' | 'old' | 'future' | 'clock_not_set';

/**
 * The 15-minute rule. Only 'fresh' readings may go through the real-time
 * check; a time in the future (beyond the clock tolerance) or an unset clock
 * counts as old.
 */
export function freshness(
  time: number,
  flags: number,
  nowSec: number,
  maxAgeMinutes = 15,
  futureToleranceSec = 120,
): Freshness {
  if ((flags & Flag.ClockNotSet) !== 0 || time < MIN_VALID_TIME) return 'clock_not_set';
  if (time > nowSec + futureToleranceSec) return 'future';
  if (nowSec - time > maxAgeMinutes * 60) return 'old';
  return 'fresh';
}

export const EVENT_NAME: Record<number, string> = {
  [EventType.Sos]: 'sos',
  [EventType.Fall]: 'fall',
  [EventType.OffWrist]: 'off_wrist',
  [EventType.OnWrist]: 'on_wrist',
  [EventType.LowBattery]: 'low_battery',
  [EventType.Charging]: 'charging',
  [EventType.FallCancelled]: 'fall_cancelled',
};

export function validateEvent(e: WireEvent): { ok: true } | { ok: false; reason: 'unknown_type' | 'reserved_flags' } {
  if (!EVENT_NAME[e.type]) return { ok: false, reason: 'unknown_type' };
  if ((e.flags & ~0x07) !== 0) return { ok: false, reason: 'reserved_flags' };
  return { ok: true };
}

/** "HH:MM" in a timezone, for the "Delayed: happened at HH:MM" label. */
export function clockLabel(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(time * 1000));
}

// ----------------------------------------------------- upload (phone → server)
/**
 * What the phone (and the simulator) send to band-ingest: the decoded wire
 * values, unscaled. No location — the app's normal location pings cover that,
 * behind the location permission (doctors can read alerts but not location).
 */
export type BandUpload = {
  band_serial: string;
  firmware_version?: string;
  battery_pct?: number;
  records: WireRecord[];
  events: WireEvent[];
};

export const MAX_UPLOAD_RECORDS = 2000; // 48 h × 6 blocks × 5 types ≈ 1440, plus margin
export const MAX_UPLOAD_EVENTS = 200;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2) throw new BandProtocolError('odd hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
