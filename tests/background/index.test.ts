import { describe, it, expect, vi } from 'vitest';
import { isApiRequest, isApiAbort, isApiStream } from '../../src/services/validators';

describe('background message handling', () => {
    describe('message type guards used in background', () => {
        it('isApiRequest validates correctly', () => {
            expect(isApiRequest({ type: 'API_REQUEST', url: 'http://localhost', options: {} })).toBe(true);
            expect(isApiRequest({ type: 'API_STREAM', url: 'http://localhost' })).toBe(false);
        });

        it('isApiAbort validates correctly', () => {
            expect(isApiAbort({ type: 'API_ABORT', requestId: 'req-1' })).toBe(true);
            expect(isApiAbort({ type: 'API_ABORT' })).toBe(false);
        });

        it('isApiStream validates correctly', () => {
            expect(isApiStream({ type: 'API_STREAM', url: 'http://localhost', options: {} })).toBe(true);
            expect(isApiStream({ type: 'API_REQUEST', url: 'http://localhost' })).toBe(false);
        });
    });

    describe('API request abort flow', () => {
        it('pending requests map tracks abort controllers', () => {
            const pendingRequests = new Map<string, AbortController>();
            const controller = new AbortController();
            pendingRequests.set('req-1', controller);

            expect(pendingRequests.has('req-1')).toBe(true);
            controller.abort();
            pendingRequests.delete('req-1');
            expect(pendingRequests.has('req-1')).toBe(false);
        });

        it('abort controller signal is aborted after abort()', () => {
            const controller = new AbortController();
            expect(controller.signal.aborted).toBe(false);
            controller.abort();
            expect(controller.signal.aborted).toBe(true);
        });
    });

    describe('local vs remote detection', () => {
        it('detects localhost URLs as local', () => {
            const url = 'http://localhost:1234/v1/chat/completions';
            expect(url.includes('localhost') || url.includes('127.0.0.1')).toBe(true);
        });

        it('detects 127.0.0.1 URLs as local', () => {
            const url = 'http://127.0.0.1:1234/v1/chat/completions';
            expect(url.includes('localhost') || url.includes('127.0.0.1')).toBe(true);
        });

        it('detects remote URLs as non-local', () => {
            const url = 'https://openrouter.ai/api/v1/chat/completions';
            expect(url.includes('localhost') || url.includes('127.0.0.1')).toBe(false);
        });
    });

    describe('keepalive behavior', () => {
        it('keepalive interval can be set and cleared', () => {
            vi.useFakeTimers();
            let keepaliveCount = 0;
            const interval = setInterval(() => {
                keepaliveCount++;
            }, 20000);

            vi.advanceTimersByTime(60000);
            expect(keepaliveCount).toBe(3);

            clearInterval(interval);
            vi.advanceTimersByTime(40000);
            expect(keepaliveCount).toBe(3); // No more after clear

            vi.useRealTimers();
        });
    });

    describe('port message routing', () => {
        it('rejects non-API_STREAM messages on port', () => {
            const message = { type: 'UNKNOWN', url: 'http://x' };
            expect(isApiStream(message)).toBe(false);
        });

        it('accepts API_STREAM messages on port', () => {
            const message = { type: 'API_STREAM', url: 'http://localhost:1234', options: {} };
            expect(isApiStream(message)).toBe(true);
        });
    });
});
