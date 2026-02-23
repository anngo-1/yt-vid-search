/**
 * selectors - youtube dom selectors
 */

/** get the main YouTube video element */
export function getVideoElement(): HTMLVideoElement | null {
    // Target YouTube's main player video element specifically
    return (
        (document.querySelector(
            '#movie_player video, ytd-player video, .html5-main-video',
        ) as HTMLVideoElement | null) || document.querySelector('video')
    );
}

/** get the video title */
export function getVideoTitle(): string {
    return document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent || 'the video';
}

/** get current video id from url */
export function getVideoId(): string | null {
    const params = new URLSearchParams(location.search);
    const watchId = params.get('v');
    if (watchId) return watchId;

    const path = location.pathname || '';
    const shortsMatch = path.match(/^\/shorts\/([^/?#]+)/);
    if (shortsMatch) return shortsMatch[1];

    const embedMatch = path.match(/^\/embed\/([^/?#]+)/);
    if (embedMatch) return embedMatch[1];

    return null;
}

/** get element by id with type safety */
export function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

/** create element with optional class */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
}

/** seek video to specific time */
export function seekTo(seconds: number): void {
    const video = getVideoElement();
    if (video) {
        video.currentTime = seconds;
        video.play();
    }
}

/** escape HTML to prevent XSS */
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/** strip HTML tags using DOMParser (safe against XSS) */
export function stripHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}
