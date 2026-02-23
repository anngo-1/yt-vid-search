import { describe, it, expect } from 'vitest';
import { findActiveSegmentIndex } from '../../src/utils/transcript';
import type { TranscriptSegment } from '../../src/types';

function makeSegments(times: number[]): TranscriptSegment[] {
    return times.map((s, i) => ({
        time: `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
        seconds: s,
        text: `Segment ${i}`,
    }));
}

describe('findActiveSegmentIndex', () => {
    const segments = makeSegments([0, 5, 10, 15, 20, 25, 30]);

    it('finds correct segment during sequential playback', () => {
        expect(findActiveSegmentIndex(segments, 0)).toBe(0);
        expect(findActiveSegmentIndex(segments, 3)).toBe(0);
        expect(findActiveSegmentIndex(segments, 5)).toBe(1);
        expect(findActiveSegmentIndex(segments, 7)).toBe(1);
        expect(findActiveSegmentIndex(segments, 12)).toBe(2);
    });

    it('returns last segment when past end', () => {
        expect(findActiveSegmentIndex(segments, 100)).toBe(6);
        expect(findActiveSegmentIndex(segments, 30)).toBe(6);
        expect(findActiveSegmentIndex(segments, 35)).toBe(6);
    });

    it('returns -1 for time before first segment', () => {
        const segs = makeSegments([5, 10, 15]);
        expect(findActiveSegmentIndex(segs, 2)).toBe(-1);
    });

    it('handles seek backward', () => {
        // Start at index 4 (time 20), seek back to time 7
        const result = findActiveSegmentIndex(segments, 7, 4);
        expect(result).toBe(1);
    });

    it('handles seek forward past all segments', () => {
        const result = findActiveSegmentIndex(segments, 50, 2);
        expect(result).toBe(6);
    });

    it('optimizes with lastIndex for sequential playback', () => {
        // Sequential: lastIndex=2 (time 10), now at time 12
        const result = findActiveSegmentIndex(segments, 12, 2);
        expect(result).toBe(2);

        // Sequential: lastIndex=2, now at time 17
        const result2 = findActiveSegmentIndex(segments, 17, 2);
        expect(result2).toBe(3);
    });

    it('handles single-segment transcript', () => {
        const single = makeSegments([10]);
        expect(findActiveSegmentIndex(single, 5)).toBe(-1);
        expect(findActiveSegmentIndex(single, 10)).toBe(0);
        expect(findActiveSegmentIndex(single, 15)).toBe(0);
    });

    it('handles empty transcript', () => {
        expect(findActiveSegmentIndex([], 5)).toBe(-1);
    });

    it('handles exact boundary times', () => {
        expect(findActiveSegmentIndex(segments, 5)).toBe(1);
        expect(findActiveSegmentIndex(segments, 10)).toBe(2);
        expect(findActiveSegmentIndex(segments, 25)).toBe(5);
    });
});
