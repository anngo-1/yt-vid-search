/**
 * time - timestamp parsing utilities
 */

/** parse timestamp string (mm:ss or hh:mm:ss) to seconds, returns null if invalid */
export function parseTimestamp(timeStr: string): number | null {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const match = timeStr.match(/\d{1,2}:\d{2}:\d{2}/) || timeStr.match(/\d{1,2}:\d{2}/);
    if (!match) return null;
    const parts = match[0].split(':').map((p) => parseInt(p, 10));
    if (parts.some(Number.isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
}

/** parse timestamp, returns 0 instead of null for convenience */
export function timeToSeconds(timeStr: string): number {
    return parseTimestamp(timeStr) ?? 0;
}
