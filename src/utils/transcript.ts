/**
 * transcript parsing
 */

import type { TranscriptSegment } from '@/types';
import { TranscriptParseError } from '@/services/errors';

interface TranscriptSegmentRenderer {
    startTimeText: { simpleText: string };
    startMs: string;
    snippet: { runs: Array<{ text: string }> };
}

interface YouTubeTranscriptResponse {
    actions?: Array<{
        updateEngagementPanelAction?: {
            content?: {
                transcriptRenderer?: {
                    content?: {
                        transcriptSearchPanelRenderer?: {
                            body?: {
                                transcriptSegmentListRenderer?: {
                                    initialSegments?: Array<{
                                        transcriptSegmentRenderer?: TranscriptSegmentRenderer;
                                    }>;
                                };
                            };
                        };
                    };
                };
            };
        };
    }>;
}

/** parse youtube transcript api response into segments */
export function parseTranscript(json: unknown): TranscriptSegment[] {
    try {
        const data = json as YouTubeTranscriptResponse;
        const segments = data?.actions?.find((a) => a.updateEngagementPanelAction)?.updateEngagementPanelAction?.content
            ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer
            ?.initialSegments;

        return (segments || [])
            .map((s) => s.transcriptSegmentRenderer)
            .filter((r): r is TranscriptSegmentRenderer => Boolean(r))
            .map((r) => {
                const ms = parseInt(r.startMs, 10);
                return {
                    time: r.startTimeText?.simpleText || '0:00',
                    seconds: isNaN(ms) ? 0 : ms / 1000,
                    text: r.snippet?.runs?.map((x) => x.text).join('') || '',
                };
            })

            .filter((s) => s.text.trim() !== '');
    } catch {
        throw new TranscriptParseError('Failed to parse transcript data', json);
    }
}

/**
 * Binary search to find the segment active at a given time
 * O(log n) lookup complexity
 */
export function findActiveSegmentIndex(
    transcript: TranscriptSegment[],
    seconds: number,
    lastIndex: number = -1,
): number {
    if (!transcript.length) return -1;

    let low = 0;
    let high = transcript.length - 1;
    let activeIndex = -1;

    // Optimization: Narrow search range based on last known index
    // If sequential playback, we're likely close to where we were
    if (lastIndex !== -1 && lastIndex < transcript.length) {
        if (seconds >= transcript[lastIndex].seconds) {
            low = lastIndex;
        } else {
            // We jumped backwards, so high is the last known index
            high = lastIndex;
        }
    }

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const seg = transcript[mid];
        const nextSeg = transcript[mid + 1];

        if (seconds >= seg.seconds && (!nextSeg || seconds < nextSeg.seconds)) {
            activeIndex = mid;
            break;
        } else if (seconds < seg.seconds) {
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }

    // Edge case: If still -1 but time is positive and past last segment
    // This happens when video plays past the last transcript segment time
    if (activeIndex === -1 && transcript.length > 0 && seconds >= transcript[transcript.length - 1].seconds) {
        activeIndex = transcript.length - 1;
    }

    return activeIndex;
}
