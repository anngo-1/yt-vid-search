import { describe, it, expect } from 'vitest';
import { parseTranscript } from '../../src/utils/transcript';
import { TranscriptParseError } from '../../src/services/errors';

const makeResponse = (segments: { time: string; ms: string; text: string }[]) => ({
    actions: [
        {
            updateEngagementPanelAction: {
                content: {
                    transcriptRenderer: {
                        content: {
                            transcriptSearchPanelRenderer: {
                                body: {
                                    transcriptSegmentListRenderer: {
                                        initialSegments: segments.map((s) => ({
                                            transcriptSegmentRenderer: {
                                                startTimeText: { simpleText: s.time },
                                                startMs: s.ms,
                                                snippet: { runs: [{ text: s.text }] },
                                            },
                                        })),
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    ],
});

describe('parseTranscript error handling', () => {
    it('throws TranscriptParseError on internal parse failure', () => {
        // actions is a non-iterable type that causes a runtime error
        // when optional chaining resolves to a non-null/undefined value
        // but calling .find() on it fails
        const malformed = { actions: 42 };

        expect(() => parseTranscript(malformed)).toThrow(TranscriptParseError);
    });

    it('error includes raw data for debugging', () => {
        const malformed = { actions: 42 };

        try {
            parseTranscript(malformed);
            expect.fail('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(TranscriptParseError);
            const err = e as TranscriptParseError;
            expect(err.rawData).toBe(malformed);
            expect(err.code).toBe('TRANSCRIPT_PARSE_ERROR');
        }
    });

    it('returns empty array for structurally valid but empty data (no throw)', () => {
        expect(parseTranscript(null)).toEqual([]);
        expect(parseTranscript(undefined)).toEqual([]);
        expect(parseTranscript({})).toEqual([]);
        expect(parseTranscript({ actions: [] })).toEqual([]);
    });

    it('returns empty array when all segments have empty text', () => {
        const response = makeResponse([
            { time: '0:00', ms: '0', text: '' },
            { time: '0:05', ms: '5000', text: '   ' },
        ]);
        expect(parseTranscript(response)).toEqual([]);
    });
});
