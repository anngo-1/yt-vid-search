import { describe, it, expect } from 'vitest';
import { parseResponse, validateTopicsData, isAutoGenerateEnabled } from '../../src/features/topics';

describe('parseResponse', () => {
    it('parses valid JSON', () => {
        const response = JSON.stringify({
            topics: [
                {
                    title: 'Introduction',
                    timestamp: '[0:00]-[1:30]',
                    subtopics: [{ title: 'Welcome', timestamp: '[0:00]' }],
                },
            ],
        });

        const result = parseResponse(response);
        expect(result.topics).toHaveLength(1);
        expect(result.topics[0].title).toBe('Introduction');
        expect(result.topics[0].subtopics).toHaveLength(1);
    });

    it('parses markdown-wrapped JSON', () => {
        const response = `Here are the topics:
\`\`\`json
{
  "topics": [
    { "title": "Topic One", "timestamp": "[0:00]-[5:00]" }
  ]
}
\`\`\``;

        const result = parseResponse(response);
        expect(result.topics).toHaveLength(1);
        expect(result.topics[0].title).toBe('Topic One');
    });

    it('throws when no JSON found', () => {
        expect(() => parseResponse('no json here')).toThrow();
    });

    it('throws on invalid JSON', () => {
        expect(() => parseResponse('```json\n{invalid}\n```')).toThrow();
    });
});

describe('validateTopicsData', () => {
    it('validates correct structure', () => {
        const data = {
            topics: [
                {
                    title: 'Test',
                    timestamp: '[0:00]',
                    subtopics: [{ title: 'Sub', timestamp: '[0:30]' }],
                },
            ],
        };
        const result = validateTopicsData(data);
        expect(result.topics).toHaveLength(1);
        expect(result.topics[0].title).toBe('Test');
        expect(result.topics[0].subtopics).toHaveLength(1);
        expect(result.topics[0].subtopics![0].title).toBe('Sub');
    });

    it('normalizes topics without subtopics to empty array', () => {
        const data = {
            topics: [{ title: 'Test', timestamp: '[0:00]' }],
        };
        const result = validateTopicsData(data);
        expect(result.topics).toHaveLength(1);
        expect(result.topics[0].subtopics).toEqual([]);
    });

    it('throws on null', () => {
        expect(() => validateTopicsData(null)).toThrow('Invalid topics format');
    });

    it('throws when topics is not an array', () => {
        expect(() => validateTopicsData({ topics: 'not array' })).toThrow('Invalid topics format');
    });

    it('filters out topics missing title', () => {
        const result = validateTopicsData({ topics: [{ timestamp: '[0:00]' }] });
        expect(result.topics).toHaveLength(0);
    });

    it('filters out topics missing timestamp', () => {
        const result = validateTopicsData({ topics: [{ title: 'Test' }] });
        expect(result.topics).toHaveLength(0);
    });

    it('filters out invalid subtopics', () => {
        const data = {
            topics: [
                {
                    title: 'Test',
                    timestamp: '[0:00]',
                    subtopics: [{ title: 123 }],
                },
            ],
        };
        const result = validateTopicsData(data);
        expect(result.topics).toHaveLength(1);
        // Invalid subtopic is filtered out
        expect(result.topics[0].subtopics).toHaveLength(0);
    });
});

describe('isAutoGenerateEnabled', () => {
    it('returns a boolean', () => {
        const result = isAutoGenerateEnabled();
        expect(typeof result).toBe('boolean');
    });
});
