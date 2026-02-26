/**
 * TopicsTab - auto-generated video topics/outline
 */

import { Component } from '@/components/Component';
import { registerTab } from '@/components/tabs/registry';
import { state } from '@/services/state';
import { store } from '@/services/store';
import { seekTo, escapeHtml } from '@/content/selectors';
import { isProviderConfigured } from '@/services/state';
import { streamCompletion } from '@/services/api';
import { parseResponse, isAutoGenerateEnabled, TOPICS_SYSTEM_PROMPT } from '@/features/topics';
import { parseTimestamp } from '@/utils/time';
import { showToast } from '@/services/notifications';
import type { TopicsData, Topic } from '@/types';

export class TopicsTab extends Component {
    mount(parent: HTMLElement): void {
        this.el = document.createElement('div');
        this.el.id = 'yt-topics-view';
        this.el.className = 'yt-view';
        this.el.innerHTML = `
      <div id="yt-topics-key-warning" class="yt-key-warning" style="display:none"></div>
      <div id="yt-topics-container"></div>`;
        parent.appendChild(this.el);

        // Initial state
        if (state.topicsData) {
            this.renderTopics(state.topicsData);
        } else if (isAutoGenerateEnabled()) {
            this.showEmpty('topics will be generated automatically');
        } else {
            this.showGenerateButton();
        }
    }

    updateKeyWarning(message: string): void {
        const warning = this.q('#yt-topics-key-warning');
        if (!warning) return;
        if (message) {
            warning.textContent = message;
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
    }

    /** Trigger generation (called by Panel on auto-generate) */
    generate(): void {
        if (!isProviderConfigured()) {
            showToast('No API key configured. Set one in the extension popup.', 'error');
            return;
        }
        if (!state.transcript.length) {
            showToast('No transcript loaded yet.', 'error');
            return;
        }
        this.streamGenerate();
    }

    // --- rendering ---

    private showEmpty(msg: string): void {
        const container = this.q('#yt-topics-container');
        if (container) container.innerHTML = `<div class="yt-empty">${escapeHtml(msg)}</div>`;
    }

    showGenerateButton(): void {
        const container = this.q('#yt-topics-container');
        if (!container) return;
        container.innerHTML = `
      <div class="yt-generate-prompt">
        <button class="yt-generate-btn">Generate Topics</button>
      </div>`;
        container
            .querySelector('.yt-generate-btn')
            ?.addEventListener('click', () => this.generate(), { signal: this.signal });
    }

    private renderTopics(data: TopicsData): void {
        const container = this.q('#yt-topics-container');
        if (!container) return;

        if (!data.topics?.length) {
            container.innerHTML = '<div class="yt-empty">No topics generated</div>';
            return;
        }

        container.innerHTML = data.topics
            .map(
                (topic: Topic, i: number) => `
        <div class="yt-topic">
          <div class="yt-topic-header" data-index="${i}">
            <span class="yt-chevron">▶</span>
            <span class="yt-topic-num">${i + 1}.</span>
            <span class="yt-topic-title">${escapeHtml(topic.title)}</span>
            <span class="yt-topic-time" data-ts="${escapeHtml(topic.timestamp)}">${escapeHtml(topic.timestamp)}</span>
          </div>
          <div class="yt-subtopics" id="subtopics-${i}">
            ${(topic.subtopics || [])
                        .map(
                            (sub) => `
              <div class="yt-subtopic">
                <span class="yt-bullet">●</span>
                <div class="yt-subtopic-content">
                  <div class="yt-subtopic-title">${escapeHtml(sub.title)}</div>
                  <span class="yt-subtopic-time" data-ts="${escapeHtml(sub.timestamp)}">${escapeHtml(sub.timestamp)}</span>
                </div>
              </div>`,
                        )
                        .join('')}
          </div>
        </div>`,
            )
            .join('');

        this.bindTopicClicks(container);
    }

    private bindTopicClicks(container: HTMLElement): void {
        container.addEventListener(
            'click',
            (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;

                // Handle timestamp clicks
                const timeEl = target.closest<HTMLElement>('[data-ts]');
                if (timeEl) {
                    e.stopPropagation();
                    const seconds = parseTimestamp(timeEl.dataset.ts || '');
                    if (seconds !== null) seekTo(seconds);
                    return;
                }

                // Handle topic expansion
                const header = target.closest<HTMLElement>('.yt-topic-header');
                if (header) {
                    const subtopics = container.querySelector(`#subtopics-${header.dataset.index}`);
                    const chevron = header.querySelector('.yt-chevron');
                    if (subtopics && chevron) {
                        subtopics.classList.toggle('expanded');
                        chevron.classList.toggle('expanded');
                    }
                }
            },
            { signal: this.signal },
        );
    }

    // --- generation ---

    private async streamGenerate(): Promise<void> {
        const container = this.q('#yt-topics-container');
        if (!container) return;

        container.innerHTML = `
            <div class="yt-topics-generating">
                <div class="yt-spinner"></div>
                <div>Generating topics…</div>
            </div>
            <pre class="yt-topics-streaming" style="display:none"></pre>`;
        const streamingEl = container.querySelector<HTMLElement>('.yt-topics-streaming');
        const generatingEl = container.querySelector<HTMLElement>('.yt-topics-generating');
        let firstChunk = true;

        try {
            const response = await streamCompletion({
                messages: [
                    { role: 'system', content: TOPICS_SYSTEM_PROMPT },
                    { role: 'user', content: `Transcript:\n\n${state.fullTranscriptText}\n\nGenerate topics.` },
                ],
                settings: state.settings,
                feature: 'topics',
                temperature: 0.3,
                onChunk: (chunk: string) => {
                    if (!streamingEl) return;
                    if (firstChunk) {
                        firstChunk = false;
                        generatingEl?.remove();
                        streamingEl.style.display = '';
                    }
                    streamingEl.textContent = (streamingEl.textContent || '') + chunk;
                    streamingEl.scrollTop = streamingEl.scrollHeight;
                },
            });

            const topicsData = parseResponse(response.content);
            store.set('topicsData', topicsData);
            store.set('topicsVideoId', state.currentVideoId);
            this.renderTopics(topicsData);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            container.innerHTML = `<div class="yt-error">Error: ${escapeHtml(msg)}</div>
      <div class="yt-generate-prompt">
        <button class="yt-generate-btn">Generate Topics</button>
      </div>`;
            container
                .querySelector('.yt-generate-btn')
                ?.addEventListener('click', () => this.generate(), { signal: this.signal });
        }
    }
}

// --- register ---

registerTab({
    id: 'topics',
    label: 'Topics',
    create: () => new TopicsTab(),
});
