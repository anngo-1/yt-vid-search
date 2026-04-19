import type { TranscriptSegment } from '@/types';

const fullTranscriptCache: {
    transcript: TranscriptSegment[] | null;
    lowered: string[];
} = {
    transcript: null,
    lowered: [],
};

const windowedTranscriptCache: {
    transcript: TranscriptSegment[] | null;
    start: number;
    end: number;
    segments: TranscriptSegment[];
    text: string | null;
} = {
    transcript: null,
    start: 0,
    end: 0,
    segments: [],
    text: null,
};

function isFullTranscriptWindow(start: number, end: number): boolean {
    return start === 0 && end === 0;
}

function buildTranscriptText(segments: TranscriptSegment[]): string {
    return segments.map((s) => `[${s.time}] ${s.text}`).join('\n');
}

function lowerBoundBySeconds(transcript: TranscriptSegment[], targetSeconds: number): number {
    let low = 0;
    let high = transcript.length;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (transcript[mid].seconds < targetSeconds) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
}

export function getLowercasedTranscriptText(transcript: TranscriptSegment[]): string[] {
    if (fullTranscriptCache.transcript === transcript) {
        return fullTranscriptCache.lowered;
    }

    const lowered = transcript.map((segment) => segment.text.toLowerCase());
    fullTranscriptCache.transcript = transcript;
    fullTranscriptCache.lowered = lowered;
    return lowered;
}

export function getWindowedTranscriptSegments(
    transcript: TranscriptSegment[],
    start: number,
    end: number,
): TranscriptSegment[] {
    if (!transcript.length) return transcript;

    if (
        windowedTranscriptCache.transcript === transcript &&
        windowedTranscriptCache.start === start &&
        windowedTranscriptCache.end === end
    ) {
        return windowedTranscriptCache.segments;
    }

    if (isFullTranscriptWindow(start, end)) {
        windowedTranscriptCache.transcript = transcript;
        windowedTranscriptCache.start = start;
        windowedTranscriptCache.end = end;
        windowedTranscriptCache.segments = transcript;
        windowedTranscriptCache.text = null;
        return transcript;
    }

    const effectiveEnd = end === 0 ? Infinity : end;
    const startIndex = lowerBoundBySeconds(transcript, start);
    const segments: TranscriptSegment[] = [];

    for (let i = startIndex; i < transcript.length; i++) {
        const segment = transcript[i];
        if (segment.seconds > effectiveEnd) break;
        segments.push(segment);
    }

    windowedTranscriptCache.transcript = transcript;
    windowedTranscriptCache.start = start;
    windowedTranscriptCache.end = end;
    windowedTranscriptCache.segments = segments;
    windowedTranscriptCache.text = null;
    return segments;
}

export function getWindowedTranscriptText(
    transcript: TranscriptSegment[],
    start: number,
    end: number,
    fullTranscriptText = '',
): string {
    const segments = getWindowedTranscriptSegments(transcript, start, end);
    if (!segments.length) return '';

    if (isFullTranscriptWindow(start, end) && fullTranscriptText) {
        windowedTranscriptCache.text = fullTranscriptText;
        return fullTranscriptText;
    }

    if (windowedTranscriptCache.text !== null) {
        return windowedTranscriptCache.text;
    }

    const text = buildTranscriptText(segments);
    windowedTranscriptCache.text = text;
    return text;
}

export function searchTranscriptSegments(
    transcript: TranscriptSegment[],
    query: string,
    limit = Infinity,
): TranscriptSegment[] {
    if (!query || !transcript.length || limit <= 0) return [];

    const lowered = getLowercasedTranscriptText(transcript);
    const normalizedQuery = query.toLowerCase();
    const matches: TranscriptSegment[] = [];

    for (let i = 0; i < transcript.length; i++) {
        if (!lowered[i].includes(normalizedQuery)) continue;
        matches.push(transcript[i]);
        if (matches.length >= limit) break;
    }

    return matches;
}

export function readTranscriptRange(
    transcript: TranscriptSegment[],
    startSeconds: number,
    endSeconds: number,
): TranscriptSegment[] {
    if (!transcript.length || endSeconds < startSeconds) return [];

    const startIndex = lowerBoundBySeconds(transcript, startSeconds);
    const results: TranscriptSegment[] = [];

    for (let i = startIndex; i < transcript.length; i++) {
        const segment = transcript[i];
        if (segment.seconds > endSeconds) break;
        results.push(segment);
    }

    return results;
}
