/**
 * llm - shared utilities for provider and model resolution
 */

import type { Settings, LLMProvider } from '@/types';

export type ApiFeature = 'chat' | 'topics' | 'captions';

/** resolve the effective provider for a specific feature */
export function resolveProvider(settings: Settings, feature?: ApiFeature): LLMProvider {
    const provider = settings.provider || 'local';
    if (feature === 'chat') return settings.chat_provider || provider;
    if (feature === 'topics') return settings.topics_provider || provider;
    if (feature === 'captions') return settings.captions_provider || provider;
    return provider;
}

/** resolve the effective model for a specific feature */
export function resolveModel(settings: Settings, feature?: ApiFeature): string {
    const provider = resolveProvider(settings, feature);
    let modelOverride = '';

    if (feature === 'chat') modelOverride = settings.chat_model || '';
    else if (feature === 'topics') modelOverride = settings.topics_model || '';
    else if (feature === 'captions') modelOverride = settings.captions_model || '';

    if (modelOverride) return modelOverride;

    switch (provider) {
        case 'local':
            return settings.local_model || 'local-model';
        case 'openrouter':
            return settings.openrouter_model || 'openai/gpt-4o-mini';
        case 'custom':
            return settings.custom_model || 'gpt-4';
        default:
            return 'openai/gpt-4o-mini';
    }
}
