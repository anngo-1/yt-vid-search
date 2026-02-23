/**
 * background - service worker for extension lifecycle and API proxy
 */

import { isApiRequest, isApiAbort, isApiStream } from '@/services/validators';
import { REMOTE_API_TIMEOUT_MS, KEEPALIVE_PING_MS } from '@/utils/constants';

/** Allowlist safe fetch properties to prevent request smuggling */
function sanitizeFetchOptions(options: RequestInit | undefined): RequestInit {
    if (!options) return {};
    return {
        method: options.method,
        headers: options.headers,
        body: options.body,
    };
}

// initialize on install
chrome.runtime.onInstalled.addListener((details) => {
    console.debug('[ask-transcript] extension installed/updated:', details.reason);

    // initialize session storage defaults
    chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

    // set default settings if first install
    if (details.reason === 'install') {
        chrome.storage.local.get(['temperature'], (data) => {
            if (data.temperature === undefined) {
                chrome.storage.local.set({ temperature: 0.1 });
            }
        });
    }
});

chrome.runtime.onStartup.addListener(() => {
    console.debug('[ask-transcript] browser started');
});

// API proxy message handling
const pendingRequests = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isApiAbort(message)) {
        const controller = pendingRequests.get(message.requestId);
        if (controller) {
            controller.abort();
            pendingRequests.delete(message.requestId);
        }
        sendResponse({ ok: true });
        return;
    }
    if (isApiRequest(message)) {
        // no timeout for local LLMs which may take a while
        const isLocal = message.url.includes('localhost') || message.url.includes('127.0.0.1');
        const controller = new AbortController();
        if (message.requestId) pendingRequests.set(message.requestId, controller);
        const timeoutId = isLocal ? null : setTimeout(() => controller.abort(), REMOTE_API_TIMEOUT_MS);

        fetch(message.url, { ...sanitizeFetchOptions(message.options), signal: controller.signal })
            .then(async (response) => {
                if (timeoutId) clearTimeout(timeoutId);
                if (message.requestId) pendingRequests.delete(message.requestId);
                const text = await response.text();
                sendResponse({
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    body: text,
                });
            })
            .catch((error) => {
                if (timeoutId) clearTimeout(timeoutId);
                if (message.requestId) pendingRequests.delete(message.requestId);
                sendResponse({
                    ok: false,
                    error: error.name === 'AbortError' ? 'Request timed out' : error.message,
                });
            });
        return true;
    }
});

// Streaming API via ports with keepalive for long-running local LLM requests
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'api-stream') return;

    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    let aborted = false;

    // Clean up on disconnect
    port.onDisconnect.addListener(() => {
        aborted = true;
        if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
            keepaliveInterval = null;
        }
    });

    port.onMessage.addListener(async (message) => {
        if (!isApiStream(message)) return;

        // Start keepalive pings to prevent service worker termination
        // Service workers can be killed after 30s of inactivity
        if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
        }
        keepaliveInterval = setInterval(() => {
            if (!aborted) {
                port.postMessage({ type: 'keepalive' });
            }
        }, KEEPALIVE_PING_MS);

        try {
            // Use AbortController for cleanup, but no timeout for local LLMs
            const controller = new AbortController();
            port.onDisconnect.addListener(() => controller.abort());

            const response = await fetch(message.url, {
                ...sanitizeFetchOptions(message.options),
                signal: controller.signal,
            });

            if (!response.ok) {
                const text = await response.text();
                port.postMessage({
                    type: 'error',
                    error: text || response.statusText,
                });
                return;
            }

            if (!response.body) {
                port.postMessage({ type: 'error', error: 'No response body' });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (!aborted) {
                const { done, value } = await reader.read();
                if (done) {
                    port.postMessage({ type: 'done' });
                    break;
                }
                const chunk = decoder.decode(value, { stream: true });
                port.postMessage({ type: 'chunk', data: chunk });
            }
        } catch (error) {
            if (!aborted) {
                try {
                    port.postMessage({
                        type: 'error',
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                } catch {
                    // Port already disconnected, ignore
                }
            }
        } finally {
            if (keepaliveInterval) {
                clearInterval(keepaliveInterval);
                keepaliveInterval = null;
            }
        }
    });
});
