import { describe, it, expect } from 'vitest';
import { timeToSeconds, parseTimestamp } from '../../src/utils/time';

describe('timeToSeconds', () => {
    it('converts mm:ss and hh:mm:ss formats', () => {
        expect(timeToSeconds('2:30')).toBe(150);
        expect(timeToSeconds('1:30:00')).toBe(5400);
    });
});

describe('parseTimestamp', () => {
    it('extracts timestamps from text', () => {
        expect(parseTimestamp('[2:30]')).toBe(150);
        expect(parseTimestamp('at 5:45')).toBe(345);
        expect(parseTimestamp('no timestamp')).toBe(null);
    });
});
