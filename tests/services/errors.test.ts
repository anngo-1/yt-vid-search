import { describe, it, expect } from 'vitest';
import { AppError, ApiError, TranscriptParseError } from '../../src/services/errors';

describe('error hierarchy', () => {
    it('AppError has code and extends Error', () => {
        const err = new AppError('test', 'TEST_CODE');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
        expect(err.message).toBe('test');
        expect(err.code).toBe('TEST_CODE');
        expect(err.name).toBe('AppError');
    });

    it('ApiError has status and provider', () => {
        const err = new ApiError('api failed', { status: 429, provider: 'openrouter' });
        expect(err).toBeInstanceOf(AppError);
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe('API_ERROR');
        expect(err.status).toBe(429);
        expect(err.provider).toBe('openrouter');
        expect(err.name).toBe('ApiError');
    });

    it('ApiError works without options', () => {
        const err = new ApiError('simple error');
        expect(err.status).toBeUndefined();
        expect(err.provider).toBeUndefined();
    });

    it('TranscriptParseError stores raw data', () => {
        const raw = { actions: [] };
        const err = new TranscriptParseError('parse failed', raw);
        expect(err).toBeInstanceOf(AppError);
        expect(err.code).toBe('TRANSCRIPT_PARSE_ERROR');
        expect(err.rawData).toBe(raw);
        expect(err.name).toBe('TranscriptParseError');
    });

    it('errors are catchable as Error', () => {
        try {
            throw new ApiError('test');
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
            expect((e as ApiError).code).toBe('API_ERROR');
        }
    });
});
