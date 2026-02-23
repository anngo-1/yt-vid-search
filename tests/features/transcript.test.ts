import { describe, it, expect } from 'vitest';
import { parseTranscript } from '../../src/utils/transcript';
import { makeTranscriptResponse as makeResponse } from '../helpers/fixtures';

describe('parseTranscript', () => {
    it('parses YouTube transcript response', () => {
        const response = makeResponse([
            { time: '0:00', ms: '0', text: 'Hello' },
            { time: '0:05', ms: '5000', text: 'World' },
        ]);

        const result = parseTranscript(response);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ time: '0:00', seconds: 0, text: 'Hello' });
        expect(result[1]).toEqual({ time: '0:05', seconds: 5, text: 'World' });
    });

    it('returns empty array for invalid response', () => {
        expect(parseTranscript({})).toEqual([]);
    });

    it('handles NaN milliseconds gracefully', () => {
        const response = makeResponse([{ time: '0:00', ms: 'not-a-number', text: 'Test' }]);
        const result = parseTranscript(response);
        expect(result).toHaveLength(1);
        expect(result[0].seconds).toBe(0); // NaN defaults to 0
    });

    it('filters out empty text segments', () => {
        const response = makeResponse([
            { time: '0:00', ms: '0', text: '' },
            { time: '0:05', ms: '5000', text: '   ' },
            { time: '0:10', ms: '10000', text: 'Valid' },
        ]);
        const result = parseTranscript(response);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Valid');
    });

    it('handles null/undefined input', () => {
        expect(parseTranscript(null)).toEqual([]);
        expect(parseTranscript(undefined)).toEqual([]);
    });

    it('handles response with no actions', () => {
        expect(parseTranscript({ actions: [] })).toEqual([]);
    });

    it('concatenates multiple text runs', () => {
        const response = {
            actions: [
                {
                    updateEngagementPanelAction: {
                        content: {
                            transcriptRenderer: {
                                content: {
                                    transcriptSearchPanelRenderer: {
                                        body: {
                                            transcriptSegmentListRenderer: {
                                                initialSegments: [
                                                    {
                                                        transcriptSegmentRenderer: {
                                                            startTimeText: { simpleText: '0:00' },
                                                            startMs: '0',
                                                            snippet: { runs: [{ text: 'Hello' }, { text: ' World' }] },
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        };
        const result = parseTranscript(response);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Hello World');
    });
});
