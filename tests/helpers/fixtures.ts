/**
 * Shared test fixtures
 */

/** Build a YouTube transcript API response from simple segment data */
export function makeTranscriptResponse(segments: { time: string; ms: string; text: string }[]) {
    return {
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
    };
}
