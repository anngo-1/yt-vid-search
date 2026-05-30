import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseTranscript } from '../../src/utils/transcript';
import { escapeHtml } from '../../src/content/selectors';
import { findActiveSegmentIndex } from '../../src/utils/transcript';
import { TranscriptTab } from '../../src/components/tabs/TranscriptTab';
import { store } from '../../src/services/store';
import { SEARCH_DEBOUNCE_MS } from '../../src/utils/constants';
import type { TranscriptSegment } from '../../src/types';

// Mock chrome API
const mockChrome = {
    runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
    },
    storage: {
        local: { get: vi.fn((_k: string[], cb: (d: Record<string, unknown>) => void) => cb({})), set: vi.fn() },
        onChanged: { addListener: vi.fn() },
        session: { setAccessLevel: vi.fn() },
    },
    tabs: { query: vi.fn(), sendMessage: vi.fn() },
};

(globalThis as unknown as Record<string, unknown>).chrome = mockChrome;

import { makeTranscriptResponse as makeResponse } from '../helpers/fixtures';

describe('transcript parse → render → search integration', () => {
    let transcript: TranscriptSegment[];

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="yt-transcript-rows"></div>
        `;
        store.reset('integration-test');

        const payload = makeResponse([
            { time: '0:00', ms: '0', text: 'Welcome to the video' },
            { time: '0:15', ms: '15000', text: 'Today we discuss JavaScript' },
            { time: '0:30', ms: '30000', text: 'Functions are fundamental' },
            { time: '0:45', ms: '45000', text: 'Arrow functions simplify syntax' },
            { time: '1:00', ms: '60000', text: 'Closures capture variables' },
            { time: '1:15', ms: '75000', text: 'Promises handle async operations' },
            { time: '1:30', ms: '90000', text: 'Thank you for watching' },
        ]);

        transcript = parseTranscript(payload);
    });

    it('parses a full transcript correctly', () => {
        expect(transcript).toHaveLength(7);
        expect(transcript[0]).toEqual({ time: '0:00', seconds: 0, text: 'Welcome to the video' });
        expect(transcript[6]).toEqual({ time: '1:30', seconds: 90, text: 'Thank you for watching' });
    });

    it('renders transcript rows with correct structure', () => {
        const container = document.getElementById('yt-transcript-rows')!;

        // Render transcript rows
        container.innerHTML = transcript
            .map(
                (t) => `
                <div class="yt-row" data-seconds="${t.seconds}">
                    <div class="yt-time">${escapeHtml(t.time)}</div>
                    <div class="yt-text">${escapeHtml(t.text)}</div>
                </div>
            `,
            )
            .join('');

        const rows = container.querySelectorAll('.yt-row');
        expect(rows.length).toBe(7);
        expect(rows[1].querySelector('.yt-text')?.textContent).toBe('Today we discuss JavaScript');
        expect(rows[1].getAttribute('data-seconds')).toBe('15');
    });

    it('searches inside the transcript tab without filtering rows', () => {
        vi.useFakeTimers();
        const tab = new TranscriptTab();
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        try {
            store.set('transcript', transcript);
            tab.mount(parent);

            const input = parent.querySelector<HTMLInputElement>('#yt-transcript-search-input')!;
            input.value = 'function';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

            const rows = parent.querySelectorAll('#yt-transcript-rows .yt-row');
            expect(rows.length).toBe(7);
            expect(parent.querySelector('#yt-transcript-search-count')?.textContent).toBe('1 / 2');
            expect(rows[2].classList.contains('search-current')).toBe(true);

            const marks = Array.from(parent.querySelectorAll('#yt-transcript-rows mark')).map((mark) => mark.textContent);
            expect(marks).toEqual(['Function', 'function']);

            parent.querySelector<HTMLButtonElement>('#yt-search-next')?.click();
            const nextRows = parent.querySelectorAll('#yt-transcript-rows .yt-row');
            expect(parent.querySelector('#yt-transcript-search-count')?.textContent).toBe('2 / 2');
            expect(nextRows[2]).toBe(rows[2]);
            expect(nextRows[3]).toBe(rows[3]);
            expect(nextRows[2].classList.contains('search-current')).toBe(false);
            expect(nextRows[3].classList.contains('search-current')).toBe(true);

            parent.querySelector<HTMLButtonElement>('#yt-search-prev')?.click();
            const prevRows = parent.querySelectorAll('#yt-transcript-rows .yt-row');
            expect(parent.querySelector('#yt-transcript-search-count')?.textContent).toBe('1 / 2');
            expect(prevRows[2]).toBe(rows[2]);
            expect(prevRows[3]).toBe(rows[3]);
            expect(prevRows[2].classList.contains('search-current')).toBe(true);
            expect(prevRows[3].classList.contains('search-current')).toBe(false);
        } finally {
            tab.unmount();
            vi.useRealTimers();
        }
    });

    it('moves search navigation through each highlighted occurrence', () => {
        vi.useFakeTimers();
        const tab = new TranscriptTab();
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        try {
            store.set('transcript', [
                { time: '0:00', seconds: 0, text: 'function then function again' },
                { time: '0:10', seconds: 10, text: 'no match here' },
                { time: '0:20', seconds: 20, text: 'final function' },
            ]);
            tab.mount(parent);

            const input = parent.querySelector<HTMLInputElement>('#yt-transcript-search-input')!;
            input.value = 'function';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

            const rows = parent.querySelectorAll('#yt-transcript-rows .yt-row');
            let marks = parent.querySelectorAll('#yt-transcript-rows mark');
            expect(parent.querySelector('#yt-transcript-search-count')?.textContent).toBe('1 / 3');
            expect(rows[0].classList.contains('search-current')).toBe(true);
            expect(marks[0].classList.contains('search-current-match')).toBe(true);

            parent.querySelector<HTMLButtonElement>('#yt-search-next')?.click();
            marks = parent.querySelectorAll('#yt-transcript-rows mark');
            expect(parent.querySelector('#yt-transcript-search-count')?.textContent).toBe('2 / 3');
            expect(rows[0].classList.contains('search-current')).toBe(true);
            expect(marks[0].classList.contains('search-current-match')).toBe(false);
            expect(marks[1].classList.contains('search-current-match')).toBe(true);

            parent.querySelector<HTMLButtonElement>('#yt-search-next')?.click();
            marks = parent.querySelectorAll('#yt-transcript-rows mark');
            expect(parent.querySelector('#yt-transcript-search-count')?.textContent).toBe('3 / 3');
            expect(rows[0].classList.contains('search-current')).toBe(false);
            expect(rows[2].classList.contains('search-current')).toBe(true);
            expect(marks[1].classList.contains('search-current-match')).toBe(false);
            expect(marks[2].classList.contains('search-current-match')).toBe(true);
        } finally {
            tab.unmount();
            vi.useRealTimers();
        }
    });

    it('centers the active search mark in the transcript scroller', () => {
        vi.useFakeTimers();
        const tab = new TranscriptTab();
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        try {
            store.set('transcript', [{ time: '0:00', seconds: 0, text: 'function then function again' }]);
            tab.mount(parent);

            const input = parent.querySelector<HTMLInputElement>('#yt-transcript-search-input')!;
            input.value = 'function';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

            const scroller = parent.querySelector<HTMLElement>('#yt-transcript-rows')!;
            const marks = parent.querySelectorAll<HTMLElement>('#yt-transcript-rows mark');
            scroller.scrollTop = 100;
            Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
            scroller.getBoundingClientRect = () =>
                ({ top: 10, bottom: 210, left: 0, right: 320, width: 320, height: 200 } as DOMRect);
            marks[1].getBoundingClientRect = () =>
                ({ top: 510, bottom: 530, left: 0, right: 80, width: 80, height: 20 } as DOMRect);
            const scrollTo = vi.fn((options: ScrollToOptions) => {
                scroller.scrollTop = Number(options.top ?? 0);
            });
            Object.defineProperty(scroller, 'scrollTo', { configurable: true, value: scrollTo });

            parent.querySelector<HTMLButtonElement>('#yt-search-next')?.click();

            expect(scrollTo).toHaveBeenCalledWith({ top: 510, behavior: 'smooth' });
            expect(scroller.scrollTop).toBe(510);
        } finally {
            tab.unmount();
            vi.useRealTimers();
        }
    });

    it('syncs to correct segment at different times', () => {
        expect(findActiveSegmentIndex(transcript, 0)).toBe(0);
        expect(findActiveSegmentIndex(transcript, 10)).toBe(0);
        expect(findActiveSegmentIndex(transcript, 15)).toBe(1);
        expect(findActiveSegmentIndex(transcript, 45)).toBe(3);
        expect(findActiveSegmentIndex(transcript, 100)).toBe(6);
    });

    it('handles empty search results', () => {
        const q = 'nonexistent';
        const matches = transcript.filter((t) => t.text.toLowerCase().includes(q));
        expect(matches).toHaveLength(0);
    });

    it('handles case-insensitive search', () => {
        const q = 'JAVASCRIPT';
        const matches = transcript.filter((t) => t.text.toLowerCase().includes(q.toLowerCase()));
        expect(matches).toHaveLength(1);
        expect(matches[0].text).toBe('Today we discuss JavaScript');
    });

    it('escapes HTML in transcript text to prevent XSS', () => {
        const malicious = '<script>alert("xss")</script>';
        const escaped = escapeHtml(malicious);
        expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(escaped).not.toContain('<script>');
    });

    it('handles sequential segment lookup optimization', () => {
        // First lookup
        const idx1 = findActiveSegmentIndex(transcript, 15);
        expect(idx1).toBe(1);

        // Sequential forward lookup using lastIndex hint
        const idx2 = findActiveSegmentIndex(transcript, 30, idx1);
        expect(idx2).toBe(2);

        // Jump backwards
        const idx3 = findActiveSegmentIndex(transcript, 0, idx2);
        expect(idx3).toBe(0);
    });
});
