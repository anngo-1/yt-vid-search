import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseTranscript } from '../../src/utils/transcript';
import { escapeHtml } from '../../src/content/selectors';
import { findActiveSegmentIndex } from '../../src/utils/transcript';
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
            <div id="yt-search-results"></div>
        `;

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

    it('searches transcript and highlights matches with DOM nodes', () => {
        const container = document.getElementById('yt-search-results')!;
        const query = 'function';
        const q = query.toLowerCase();
        const matches = transcript.filter((t) => t.text.toLowerCase().includes(q));

        expect(matches).toHaveLength(2);
        expect(matches[0].text).toBe('Functions are fundamental');
        expect(matches[1].text).toBe('Arrow functions simplify syntax');

        // Build results using DOM-based highlighting (same approach as refactored renderSearch)
        container.innerHTML = `<div class="yt-result-count">${matches.length} results</div>`;

        for (const m of matches) {
            const row = document.createElement('div');
            row.className = 'yt-row';
            row.dataset.seconds = String(m.seconds);

            const timeDiv = document.createElement('div');
            timeDiv.className = 'yt-time';
            timeDiv.textContent = m.time;

            const textDiv = document.createElement('div');
            textDiv.className = 'yt-text';

            // Highlight text using DOM nodes
            const lowerText = m.text.toLowerCase();
            const lowerQuery = query.toLowerCase();
            let lastIndex = 0;
            let pos = lowerText.indexOf(lowerQuery, lastIndex);
            while (pos !== -1) {
                if (pos > lastIndex) {
                    textDiv.appendChild(document.createTextNode(m.text.slice(lastIndex, pos)));
                }
                const mark = document.createElement('mark');
                mark.textContent = m.text.slice(pos, pos + query.length);
                textDiv.appendChild(mark);
                lastIndex = pos + query.length;
                pos = lowerText.indexOf(lowerQuery, lastIndex);
            }
            if (lastIndex < m.text.length) {
                textDiv.appendChild(document.createTextNode(m.text.slice(lastIndex)));
            }

            row.append(timeDiv, textDiv);
            container.appendChild(row);
        }

        const resultRows = container.querySelectorAll('.yt-row');
        expect(resultRows.length).toBe(2);

        // Check highlighting
        const marks = container.querySelectorAll('mark');
        expect(marks.length).toBe(2);
        expect(marks[0].textContent).toBe('Function');
        expect(marks[1].textContent).toBe('function');
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
