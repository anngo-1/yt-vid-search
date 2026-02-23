import { describe, it, expect } from 'vitest';
import {
    isApiRequest,
    isApiAbort,
    isApiStream,
    isOpenPanelMessage,
    isFiniteNumber,
    isBoolean,
    isCenterPosition,
    isOldPosition,
    isCaptionPosition,
    isSize,
    isLLMProvider,
} from '../../src/services/validators';

describe('message guards', () => {
    describe('isApiRequest', () => {
        it('accepts valid API_REQUEST', () => {
            expect(isApiRequest({ type: 'API_REQUEST', url: 'http://example.com', options: {} })).toBe(true);
        });
        it('rejects missing url', () => {
            expect(isApiRequest({ type: 'API_REQUEST' })).toBe(false);
        });
        it('rejects wrong type', () => {
            expect(isApiRequest({ type: 'API_ABORT', url: 'http://x' })).toBe(false);
        });
        it('rejects non-object', () => {
            expect(isApiRequest('string')).toBe(false);
            expect(isApiRequest(null)).toBe(false);
            expect(isApiRequest(42)).toBe(false);
        });
    });

    describe('isApiAbort', () => {
        it('accepts valid API_ABORT', () => {
            expect(isApiAbort({ type: 'API_ABORT', requestId: 'abc' })).toBe(true);
        });
        it('rejects missing requestId', () => {
            expect(isApiAbort({ type: 'API_ABORT' })).toBe(false);
        });
        it('rejects numeric requestId', () => {
            expect(isApiAbort({ type: 'API_ABORT', requestId: 123 })).toBe(false);
        });
    });

    describe('isApiStream', () => {
        it('accepts valid API_STREAM', () => {
            expect(isApiStream({ type: 'API_STREAM', url: 'http://example.com', options: {} })).toBe(true);
        });
        it('rejects wrong type', () => {
            expect(isApiStream({ type: 'API_REQUEST', url: 'http://x' })).toBe(false);
        });
    });

    describe('isOpenPanelMessage', () => {
        it('accepts valid OPEN_PANEL', () => {
            expect(isOpenPanelMessage({ type: 'OPEN_PANEL' })).toBe(true);
        });
        it('rejects wrong type', () => {
            expect(isOpenPanelMessage({ type: 'CLOSE_PANEL' })).toBe(false);
        });
        it('rejects null', () => {
            expect(isOpenPanelMessage(null)).toBe(false);
        });
    });
});

describe('storage guards', () => {
    describe('isFiniteNumber', () => {
        it('accepts finite numbers', () => {
            expect(isFiniteNumber(42)).toBe(true);
            expect(isFiniteNumber(0)).toBe(true);
            expect(isFiniteNumber(-3.14)).toBe(true);
        });
        it('rejects Infinity and NaN', () => {
            expect(isFiniteNumber(Infinity)).toBe(false);
            expect(isFiniteNumber(-Infinity)).toBe(false);
            expect(isFiniteNumber(NaN)).toBe(false);
        });
        it('rejects non-numbers', () => {
            expect(isFiniteNumber('42')).toBe(false);
            expect(isFiniteNumber(null)).toBe(false);
            expect(isFiniteNumber(undefined)).toBe(false);
        });
    });

    describe('isBoolean', () => {
        it('accepts booleans', () => {
            expect(isBoolean(true)).toBe(true);
            expect(isBoolean(false)).toBe(true);
        });
        it('rejects non-booleans', () => {
            expect(isBoolean(0)).toBe(false);
            expect(isBoolean(1)).toBe(false);
            expect(isBoolean('true')).toBe(false);
            expect(isBoolean(null)).toBe(false);
        });
    });

    describe('isCenterPosition', () => {
        it('accepts valid center position', () => {
            expect(isCenterPosition({ centerX: 100, centerY: 200 })).toBe(true);
        });
        it('rejects non-finite values', () => {
            expect(isCenterPosition({ centerX: NaN, centerY: 200 })).toBe(false);
        });
        it('rejects missing properties', () => {
            expect(isCenterPosition({ centerX: 100 })).toBe(false);
        });
    });

    describe('isOldPosition', () => {
        it('accepts valid old position', () => {
            expect(isOldPosition({ top: 10, left: 20 })).toBe(true);
        });
        it('rejects missing properties', () => {
            expect(isOldPosition({ top: 10 })).toBe(false);
        });
    });

    describe('isCaptionPosition', () => {
        it('accepts center position', () => {
            expect(isCaptionPosition({ centerX: 100, centerY: 200 })).toBe(true);
        });
        it('accepts old position', () => {
            expect(isCaptionPosition({ top: 10, left: 20 })).toBe(true);
        });
        it('rejects invalid objects', () => {
            expect(isCaptionPosition({ x: 1, y: 2 })).toBe(false);
        });
    });

    describe('isSize', () => {
        it('accepts valid size', () => {
            expect(isSize({ width: 600, height: 120 })).toBe(true);
        });
        it('rejects non-finite dimensions', () => {
            expect(isSize({ width: Infinity, height: 120 })).toBe(false);
        });
        it('rejects non-objects', () => {
            expect(isSize(null)).toBe(false);
            expect(isSize([600, 120])).toBe(false);
        });
    });

    describe('isLLMProvider', () => {
        it('accepts valid providers', () => {
            expect(isLLMProvider('local')).toBe(true);
            expect(isLLMProvider('openrouter')).toBe(true);
            expect(isLLMProvider('custom')).toBe(true);
        });
        it('rejects invalid strings', () => {
            expect(isLLMProvider('invalid')).toBe(false);
            expect(isLLMProvider('')).toBe(false);
        });
        it('rejects non-strings', () => {
            expect(isLLMProvider(42)).toBe(false);
            expect(isLLMProvider(null)).toBe(false);
        });
    });
});
