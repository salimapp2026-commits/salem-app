// The Medicines screen's pure parts (native/src/lib/medicines.ts).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { addTime, groupMedicines, MAX_TIMES, parseTime } from '../native/src/lib/medicines';

describe('parseTime', () => {
  it('reads the ways people type a time', () => {
    expect(parseTime('8')).toBe('08:00');
    expect(parseTime('08')).toBe('08:00');
    expect(parseTime('8:5')).toBe('08:05');
    expect(parseTime(' 20:30 ')).toBe('20:30');
    expect(parseTime('20.30')).toBe('20:30');
    expect(parseTime('0805')).toBe('08:05');
    expect(parseTime('٢١:٣٠')).toBe('21:30');   // Arabic-Indic digits
    expect(parseTime('0')).toBe('00:00');
  });
  it('refuses what is not a time of day', () => {
    for (const bad of ['', 'abc', '24:00', '12:60', '8pm', '1:2:3', '123456']) {
      expect(parseTime(bad), bad).toBeNull();
    }
  });
});

describe('addTime', () => {
  it('keeps each time once, in order, at most six', () => {
    expect(addTime(['20:00'], '08:00')).toEqual(['08:00', '20:00']);
    expect(addTime(['08:00'], '08:00')).toEqual(['08:00']);
    const six = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00'];
    expect(six).toHaveLength(MAX_TIMES);
    expect(addTime(six, '07:00')).toEqual(six);
  });
});

describe('groupMedicines', () => {
  it('one medicine per title, its times in order, medicines by first time', () => {
    const meds = groupMedicines([
      { id: 'a', title: 'Concor 5 mg', local_time: '20:00:00' },
      { id: 'b', title: 'Aspirin', local_time: '14:00:00' },
      { id: 'c', title: 'Concor 5 mg', local_time: '08:00:00' },
      { id: 'd', title: 'No time', local_time: null },
    ]);
    expect(meds).toEqual([
      { title: 'Concor 5 mg', times: ['08:00', '20:00'], ids: ['c', 'a'] },
      { title: 'Aspirin', times: ['14:00'], ids: ['b'] },
    ]);
  });
});
