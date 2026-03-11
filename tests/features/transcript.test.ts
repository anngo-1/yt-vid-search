import { describe, it, expect } from 'vitest';
import { parsePanelTranscript, parseTranscript, parseTimedTextTranscript } from '../../src/utils/transcript';
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

describe('parseTimedTextTranscript', () => {
    it('parses timedtext json3 payload', () => {
        const payload = {
            events: [
                {
                    tStartMs: 633,
                    segs: [{ utf8: '♪ ♪' }],
                },
                {
                    tStartMs: 1600,
                    segs: [{ utf8: '♪ OPEN TO DOUBLE DOORS ♪' }],
                },
            ],
        };

        const result = parseTimedTextTranscript(payload);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ time: '0:00', seconds: 0.633, text: '♪ ♪' });
        expect(result[1]).toEqual({ time: '0:01', seconds: 1.6, text: '♪ OPEN TO DOUBLE DOORS ♪' });
    });

    it('joins runs and normalizes whitespace', () => {
        const payload = {
            events: [
                {
                    tStartMs: 12000,
                    segs: [{ utf8: 'Hello\n' }, { utf8: '  world' }],
                },
            ],
        };

        const result = parseTimedTextTranscript(payload);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ time: '0:12', seconds: 12, text: 'Hello world' });
    });

    it('returns empty array for missing or invalid events', () => {
        expect(parseTimedTextTranscript(null)).toEqual([]);
        expect(parseTimedTextTranscript({})).toEqual([]);
        expect(parseTimedTextTranscript({ events: 'bad' })).toEqual([]);
    });
});

describe('parsePanelTranscript', () => {
    it('parses modern get_panel transcript payload', () => {
        const payload = {
            items: [
                {
                    macroMarkersPanelItemViewModel: {
                        item: {
                            timelineItemViewModel: {
                                timestamp: '2:04',
                                contentItems: [
                                    {
                                        transcriptSegmentViewModel: {
                                            simpleText: 'first segment',
                                            timestamp: '2:04',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
                {
                    macroMarkersPanelItemViewModel: {
                        item: {
                            timelineItemViewModel: {
                                timestamp: '2:12',
                                contentItems: [
                                    {
                                        transcriptSegmentViewModel: {
                                            simpleText: 'second segment',
                                            timestamp: '2:12',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            ],
        };

        const result = parsePanelTranscript(payload);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ time: '2:04', seconds: 124, text: 'first segment' });
        expect(result[1]).toEqual({ time: '2:12', seconds: 132, text: 'second segment' });
    });

    it('returns empty array for invalid panel payload', () => {
        expect(parsePanelTranscript(null)).toEqual([]);
        expect(parsePanelTranscript({})).toEqual([]);
        expect(parsePanelTranscript({ items: 'bad' })).toEqual([]);
    });
});
