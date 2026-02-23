import { describe, it, expect } from 'vitest';
import { resolveProvider, resolveModel } from '../../src/utils/llm';
import type { Settings } from '../../src/types';

describe('resolveProvider', () => {
    it('returns default provider when no feature specified', () => {
        expect(resolveProvider({ provider: 'openrouter' })).toBe('openrouter');
    });

    it('defaults to local when no provider set', () => {
        expect(resolveProvider({})).toBe('local');
    });

    it('returns per-feature override for chat', () => {
        const settings: Settings = { provider: 'local', chat_provider: 'openrouter' };
        expect(resolveProvider(settings, 'chat')).toBe('openrouter');
    });

    it('returns per-feature override for topics', () => {
        const settings: Settings = { provider: 'local', topics_provider: 'custom' };
        expect(resolveProvider(settings, 'topics')).toBe('custom');
    });

    it('returns per-feature override for captions', () => {
        const settings: Settings = { provider: 'local', captions_provider: 'openrouter' };
        expect(resolveProvider(settings, 'captions')).toBe('openrouter');
    });

    it('falls back to default provider when feature provider not set', () => {
        const settings: Settings = { provider: 'openrouter' };
        expect(resolveProvider(settings, 'chat')).toBe('openrouter');
        expect(resolveProvider(settings, 'topics')).toBe('openrouter');
        expect(resolveProvider(settings, 'captions')).toBe('openrouter');
    });
});

describe('resolveModel', () => {
    it('returns per-feature model when set', () => {
        const settings: Settings = {
            provider: 'openrouter',
            chat_model: 'my-chat-model',
            openrouter_model: 'default-or-model',
        };
        expect(resolveModel(settings, 'chat')).toBe('my-chat-model');
    });

    it('falls back to provider default model', () => {
        const settings: Settings = { provider: 'openrouter', openrouter_model: 'gpt-4o' };
        expect(resolveModel(settings, 'chat')).toBe('gpt-4o');
    });

    it('returns hardcoded default for openrouter', () => {
        expect(resolveModel({ provider: 'openrouter' }, 'chat')).toBe('openai/gpt-4o-mini');
    });

    it('returns hardcoded default for local', () => {
        expect(resolveModel({ provider: 'local' }, 'chat')).toBe('local-model');
    });

    it('returns hardcoded default for custom', () => {
        expect(resolveModel({ provider: 'custom' }, 'chat')).toBe('gpt-4');
    });

    it('uses local_model when set', () => {
        const settings: Settings = { provider: 'local', local_model: 'my-llama' };
        expect(resolveModel(settings, 'chat')).toBe('my-llama');
    });

    it('uses custom_model when set', () => {
        const settings: Settings = { provider: 'custom', custom_model: 'my-custom' };
        expect(resolveModel(settings, 'chat')).toBe('my-custom');
    });

    it('per-feature model takes priority over provider default', () => {
        const settings: Settings = {
            provider: 'openrouter',
            openrouter_model: 'default',
            topics_model: 'topics-specific',
        };
        expect(resolveModel(settings, 'topics')).toBe('topics-specific');
    });
});
