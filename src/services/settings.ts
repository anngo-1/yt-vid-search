import type { Settings } from '@/types';
import { isLLMProvider, isFiniteNumber } from '@/services/validators';

export const STORAGE_KEYS: (keyof Settings)[] = [
    'provider',
    'temperature',
    'chat_provider',
    'chat_model',
    'topics_provider',
    'topics_model',
    'captions_provider',
    'captions_model',
    'openrouter_api_key',
    'openrouter_model',
    'local_port',
    'local_model',
    'custom_endpoint',
    'custom_api_key',
    'custom_model',
    'fast_followups', // kept for storage compat
    'chat_direct_mode',
    'chat_no_history',
    'auto_generate_topics',
    'auto_open_transcript',
    'translation_lookahead_buffer',
    'translation_refill_threshold',
    'translation_max_concurrent',
];

export function normalizeSettings(data: Record<string, unknown>): Settings {
    const provider = isLLMProvider(data.provider) ? data.provider : 'local';

    return {
        provider,
        temperature: isFiniteNumber(data.temperature) ? data.temperature : undefined,

        chat_provider: isLLMProvider(data.chat_provider) ? data.chat_provider : provider,
        chat_model: typeof data.chat_model === 'string' ? data.chat_model : undefined,

        topics_provider: isLLMProvider(data.topics_provider) ? data.topics_provider : provider,
        topics_model: typeof data.topics_model === 'string' ? data.topics_model : undefined,

        captions_provider: isLLMProvider(data.captions_provider) ? data.captions_provider : provider,
        captions_model: typeof data.captions_model === 'string' ? data.captions_model : undefined,

        openrouter_api_key: typeof data.openrouter_api_key === 'string' ? data.openrouter_api_key : undefined,
        openrouter_model: typeof data.openrouter_model === 'string' ? data.openrouter_model : undefined,

        local_port: isFiniteNumber(data.local_port) ? data.local_port : undefined,
        local_model: typeof data.local_model === 'string' ? data.local_model : undefined,

        custom_endpoint: typeof data.custom_endpoint === 'string' ? data.custom_endpoint : undefined,
        custom_api_key: typeof data.custom_api_key === 'string' ? data.custom_api_key : undefined,
        custom_model: typeof data.custom_model === 'string' ? data.custom_model : undefined,

        fast_followups: undefined, // deprecated
        chat_direct_mode: data.chat_direct_mode === false ? false : true, // default ON
        chat_no_history: data.chat_no_history === true ? true : undefined,
        auto_generate_topics: data.auto_generate_topics === true,
        auto_open_transcript: data.auto_open_transcript === true ? true : undefined,

        translation_lookahead_buffer: isFiniteNumber(data.translation_lookahead_buffer)
            ? data.translation_lookahead_buffer
            : undefined,
        translation_refill_threshold: isFiniteNumber(data.translation_refill_threshold)
            ? data.translation_refill_threshold
            : undefined,
        translation_max_concurrent: isFiniteNumber(data.translation_max_concurrent)
            ? data.translation_max_concurrent
            : undefined,
    };
}
