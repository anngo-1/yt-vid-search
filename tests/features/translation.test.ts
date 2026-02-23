import { describe, it, expect, vi } from 'vitest';
import {
    TRANSLATION_CONFIG,
    clearRetryState,
    invalidateTranslationRequests,
    setTranslationRowUpdater,
} from '../../src/features/translation';

// Mock chrome
vi.stubGlobal('chrome', {
    storage: {
        local: { set: vi.fn(), get: vi.fn() },
        session: { setAccessLevel: vi.fn() },
        onChanged: { addListener: vi.fn() },
    },
    runtime: {
        getURL: vi.fn(),
        sendMessage: vi.fn(),
        connect: vi.fn(() => ({
            postMessage: vi.fn(),
            disconnect: vi.fn(),
            onMessage: { addListener: vi.fn() },
            onDisconnect: { addListener: vi.fn() },
        })),
        onMessage: { addListener: vi.fn() },
    },
});

describe('TRANSLATION_CONFIG', () => {
    it('has reasonable defaults', () => {
        expect(TRANSLATION_CONFIG.chunkSize).toBeGreaterThan(0);
        expect(TRANSLATION_CONFIG.maxPending).toBeGreaterThan(TRANSLATION_CONFIG.chunkSize);
        expect(TRANSLATION_CONFIG.immediateBuffer).toBeGreaterThan(0);
        expect(TRANSLATION_CONFIG.lookaheadBuffer).toBeGreaterThan(TRANSLATION_CONFIG.immediateBuffer);
        expect(TRANSLATION_CONFIG.maxRetries).toBeGreaterThan(0);
    });

    it('has correct specific values', () => {
        expect(TRANSLATION_CONFIG.chunkSize).toBe(5);
        expect(TRANSLATION_CONFIG.maxPending).toBe(100);
        expect(TRANSLATION_CONFIG.immediateBuffer).toBe(10);
        expect(TRANSLATION_CONFIG.lookaheadBuffer).toBe(60);
        expect(TRANSLATION_CONFIG.refillThreshold).toBe(30);
        expect(TRANSLATION_CONFIG.maxRetries).toBe(3);
    });
});

describe('clearRetryState', () => {
    it('does not throw', () => {
        expect(() => clearRetryState()).not.toThrow();
    });

    it('can be called multiple times', () => {
        clearRetryState();
        clearRetryState();
    });
});

describe('invalidateTranslationRequests', () => {
    it('does not throw', () => {
        expect(() => invalidateTranslationRequests()).not.toThrow();
    });

    it('can be called multiple times', () => {
        invalidateTranslationRequests();
        invalidateTranslationRequests();
    });
});

describe('setTranslationRowUpdater', () => {
    it('accepts a function', () => {
        expect(() => setTranslationRowUpdater(() => {})).not.toThrow();
    });

    it('accepts null to clear', () => {
        expect(() => setTranslationRowUpdater(null)).not.toThrow();
    });
});
