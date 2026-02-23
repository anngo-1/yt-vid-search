/**
 * ChatTab - AI chat interface with streaming responses
 */

import { seekTo } from '@/content/selectors';
import { Component } from '@/components/Component';
import { registerTab } from '@/components/tabs/registry';
import { state } from '@/services/state';
import { store } from '@/services/store';
import { renderMarkdown } from '@/utils/markdown';
import { isProviderConfigured } from '@/services/state';
import { streamCompletion } from '@/services/api';
import { buildMessages, buildFullSystemPrompt, buildFollowUpSystemPrompt } from '@/features/chat';
import { showToast } from '@/services/notifications';
import { ApiError } from '@/services/errors';
import { ICONS } from '@/content/icons';

export class ChatTab extends Component {
    private streamController: AbortController | null = null;

    mount(parent: HTMLElement): void {
        this.el = document.createElement('div');
        this.el.id = 'yt-ask-view';
        this.el.className = 'yt-view';
        this.el.innerHTML = `
      <div class="yt-ask-header">
        <span class="yt-label-small">Chat</span>
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
        state.chatHistory.forEach((msg) => this.addMessage(msg.role, msg.content));
    }

    addMessage(role: string, content: string): void {
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

    private async send(text: string): Promise<void> {
        if (!isProviderConfigured()) {
            showToast('No provider configured. Set up in extension popup.', 'error');
            return;
        }

        store.set('isChatCleared', false);
        this.addMessage('user', text);
        store.set('chatHistory', [...state.chatHistory, { role: 'user', content: text }]);
        chrome.storage.session.set({ chatHistory: state.chatHistory });

        const systemPrompt = state.chatHistory.length <= 2 ? buildFullSystemPrompt() : buildFollowUpSystemPrompt();

        const messages = buildMessages(systemPrompt, state.chatHistory);

        const container = this.q('#yt-chat-messages');
        if (!container) return;

        const msgEl = document.createElement('div');
        msgEl.className = 'yt-message yt-message-assistant';
        msgEl.innerHTML = '<div class="yt-typing-indicator"><span></span><span></span><span></span></div>';
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;

        this.streamController = new AbortController();
        this.setSendButton('stop');

        let lastRender = 0;
        let renderTimeout: number | null = null;
        let receivedFirstChunk = false;

        try {
            const response = await streamCompletion({
                messages,
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

                    const now = Date.now();
                    if (!renderTimeout) {
                        if (now - lastRender >= 100) {
                            requestAnimationFrame(() => {
                                msgEl.innerHTML = renderMarkdown(msgEl.dataset.content || '');
                                container.scrollTop = container.scrollHeight;
                                lastRender = Date.now();
                            });
                        } else {
                            renderTimeout = window.setTimeout(
                                () => {
                                    renderTimeout = null;
                                    requestAnimationFrame(() => {
                                        msgEl.innerHTML = renderMarkdown(msgEl.dataset.content || '');
                                        container.scrollTop = container.scrollHeight;
                                        lastRender = Date.now();
                                    });
                                },
                                100 - (now - lastRender),
                            );
                        }
                    }
                },
            });

            if (renderTimeout) clearTimeout(renderTimeout);
            if (!state.isChatCleared) {
                msgEl.innerHTML = renderMarkdown(response);
                msgEl.querySelectorAll<HTMLButtonElement>('button[data-timestamp]').forEach((btn) => {
                    btn.onclick = () => seekTo(parseFloat(btn.dataset.timestamp || '0'));
                });
                store.set('chatHistory', [...state.chatHistory, { role: 'assistant', content: response }]);
                chrome.storage.session.set({ chatHistory: state.chatHistory });
                container.scrollTop = container.scrollHeight;
            }
        } catch (error) {
            if (!state.isChatCleared) {
                msgEl.remove();
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
