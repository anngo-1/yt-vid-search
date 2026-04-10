/**
 * Performance benchmarks — regression guard for the two hot paths that run
 * continuously during YouTube playback.
 *
 * These run in Node/jsdom so they can't measure DOM or Promise scheduling
 * overhead. They exist to catch algorithmic regressions (e.g. O(n) replacing
 * the binary search, or expensive work added to a store listener).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findActiveSegmentIndex } from '../../src/utils/transcript';
import { Store } from '../../src/services/store';
import type { TranscriptSegment } from '../../src/types';

function makeTranscript(n: number): TranscriptSegment[] {
    return Array.from({ length: n }, (_, i) => ({
        time: `${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}`,
        seconds: i * 1.5,
        text: `Segment ${i}`,
    }));
}

describe('perf: active segment binary search', () => {
    const transcript = makeTranscript(1_000);

    it('sequential playback through 1000 segments completes in < 10ms', () => {
        let last = -1;
        const t0 = performance.now();
        for (let i = 0; i < 1_000; i++) {
            const t = (i / 1_000) * 1_500;
            last = findActiveSegmentIndex(transcript, t, last);
        }
        const elapsed = performance.now() - t0;
        expect(last).toBeGreaterThan(-1);
        expect(elapsed).toBeLessThan(10);
    });
});

describe('perf: store dispatch', () => {
    let store: Store;

    beforeEach(() => {
        store = new Store();
    });

    afterEach(() => {
        store.dispose();
    });

    it('10k dispatches with 5 listeners complete in < 20ms', () => {
        let tally = 0;
        for (let i = 0; i < 5; i++) {
            store.on('lastActiveSegmentIndex', () => {
                tally++;
            });
        }

        const t0 = performance.now();
        for (let i = 0; i < 10_000; i++) {
            store.set('lastActiveSegmentIndex', i);
        }
        const elapsed = performance.now() - t0;

        expect(tally).toBe(50_000);
        expect(elapsed).toBeLessThan(20);
    });
});
