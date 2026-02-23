import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubGlobal('chrome', {
    storage: {
        local: { set: vi.fn(), get: vi.fn() },
        session: { setAccessLevel: vi.fn() },
        onChanged: { addListener: vi.fn() },
    },
    runtime: { getURL: vi.fn(), onMessage: { addListener: vi.fn() } },
});

import { showToast } from '../../src/services/notifications';
import { TOAST_DISPLAY_MS, TOAST_FADE_MS } from '../../src/utils/constants';

describe('showToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates toast element on first call', () => {
        showToast('hello');
        const toast = document.getElementById('yt-toast');
        expect(toast).not.toBeNull();
        expect(toast!.id).toBe('yt-toast');
        expect(toast!.className).toContain('yt-toast');
    });

    it('sets message text', () => {
        showToast('something went wrong');
        const toast = document.getElementById('yt-toast');
        expect(toast!.textContent).toBe('something went wrong');
    });

    it('applies error class for type=error', () => {
        showToast('fail', 'error');
        const toast = document.getElementById('yt-toast')!;
        expect(toast.classList.contains('yt-toast-error')).toBe(true);
        expect(toast.classList.contains('yt-toast-info')).toBe(false);
    });

    it('applies info class for type=info', () => {
        showToast('notice', 'info');
        const toast = document.getElementById('yt-toast')!;
        expect(toast.classList.contains('yt-toast-info')).toBe(true);
        expect(toast.classList.contains('yt-toast-error')).toBe(false);
    });

    it('defaults to error type when type is omitted', () => {
        showToast('oops');
        const toast = document.getElementById('yt-toast')!;
        expect(toast.classList.contains('yt-toast-error')).toBe(true);
        expect(toast.classList.contains('yt-toast-info')).toBe(false);
    });

    it('reuses existing toast element', () => {
        showToast('first');
        const toast1 = document.getElementById('yt-toast');
        showToast('second');
        const toast2 = document.getElementById('yt-toast');
        expect(toast1).toBe(toast2);
        expect(toast2!.textContent).toBe('second');
        expect(document.querySelectorAll('#yt-toast').length).toBe(1);
    });

    it('does not throw when document.body is null', () => {
        const originalBody = document.body;
        Object.defineProperty(document, 'body', { value: null, writable: true, configurable: true });
        expect(() => showToast('no body')).not.toThrow();
        Object.defineProperty(document, 'body', { value: originalBody, writable: true, configurable: true });
    });

    it('adds active class via requestAnimationFrame', () => {
        showToast('activate');
        const toast = document.getElementById('yt-toast')!;
        expect(toast.classList.contains('active')).toBe(false);

        vi.advanceTimersByTime(16);

        expect(toast.classList.contains('active')).toBe(true);
    });

    it('removes active class after TOAST_DISPLAY_MS', () => {
        showToast('dismiss me');
        const toast = document.getElementById('yt-toast')!;

        // Trigger RAF to add active
        vi.advanceTimersByTime(16);
        expect(toast.classList.contains('active')).toBe(true);

        // Advance past the display timeout
        vi.advanceTimersByTime(TOAST_DISPLAY_MS);
        expect(toast.classList.contains('active')).toBe(false);
    });

    it('removes toast element from DOM after fade completes', () => {
        showToast('vanish');
        vi.advanceTimersByTime(0);

        vi.advanceTimersByTime(TOAST_DISPLAY_MS);
        expect(document.getElementById('yt-toast')).not.toBeNull();

        vi.advanceTimersByTime(TOAST_FADE_MS);
        expect(document.getElementById('yt-toast')).toBeNull();
    });

    it('resets dismiss timer when called again before timeout', () => {
        showToast('first');
        vi.advanceTimersByTime(0);

        // Advance partway through the display timeout
        vi.advanceTimersByTime(TOAST_DISPLAY_MS - 500);
        const toast = document.getElementById('yt-toast')!;
        expect(toast.classList.contains('active')).toBe(true);

        // Call again, resetting the timer
        showToast('second');
        vi.advanceTimersByTime(0);

        // Advance another TOAST_DISPLAY_MS - 500; original timer would have fired by now
        vi.advanceTimersByTime(TOAST_DISPLAY_MS - 500);
        expect(toast.classList.contains('active')).toBe(true);
        expect(toast.textContent).toBe('second');

        // Now advance the remaining 500ms to trigger the new timer
        vi.advanceTimersByTime(500);
        expect(toast.classList.contains('active')).toBe(false);
    });

    it('switches type classes when called with different types', () => {
        showToast('error first', 'error');
        const toast = document.getElementById('yt-toast')!;
        expect(toast.classList.contains('yt-toast-error')).toBe(true);
        expect(toast.classList.contains('yt-toast-info')).toBe(false);

        showToast('info now', 'info');
        expect(toast.classList.contains('yt-toast-info')).toBe(true);
        expect(toast.classList.contains('yt-toast-error')).toBe(false);
    });
});
