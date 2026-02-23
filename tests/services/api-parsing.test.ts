import { describe, it, expect } from 'vitest';
import {
    extractSSEEvents,
    parseSSEData,
    parseTranslationResponse,
    normalizeTranslationMap,
} from '../../src/services/api';

describe('extractSSEEvents', () => {
    it('extracts events from normal SSE data', () => {
        const input =
            'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n';
        const result = extractSSEEvents(input, []);
        expect(result.events).toEqual([
            '{"choices":[{"delta":{"content":"hello"}}]}',
            '{"choices":[{"delta":{"content":" world"}}]}',
        ]);
        expect(result.rest).toBe('');
    });

    it('handles split chunks across calls', () => {
        // First chunk ends mid-line - rest carries over
        const result1 = extractSSEEvents('data: {"choices":[{"delta":{"content":"he', []);
        expect(result1.events).toEqual([]);
        expect(result1.rest).toBe('data: {"choices":[{"delta":{"content":"he');

        // Second chunk: combine rest + new data and parse
        const combined = result1.rest + 'llo"}}]}\n\n';
        const result2 = extractSSEEvents(combined, result1.eventData);
        expect(result2.events).toEqual(['{"choices":[{"delta":{"content":"hello"}}]}']);
    });

    it('handles [DONE] event', () => {
        const input = 'data: [DONE]\n\n';
        const result = extractSSEEvents(input, []);
        expect(result.events).toEqual(['[DONE]']);
    });

    it('handles empty lines between events', () => {
        const input = 'data: first\n\n\ndata: second\n\n';
        const result = extractSSEEvents(input, []);
        expect(result.events).toEqual(['first', 'second']);
    });

    it('preserves incomplete data in rest', () => {
        const input = 'data: complete\n\ndata: incomp';
        const result = extractSSEEvents(input, []);
        expect(result.events).toEqual(['complete']);
        expect(result.rest).toBe('data: incomp');
    });

    it('handles eventData accumulation', () => {
        // Carry over from a previous call
        const result = extractSSEEvents('\n\n', ['partial data']);
        expect(result.events).toEqual(['partial data']);
    });
});

describe('parseSSEData', () => {
    it('extracts content from valid JSON', () => {
        const data = '{"choices":[{"delta":{"content":"hello"}}]}';
        expect(parseSSEData(data)).toBe('hello');
    });

    it('returns null for malformed JSON', () => {
        expect(parseSSEData('not json')).toBeNull();
    });

    it('returns [DONE] for done signal', () => {
        expect(parseSSEData('[DONE]')).toBe('[DONE]');
        expect(parseSSEData('  [DONE]  ')).toBe('[DONE]');
    });

    it('returns null for empty string', () => {
        expect(parseSSEData('')).toBeNull();
    });

    it('returns null when no content in delta', () => {
        const data = '{"choices":[{"delta":{}}]}';
        expect(parseSSEData(data)).toBeNull();
    });
});

describe('parseTranslationResponse', () => {
    it('parses clean JSON', () => {
        const response = '{"0": "Hello", "1": "World"}';
        const result = parseTranslationResponse(response);
        expect(result).toEqual({ 0: 'Hello', 1: 'World' });
    });

    it('parses markdown-wrapped JSON', () => {
        const response = '```json\n{"0": "Hola", "1": "Mundo"}\n```';
        const result = parseTranslationResponse(response);
        expect(result).toEqual({ 0: 'Hola', 1: 'Mundo' });
    });

    it('uses regex fallback for messy responses', () => {
        const response = 'Here are the translations:\n"0": "Bonjour"\n"1": "le monde"';
        const result = parseTranslationResponse(response);
        expect(result).toEqual({ 0: 'Bonjour', 1: 'le monde' });
    });

    it('throws on empty response', () => {
        expect(() => parseTranslationResponse('')).toThrow();
    });

    it('handles JSON with extra text around it', () => {
        const response = 'Translations:\n\n{"5": "text five", "6": "text six"}\n\nDone.';
        const result = parseTranslationResponse(response);
        expect(result).toEqual({ 5: 'text five', 6: 'text six' });
    });
});

describe('normalizeTranslationMap', () => {
    it('normalizes valid map', () => {
        const result = normalizeTranslationMap({ '0': 'hello', '1': 'world' });
        expect(result).toEqual({ 0: 'hello', 1: 'world' });
    });

    it('filters out non-string values', () => {
        const result = normalizeTranslationMap({ '0': 'hello', '1': 123, '2': null });
        expect(result).toEqual({ 0: 'hello' });
    });

    it('throws on empty map', () => {
        expect(() => normalizeTranslationMap({ '0': 123 })).toThrow('Invalid translation response format');
    });

    it('throws on null input', () => {
        expect(() => normalizeTranslationMap(null)).toThrow('Invalid translation response format');
    });

    it('throws on array input', () => {
        expect(() => normalizeTranslationMap(['a', 'b'])).toThrow('Invalid translation response format');
    });
});
