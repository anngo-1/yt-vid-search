/**
 * transcript parsing
 */

import type { TranscriptSegment } from '@/types';
import { TranscriptParseError } from '@/services/errors';
import { timeToSeconds } from '@/utils/time';

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

interface TimedTextJson3Seg {
    utf8?: string;
}

interface TimedTextJson3Event {
    tStartMs?: number;
    segs?: TimedTextJson3Seg[];
}

interface TimedTextJson3Response {
    events?: TimedTextJson3Event[];
}

interface PanelSegmentCandidate {
    time: string;
    text: string;
}

export function formatTimestampFromSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    return `${minutes}:${String(secs).padStart(2, '0')}`;
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

/** Parse timedtext json3 payload from YouTube's captions API. */
export function parseTimedTextTranscript(json: unknown): TranscriptSegment[] {
    const data = json as TimedTextJson3Response | null | undefined;
    if (!Array.isArray(data?.events)) {
        return [];
    }

    return data.events
        .map((event) => {
            const ms = typeof event.tStartMs === 'number' ? event.tStartMs : Number(event.tStartMs);
            const seconds = Number.isFinite(ms) ? ms / 1000 : 0;
            const text =
                event.segs
                    ?.map((segment) => segment.utf8 ?? '')
                    .join('')
                    .replace(/\s+/g, ' ')
                    .trim() ?? '';

            return {
                time: formatTimestampFromSeconds(seconds),
                seconds,
                text,
            };
        })
        .filter((segment) => segment.text !== '');
}

/** Parse YouTube modern transcript payload from youtubei/v1/get_panel. */
export function parsePanelTranscript(json: unknown): TranscriptSegment[] {
    const candidates: PanelSegmentCandidate[] = [];
    const seen = new Set<string>();

    const visit = (node: unknown, inheritedTimestamp = ''): void => {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
            for (const item of node) {
                visit(item, inheritedTimestamp);
            }
            return;
        }

        const obj = node as Record<string, unknown>;
        let nextTimestamp = inheritedTimestamp;

        const timeline = obj.timelineItemViewModel as Record<string, unknown> | undefined;
        if (timeline && typeof timeline.timestamp === 'string') {
            nextTimestamp = timeline.timestamp;
        }

        const segment = obj.transcriptSegmentViewModel as Record<string, unknown> | undefined;
        if (segment) {
            const time =
                (typeof segment.timestamp === 'string' ? segment.timestamp : '') ||
                (typeof obj.timestamp === 'string' ? obj.timestamp : '') ||
                nextTimestamp;
            const text = typeof segment.simpleText === 'string' ? segment.simpleText.replace(/\s+/g, ' ').trim() : '';
            if (time && text) {
                const key = `${time}|${text}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    candidates.push({ time, text });
                }
            }
        }

        for (const value of Object.values(obj)) {
            visit(value, nextTimestamp);
        }
    };

    visit(json);

    return candidates.map((segment) => ({
        time: segment.time,
        seconds: timeToSeconds(segment.time),
        text: segment.text,
    }));
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
