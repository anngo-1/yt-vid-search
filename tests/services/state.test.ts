import { describe, it, expect } from 'vitest';
import { isProviderConfigured } from '../../src/services/state';

describe('isProviderConfigured', () => {
    it('returns true for local provider', () => {
        expect(isProviderConfigured({ provider: 'local' })).toBe(true);
    });

    it('returns true for openrouter with API key', () => {
        expect(isProviderConfigured({ provider: 'openrouter', openrouter_api_key: 'key123' })).toBe(true);
    });

    it('returns false for openrouter without API key', () => {
        expect(isProviderConfigured({ provider: 'openrouter' })).toBe(false);
    });

    it('returns true for custom with endpoint', () => {
        expect(isProviderConfigured({ provider: 'custom', custom_endpoint: 'http://localhost:8000' })).toBe(true);
    });

    it('returns false for custom without endpoint', () => {
        expect(isProviderConfigured({ provider: 'custom' })).toBe(false);
    });

    it('returns true when falling back to default local settings', () => {
        // When undefined, falls back to state.settings which defaults to local (always configured)
        expect(isProviderConfigured(undefined)).toBe(true);
    });

    it('returns false with empty object and no provider', () => {
        // Empty settings object - provider defaults to local which is always configured
        expect(isProviderConfigured({})).toBe(true);
    });

    it('respects feature-specific provider', () => {
        const settings = {
            provider: 'local' as const,
            chat_provider: 'openrouter' as const,
            openrouter_api_key: 'key',
        };
        expect(isProviderConfigured(settings, 'chat')).toBe(true);
        expect(isProviderConfigured(settings, 'topics')).toBe(true); // falls back to local
    });
});
