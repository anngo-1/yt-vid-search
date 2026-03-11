/**
 * ChatTab - AI chat interface with streaming responses
 */

import { seekTo, escapeHtml } from '@/content/selectors';
import { Component } from '@/components/Component';
import { registerTab } from '@/components/tabs/registry';
import { state } from '@/services/state';
import { store } from '@/services/store';
import { renderMarkdown } from '@/utils/markdown';
import { isProviderConfigured } from '@/services/state';
import { streamCompletion, fetchOpenRouterContextLength } from '@/services/api';
import {
    buildMessages,
    buildFullSystemPrompt,
    buildFollowUpSystemPrompt,
    shouldUseTools,
    estimateUsedTokens,
} from '@/features/chat';
import type { Tool } from '@/types';
import { resolveModel, resolveProvider } from '@/utils/llm';
import { showToast } from '@/services/notifications';
import { ApiError } from '@/services/errors';
import { ICONS } from '@/content/icons';

export class ChatTab extends Component {
    private streamController: AbortController | null = null;

    private persistChatHistory(): void {
        try {
            (chrome.storage.session ?? chrome.storage.local).set({ chatHistory: state.chatHistory });
        } catch {
            // Extension context can be invalidated during reload; ignore persistence failures.
        }
    }

    mount(parent: HTMLElement): void {
        this.el = document.createElement('div');
        this.el.id = 'yt-ask-view';
        this.el.className = 'yt-view';
        this.el.innerHTML = `
      <div class="yt-ask-header">
        <span class="yt-label-small">Chat</span>
        <div class="yt-context-bar" id="yt-context-bar" style="display:none"></div>
        <button id="yt-chat-clear" class="yt-link-btn">Clear</button>
      </div>
      <div id="yt-key-warning" class="yt-key-warning" style="display:none"></div>
      <div id="yt-chat-messages" class="yt-chat-messages"></div>
      <div class="yt-ask-bar">
        <input id="yt-ask-input" class="yt-input" placeholder="Ask about the video..." autocomplete="off">
        <button id="yt-ask-send">${ICONS.SEND}</button>
      </div>`;
        parent.appendChild(this.el);

        this.bindEvents();

        // Restore chat history
        state.chatHistory.forEach((msg) => {
            if (msg.role !== 'tool' && !(msg.role === 'assistant' && !msg.content)) {
                this.addMessage(msg.role, msg.content || '');
            }
        });

        this.updateContextBar();
    }

    addMessage(role: string, content: string): void {
        if (!content) return;

        const container = this.q('#yt-chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = `yt-message yt-message-${role}`;

        if (role === 'assistant') {
            div.innerHTML = renderMarkdown(content);
            div.querySelectorAll<HTMLButtonElement>('button[data-timestamp]').forEach((btn) => {
                btn.onclick = () => seekTo(parseFloat(btn.dataset.timestamp || '0'));
            });
        } else {
            div.textContent = content;
        }

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    updateKeyWarning(message: string): void {
        const warning = this.q('#yt-key-warning');
        if (!warning) return;
        if (message) {
            warning.textContent = message;
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
    }

    updateContextBar(): void {
        const provider = resolveProvider(state.settings, 'chat');
        const bar = this.q<HTMLElement>('#yt-context-bar');
        if (!bar) return;

        if (provider !== 'openrouter') {
            bar.style.display = 'none';
            return;
        }

        const history = state.chatHistory;
        if (!history.length) {
            bar.style.display = 'none';
            return;
        }

        const usedTokens = estimateUsedTokens(); // estimate

        const model = resolveModel(state.settings, 'chat');
        const apiKey = state.settings.openrouter_api_key || '';

        fetchOpenRouterContextLength(model, apiKey)
            .then((maxTokens) => {
                if (!maxTokens) {
                    bar.style.display = 'none';
                    return;
                }

                const pct = Math.min(100, Math.round((usedTokens / maxTokens) * 100));
                const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

                bar.style.display = 'flex';
                if (pct >= 90) {
                    bar.setAttribute('data-critical', '');
                } else {
                    bar.removeAttribute('data-critical');
                }
                if (pct >= 75) {
                    bar.setAttribute('data-high', '');
                } else {
                    bar.removeAttribute('data-high');
                }
                bar.innerHTML = `<span class="yt-context-bar-text">${fmtK(usedTokens)}&thinsp;/&thinsp;${fmtK(maxTokens)} <span class="yt-context-bar-pct">(${pct}%)</span></span>`;
            })
            .catch(() => {
                bar.style.display = 'none';
            });
    }

    // --- events ---

    private bindEvents(): void {
        const input = this.q<HTMLInputElement>('#yt-ask-input');
        const sendBtn = this.q('#yt-ask-send');

        const doSend = () => {
            if (this.streamController) {
                this.stopStream();
                return;
            }
            const text = input?.value.trim();
            if (!text) return;
            if (input) input.value = '';
            this.send(text);
        };

        sendBtn?.addEventListener('click', doSend, { signal: this.signal });
        input?.addEventListener(
            'keydown',
            (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doSend();
                }
            },
            { signal: this.signal },
        );

        this.q('#yt-chat-clear')?.addEventListener('click', () => this.clear(), { signal: this.signal });

        // Timestamp click → seek
        this.q('#yt-chat-messages')?.addEventListener(
            'click',
            (e) => {
                const target = e.target;
                if (target instanceof HTMLButtonElement && target.dataset.timestamp) {
                    seekTo(parseFloat(target.dataset.timestamp));
                }
            },
            { signal: this.signal },
        );
    }

    // --- chat logic ---

    private setSendButton(mode: 'send' | 'stop'): void {
        const btn = this.q('#yt-ask-send');
        if (!btn) return;
        if (mode === 'stop') {
            btn.innerHTML = ICONS.STOP;
            btn.classList.add('yt-stop');
        } else {
            btn.innerHTML = ICONS.SEND;
            btn.classList.remove('yt-stop');
        }
    }

    private stopStream(): void {
        this.streamController?.abort();
        this.streamController = null;
        this.setSendButton('send');
    }

    private async executeTool(name: string, argsRaw: string): Promise<string> {
        try {
            const args = JSON.parse(argsRaw);
            if (name === 'search_transcript') {
                const query = args.query.toLowerCase();
                const results = state.transcript.filter((s) => s.text.toLowerCase().includes(query)).slice(0, 15);
                if (!results.length) return 'No matches found.';
                return results.map((s) => `[${s.time}] ${s.text}`).join('\n');
            } else if (name === 'read_transcript') {
                const startStr = args.start_seconds;
                const startSeconds = typeof startStr === 'string' ? parseFloat(startStr) : startStr;
                const duration = typeof args.duration_seconds === 'number' ? args.duration_seconds : 120;
                const validDuration = Math.min(Math.max(duration, 10), 300);
                const endSeconds = startSeconds + validDuration;

                const results = state.transcript.filter((s) => s.seconds >= startSeconds && s.seconds <= endSeconds);
                if (!results.length) return 'No transcript found in that time range.';
                return results.map((s) => `[${s.time}] ${s.text}`).join('\n');
            }
            return `Unknown tool: ${name}`;
        } catch (e) {
            return `Error executing tool: ${e}`;
        }
    }

    private async send(text: string): Promise<void> {
        if (!isProviderConfigured()) {
            showToast('No provider configured. Set up in extension popup.', 'error');
            return;
        }

        store.set('isChatCleared', false);
        this.addMessage('user', text);
        store.set('chatHistory', [...state.chatHistory, { role: 'user', content: text }]);
        this.persistChatHistory();
        this.updateContextBar();

        const noHistory = state.settings?.chat_no_history === true;
        const historyToSend = noHistory
            ? state.chatHistory.slice(-1) // only the current user message
            : state.chatHistory;
        const systemPrompt = historyToSend.length <= 1 ? buildFullSystemPrompt() : buildFollowUpSystemPrompt();

        const currentMessages = buildMessages(systemPrompt, historyToSend);

        const container = this.q('#yt-chat-messages');
        if (!container) return;

        const CHAT_TOOLS: Tool[] = [
            {
                type: 'function',
                function: {
                    name: 'search_transcript',
                    description:
                        'Search the video transcript for specific keywords. Returns matching segments with timestamps.',
                    parameters: {
                        type: 'object',
                        properties: { query: { type: 'string', description: 'Search query or keyword.' } },
                        required: ['query'],
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'read_transcript',
                    description: 'Read a block of the transcript starting from a specific time.',
                    parameters: {
                        type: 'object',
                        properties: {
                            start_seconds: { type: 'number', description: 'Start time in seconds.' },
                            duration_seconds: { type: 'number', description: 'How many seconds to read (max 300).' },
                        },
                        required: ['start_seconds'],
                    },
                },
            },
        ];
        const chatTools = shouldUseTools() ? CHAT_TOOLS : [];

        try {
            while (true) {
                if (state.isChatCleared) break;

                const msgEl = document.createElement('div');
                msgEl.className = 'yt-message yt-message-assistant';
                msgEl.innerHTML = '<div class="yt-typing-indicator"><span></span><span></span><span></span></div>';
                container.appendChild(msgEl);
                container.scrollTop = container.scrollHeight;

                this.streamController = new AbortController();
                this.setSendButton('stop');

                let lastRender = 0;
                let renderTimeout: number | null = null;
                let pendingRaf: number | null = null;
                let receivedFirstChunk = false;

                const doRender = () => {
                    pendingRaf = null;
                    msgEl.innerHTML = renderMarkdown(msgEl.dataset.content || '');
                    container.scrollTop = container.scrollHeight;
                    lastRender = Date.now();
                };

                const response = await streamCompletion({
                    messages: currentMessages,
                    tools: chatTools,
                    settings: state.settings,
                    feature: 'chat',
                    signal: this.streamController.signal,
                    onChunk: (chunk: string) => {
                        if (state.isChatCleared) return;
                        if (!receivedFirstChunk) {
                            receivedFirstChunk = true;
                            msgEl.innerHTML = '';
                        }
                        msgEl.dataset.content = (msgEl.dataset.content || '') + chunk;

                        // Skip if a render is already scheduled (RAF or timeout)
                        if (pendingRaf !== null || renderTimeout !== null) return;
                        const elapsed = Date.now() - lastRender;
                        if (elapsed >= 100) {
                            pendingRaf = requestAnimationFrame(doRender);
                        } else {
                            renderTimeout = window.setTimeout(() => {
                                renderTimeout = null;
                                pendingRaf = requestAnimationFrame(doRender);
                            }, 100 - elapsed);
                        }
                    },
                });

                // Cancel any pending intermediate renders before applying the final result
                if (renderTimeout !== null) {
                    clearTimeout(renderTimeout);
                    renderTimeout = null;
                }
                if (pendingRaf !== null) {
                    cancelAnimationFrame(pendingRaf);
                    pendingRaf = null;
                }
                if (state.isChatCleared) break;

                const assistantMsg = {
                    role: 'assistant' as const,
                    content: response.content || null,
                    tool_calls: response.tool_calls,
                };
                currentMessages.push(assistantMsg);

                // Keep the state up to date minus the system prompt
                store.set(
                    'chatHistory',
                    currentMessages.filter((m) => m.role !== 'system'),
                );
                this.persistChatHistory();
                this.updateContextBar();

                if (!response.tool_calls || response.tool_calls.length === 0) {
                    let finalHtml = renderMarkdown(response.content || '');
                    if (!finalHtml && response.content) {
                        finalHtml = `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(response.content)}</pre>`;
                    }
                    if (finalHtml) {
                        msgEl.innerHTML = finalHtml;
                        msgEl.querySelectorAll<HTMLButtonElement>('button[data-timestamp]').forEach((btn) => {
                            btn.onclick = () => seekTo(parseFloat(btn.dataset.timestamp || '0'));
                        });
                        container.scrollTop = container.scrollHeight;
                    } else {
                        msgEl.remove();
                    }
                    break; // Final response received
                } else {
                    // Tool calls to process
                    if (!response.content) {
                        msgEl.remove();
                    } else {
                        msgEl.innerHTML = renderMarkdown(response.content);
                    }

                    // Create all status elements upfront, then execute in parallel
                    const toolJobs = response.tool_calls.map((tc) => {
                        const toolName = tc.function.name;

                        let displayAction = 'Working...';
                        if (toolName === 'search_transcript') {
                            displayAction = 'Searching transcript';
                            try {
                                const args = JSON.parse(tc.function.arguments);
                                if (args.query) displayAction += ` for "${args.query}"`;
                            } catch {
                                /* ignore parse errors */
                            }
                        } else if (toolName === 'read_transcript') {
                            displayAction = 'Reading transcript';
                            try {
                                const args = JSON.parse(tc.function.arguments);
                                if (args.start_seconds != null) displayAction += ` from ${args.start_seconds}s`;
                            } catch {
                                /* ignore parse errors */
                            }
                        }

                        const toolStatusEl = document.createElement('div');
                        toolStatusEl.className = 'yt-message-tool-status';
                        toolStatusEl.innerHTML = `<div class="yt-tool-spinner"></div><span>${displayAction}...</span>`;
                        container.appendChild(toolStatusEl);

                        return { tc, toolStatusEl, displayAction };
                    });
                    container.scrollTop = container.scrollHeight;

                    // Execute all tool calls in parallel
                    const toolResults = await Promise.all(
                        toolJobs.map(async ({ tc, toolStatusEl, displayAction }) => {
                            const result = await this.executeTool(tc.function.name, tc.function.arguments);

                            const spinnerEl = toolStatusEl.querySelector('.yt-tool-spinner');
                            if (spinnerEl) {
                                spinnerEl.outerHTML = `<svg class="yt-tool-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                            }
                            const spanEl = toolStatusEl.querySelector('span');
                            if (spanEl) spanEl.textContent = displayAction;
                            toolStatusEl.classList.add('yt-tool-done');

                            return { tc, result };
                        }),
                    );

                    for (const { tc, result } of toolResults) {
                        currentMessages.push({
                            role: 'tool',
                            content: result,
                            tool_call_id: tc.id,
                            name: tc.function.name,
                        });
                    }

                    // Update state again before the next loop
                    store.set(
                        'chatHistory',
                        currentMessages.filter((m) => m.role !== 'system'),
                    );
                    this.persistChatHistory();
                }
            }
        } catch (error) {
            if (!state.isChatCleared) {
                // If the stream errored out before the first chunk, the typing indicator is still there
                const lastEl = container?.lastElementChild as HTMLElement;
                if (lastEl && lastEl.querySelector('.yt-typing-indicator')) {
                    lastEl.remove();
                }

                const msg =
                    error instanceof ApiError
                        ? `API Error: ${error.message}${error.status ? ` (${error.status})` : ''}`
                        : error instanceof Error
                          ? error.message
                          : 'Unknown error';
                this.addMessage('system', `Error: ${msg}`);
            }
        } finally {
            this.streamController = null;
            this.setSendButton('send');
        }
    }

    private clear(): void {
        store.set('chatHistory', []);
        store.set('isChatCleared', true);
        const container = this.q('#yt-chat-messages');
        if (container) container.innerHTML = '';
        this.updateContextBar();
    }
}

// --- register ---

registerTab({
    id: 'ask',
    label: 'Ask',
    create: () => new ChatTab(),
    onActivate: () => {
        requestAnimationFrame(() => {
            document.getElementById('yt-ask-input')?.focus();
        });
    },
});
