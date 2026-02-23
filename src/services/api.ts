/**
 * api - api client with support for multiple providers
 * All requests are proxied through the background script to avoid CORS issues
 */

import type { Settings, ChatMessage } from '@/types';
import { resolveProvider, resolveModel, type ApiFeature } from '@/utils/llm';
import { ApiError } from '@/services/errors';
import { isApiResponse } from '@/services/validators';

/** Discriminated union for port messages from background script */
export type PortMessage =
    | { type: 'chunk'; data?: string; error?: undefined }
    | { type: 'done'; data?: string; error?: undefined }
    | { type: 'error'; data?: undefined; error?: string };

/** Type guard for PortMessage */
export function isPortMessage(value: unknown): value is PortMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const msg = value as Record<string, unknown>;
    return msg.type === 'chunk' || msg.type === 'done' || msg.type === 'error';
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_LOCAL_PORT = 1234;
const DEFAULT_TEMP = 0.7;

/**
 * Mutable state for tracking active streams and requests.
 * - Created at module load; survives video changes.
 * - `streamCounters` / `streamPorts`: keyed by feature (e.g., 'default', 'captions').
 *   Each new streamCompletion() call increments the counter and disconnects the previous port.
 * - `completionRequestIds`: keyed by feature. Each new completion() aborts the previous request.
 * - All entries are self-cleaning: cleaned up in response handlers or on new calls.
 */
const apiState = {
    streamCounters: {} as Record<string, number>,
    streamPorts: {} as Record<string, chrome.runtime.Port | undefined>,
    completionRequestIds: {} as Record<string, string | undefined>,
};

function getApiUrl(settings: Settings, feature?: ApiFeature): string {
    const provider = resolveProvider(settings, feature);

    switch (provider) {
        case 'local': {
            const port = settings.local_port || DEFAULT_LOCAL_PORT;
            return `http://localhost:${port}/v1/chat/completions`;
        }
        case 'openrouter':
            return OPENROUTER_URL;
        case 'custom':
            return settings.custom_endpoint || '';
        default:
            return OPENROUTER_URL;
    }
}

function getHeaders(settings: Settings, feature?: ApiFeature): Record<string, string> {
    const provider = resolveProvider(settings, feature);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (provider === 'openrouter' && settings.openrouter_api_key) {
        headers['Authorization'] = `Bearer ${settings.openrouter_api_key}`;
        headers['X-Title'] = 'Ask Transcript';
    } else if (provider === 'custom' && settings.custom_api_key) {
        headers['Authorization'] = `Bearer ${settings.custom_api_key}`;
    }

    return headers;
}

function validateSettings(settings: Settings, feature?: ApiFeature): void {
    const provider = resolveProvider(settings, feature);

    if (provider === 'openrouter' && !settings.openrouter_api_key) {
        throw new ApiError(
            `OpenRouter API key not found for ${feature || 'generic'} feature. Please set it in extension settings.`,
            { provider: 'openrouter' },
        );
    }
    if (provider === 'custom' && !settings.custom_endpoint) {
        throw new ApiError(
            `Custom endpoint URL not configured for ${feature || 'generic'} feature. Please set it in extension settings.`,
            { provider: 'custom' },
        );
    }
}

interface StreamOptions {
    messages: ChatMessage[];
    settings: Settings;
    onChunk: (text: string) => void;
    temperature?: number;
    feature?: ApiFeature;
    signal?: AbortSignal;
}

/** stream response from LLM provider via background script, returns full response when complete */
export async function streamCompletion({
    messages,
    settings,
    onChunk,
    temperature,
    feature,
    signal,
}: StreamOptions): Promise<string> {
    validateSettings(settings, feature);

    const streamKey = feature || 'default';
    const streamId = (apiState.streamCounters[streamKey] || 0) + 1;
    apiState.streamCounters[streamKey] = streamId;

    const previousPort = apiState.streamPorts[streamKey];
    if (previousPort) previousPort.disconnect();

    const apiUrl = getApiUrl(settings, feature);
    const headers = getHeaders(settings, feature);
    const model = resolveModel(settings, feature);

    const body = JSON.stringify({
        model,
        messages,
        temperature: temperature ?? settings.temperature ?? DEFAULT_TEMP,
        stream: true,
    });

    return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect(undefined, { name: 'api-stream' });
        apiState.streamPorts[streamKey] = port;
        let buffer = '';
        let eventData: string[] = [];
        let result = '';

        /** Process SSE events from buffer, returning true if stream is done */
        const processBuffer = (extraData?: string): boolean => {
            if (extraData) buffer += extraData;
            const parsed = extractSSEEvents(buffer, eventData);
            buffer = parsed.rest;
            eventData = parsed.eventData;

            for (const event of parsed.events) {
                if (event === '[DONE]') return true;
                const content = parseSSEData(event);
                if (content) {
                    result += content;
                    onChunk(content);
                }
            }
            return false;
        };

        const cleanup = () => {
            port.disconnect();
            apiState.streamPorts[streamKey] = undefined;
        };

        if (signal) {
            signal.addEventListener(
                'abort',
                () => {
                    cleanup();
                    resolve(result);
                },
                { once: true },
            );
        }

        port.onMessage.addListener((message: unknown) => {
            if (apiState.streamCounters[streamKey] !== streamId) {
                port.disconnect();
                return;
            }
            if (!isPortMessage(message)) return;

            if (message.type === 'chunk') {
                if (processBuffer(message.data || '')) {
                    cleanup();
                    resolve(result);
                }
            } else if (message.type === 'done') {
                processBuffer();
                cleanup();
                resolve(result);
            } else if (message.type === 'error') {
                cleanup();
                const errorMsg = tryParseError(message.error || '') || message.error || 'Unknown error';
                reject(new ApiError(errorMsg));
            }
        });

        port.postMessage({
            type: 'API_STREAM',
            url: apiUrl,
            options: {
                method: 'POST',
                headers,
                body,
            },
        });
    });
}

/** non-streaming completion via background script */
export async function completion(
    messages: ChatMessage[],
    settings: Settings,
    temperature?: number,
    feature?: ApiFeature,
): Promise<string> {
    validateSettings(settings, feature);

    const requestKey = feature || 'default';

    // Only abort previous requests for interactive features (like chat)
    // Translation chunks run in parallel, so we don't want to abort them
    if (feature !== 'captions') {
        const prevId = apiState.completionRequestIds[requestKey];
        if (prevId) {
            chrome.runtime.sendMessage({ type: 'API_ABORT', requestId: prevId });
        }
    }

    const requestId = `${requestKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Only track request ID if we intend to abort it later
    if (feature !== 'captions') {
        apiState.completionRequestIds[requestKey] = requestId;
    }

    const apiUrl = getApiUrl(settings, feature);
    const headers = getHeaders(settings, feature);
    const model = resolveModel(settings, feature);

    const body = JSON.stringify({
        model,
        messages,
        temperature: temperature ?? settings.temperature ?? DEFAULT_TEMP,
    });

    const cleanupRequest = () => {
        if (apiState.completionRequestIds[requestKey] === requestId) {
            apiState.completionRequestIds[requestKey] = undefined;
        }
    };

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: 'API_REQUEST',
                requestId,
                url: apiUrl,
                options: {
                    method: 'POST',
                    headers,
                    body,
                },
            },
            undefined,
            (response: unknown) => {
                if (!isApiResponse(response)) {
                    cleanupRequest();
                    reject(new ApiError('No response from background script'));
                    return;
                }

                if (!response.ok) {
                    cleanupRequest();
                    const errorMsg =
                        tryParseError(response.body || '') || response.error || response.statusText || 'Request failed';
                    reject(new ApiError(errorMsg, { status: response.status }));
                    return;
                }

                try {
                    const data = JSON.parse(response.body || '{}');
                    const content = data.choices?.[0]?.message?.content;
                    if (content === undefined) {
                        cleanupRequest();
                        reject(new ApiError('Invalid API response'));
                        return;
                    }
                    cleanupRequest();
                    resolve(content);
                } catch {
                    cleanupRequest();
                    reject(new ApiError('Failed to parse API response'));
                }
            },
        );
    });
}

// --- helpers ---

/** Extract complete SSE events from a streaming buffer */
export function extractSSEEvents(
    input: string,
    eventData: string[],
): { events: string[]; rest: string; eventData: string[] } {
    const lines = input.replace(/\r/g, '').split('\n');
    const rest = lines.pop() || '';
    const events: string[] = [];

    for (const line of lines) {
        if (!line) {
            if (eventData.length) {
                events.push(eventData.join('\n'));
                eventData = [];
            }
            continue;
        }
        if (line.startsWith('data:')) {
            eventData.push(line.slice(5).trimStart());
        }
    }

    return { events, rest, eventData };
}

/** Parse a single SSE event data string into content text */
export function parseSSEData(data: string): string | null {
    if (!data) return null;
    if (data.trim() === '[DONE]') return '[DONE]';

    try {
        const parsed = JSON.parse(data);
        return parsed.choices?.[0]?.delta?.content || null;
    } catch {
        return null;
    }
}

function tryParseError(text: string): string | null {
    try {
        return JSON.parse(text).error?.message || null;
    } catch {
        return null;
    }
}

// Re-export translation API for backwards compatibility
export { translateSegments, parseTranslationResponse, normalizeTranslationMap } from '@/services/translation-api';
