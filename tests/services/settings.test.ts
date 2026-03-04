import { describe, it, expect } from 'vitest';
import { normalizeSettings, STORAGE_KEYS } from '../../src/services/settings';

describe('normalizeSettings', () => {
    it('normalizes full data', () => {
        const data = {
            provider: 'openrouter',
            temperature: 0.5,
            chat_provider: 'local',
            chat_model: 'gpt-4',
            topics_provider: 'custom',
            topics_model: 'claude',
            captions_provider: 'openrouter',
            captions_model: 'whisper',
            openrouter_api_key: 'key123',
            openrouter_model: 'or-model',
            local_port: 5000,
            local_model: 'llama',
            custom_endpoint: 'http://api.test',
            custom_api_key: 'ckey',
            custom_model: 'cmodel',
            fast_followups: true,
            auto_generate_topics: true,
        };

        const result = normalizeSettings(data);

        expect(result.provider).toBe('openrouter');
        expect(result.temperature).toBe(0.5);
        expect(result.chat_provider).toBe('local');
        expect(result.chat_model).toBe('gpt-4');
        expect(result.topics_provider).toBe('custom');
        expect(result.captions_provider).toBe('openrouter');
        expect(result.openrouter_api_key).toBe('key123');
        expect(result.local_port).toBe(5000);
        expect(result.custom_endpoint).toBe('http://api.test');
        expect(result.fast_followups).toBeUndefined(); // deprecated
        expect(result.chat_no_history).toBeUndefined();
        expect(result.auto_generate_topics).toBe(true);
    });

    it('provides defaults for missing fields', () => {
        const result = normalizeSettings({});

        expect(result.provider).toBe('local');
        expect(result.chat_provider).toBe('local');
        expect(result.topics_provider).toBe('local');
        expect(result.captions_provider).toBe('local');
        expect(result.chat_direct_mode).toBe(true); // default ON
        expect(result.auto_generate_topics).toBe(false);
    });

    it('falls back feature providers to main provider', () => {
        const result = normalizeSettings({ provider: 'openrouter' });

        expect(result.chat_provider).toBe('openrouter');
        expect(result.topics_provider).toBe('openrouter');
        expect(result.captions_provider).toBe('openrouter');
    });

    it('handles undefined temperature', () => {
        const result = normalizeSettings({});
        expect(result.temperature).toBeUndefined();
    });

    it('auto_generate_topics is false unless explicitly true', () => {
        expect(normalizeSettings({ auto_generate_topics: false }).auto_generate_topics).toBe(false);
        expect(normalizeSettings({ auto_generate_topics: 'yes' }).auto_generate_topics).toBe(false);
        expect(normalizeSettings({ auto_generate_topics: 1 }).auto_generate_topics).toBe(false);
        expect(normalizeSettings({ auto_generate_topics: true }).auto_generate_topics).toBe(true);
    });
});

describe('STORAGE_KEYS', () => {
    it('contains all expected keys', () => {
        expect(STORAGE_KEYS).toContain('provider');
        expect(STORAGE_KEYS).toContain('openrouter_api_key');
        expect(STORAGE_KEYS).toContain('fast_followups');
        expect(STORAGE_KEYS).toContain('auto_generate_topics');
    });

    it('has no duplicates', () => {
        const unique = new Set(STORAGE_KEYS);
        expect(unique.size).toBe(STORAGE_KEYS.length);
    });
});
