import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '../../src/types';
import {
    getLowercasedTranscriptText,
    getWindowedTranscriptSegments,
    getWindowedTranscriptText,
    readTranscriptRange,
    searchTranscriptSegments,
} from '../../src/utils/transcript-derived';

const transcript: TranscriptSegment[] = [
    { time: '0:00', seconds: 0, text: 'Hello World' },
    { time: '0:10', seconds: 10, text: 'JavaScript functions' },
    { time: '0:20', seconds: 20, text: 'Arrow functions are useful' },
    { time: '0:30', seconds: 30, text: 'Goodbye' },
];

describe('transcript-derived helpers', () => {
    it('reuses lowered transcript cache per transcript reference', () => {
        const first = getLowercasedTranscriptText(transcript);
        const second = getLowercasedTranscriptText(transcript);

        expect(first).toBe(second);
        expect(first[0]).toBe('hello world');
    });

    it('returns cached full-window segments and full transcript text', () => {
        const segments = getWindowedTranscriptSegments(transcript, 0, 0);
        const text = getWindowedTranscriptText(transcript, 0, 0, '[0:00] Hello World');

        expect(segments).toBe(transcript);
        expect(text).toBe('[0:00] Hello World');
    });

    it('finds windowed segments without scanning the entire prefix', () => {
        expect(getWindowedTranscriptSegments(transcript, 10, 20)).toEqual([
            transcript[1],
            transcript[2],
        ]);
    });

    it('searches transcript case-insensitively with an optional limit', () => {
        expect(searchTranscriptSegments(transcript, 'FUNCTION', 1)).toEqual([transcript[1]]);
    });

    it('reads a sorted transcript time range', () => {
        expect(readTranscriptRange(transcript, 15, 30)).toEqual([transcript[2], transcript[3]]);
    });
});
