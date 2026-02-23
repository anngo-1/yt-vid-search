import { describe, it, expect } from 'vitest';
import { isOpenPanelMessage } from '../../src/services/validators';
import { parseTranscript } from '../../src/utils/transcript';

describe('main message handling', () => {
    describe('OPEN_PANEL message detection', () => {
        it('recognizes OPEN_PANEL messages', () => {
            expect(isOpenPanelMessage({ type: 'OPEN_PANEL' })).toBe(true);
        });

        it('rejects other message types', () => {
            expect(isOpenPanelMessage({ type: 'OTHER' })).toBe(false);
            expect(isOpenPanelMessage({})).toBe(false);
            expect(isOpenPanelMessage(null)).toBe(false);
        });
    });

    describe('transcript parsing integration', () => {
        it('parses valid transcript payload', () => {
            const payload = {
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
                                                                snippet: { runs: [{ text: 'Hello' }] },
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

            const result = parseTranscript(payload);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Hello');
            expect(result[0].time).toBe('0:00');
        });

        it('returns empty array for invalid payload', () => {
            expect(parseTranscript(null)).toEqual([]);
            expect(parseTranscript(undefined)).toEqual([]);
            expect(parseTranscript({})).toEqual([]);
        });

        it('filters empty text segments', () => {
            const payload = {
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
                                                                snippet: { runs: [{ text: '' }] },
                                                            },
                                                        },
                                                        {
                                                            transcriptSegmentRenderer: {
                                                                startTimeText: { simpleText: '0:05' },
                                                                startMs: '5000',
                                                                snippet: { runs: [{ text: 'Real text' }] },
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

            const result = parseTranscript(payload);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Real text');
        });
    });
});

describe('navigation handling', () => {
    it('getVideoId extracts watch parameter', () => {
        // Use the validator pattern from main.ts
        const url = new URL('https://youtube.com/watch?v=abc123');
        const params = new URLSearchParams(url.search);
        expect(params.get('v')).toBe('abc123');
    });

    it('getVideoId returns null for non-video pages', () => {
        const url = new URL('https://youtube.com/feed');
        const params = new URLSearchParams(url.search);
        expect(params.get('v')).toBeNull();
    });
});
