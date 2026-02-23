/**
 * TranscriptTab - transcript display, settings, and sync controls
 *
 * Self-contained: owns its DOM, events, rendering, and all settings controls
 * (offset, sync, captions, font size, background, translate).
 */

import { Component } from '@/components/Component';
import { registerTab } from '@/components/tabs/registry';
import { state, persistSetting } from '@/services/state';
import { store } from '@/services/store';
import { escapeHtml, seekTo } from '@/content/selectors';
import { ICONS } from '@/content/icons';
import { FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_STEP } from '@/utils/constants';
import {
    startTranslationPrefetch,
    invalidateTranslationRequests,
    setTranslationRowUpdater,
} from '@/features/translation';

const RENDER_CHUNK_SIZE = 200;

export class TranscriptTab extends Component {
    private rowCache: HTMLElement[] | null = null;
    private renderToken = 0;

    mount(parent: HTMLElement): void {
        this.el = document.createElement('div');
        this.el.id = 'yt-transcript-view';
        this.el.className = 'yt-view active';
        this.el.innerHTML = this.html();
        parent.appendChild(this.el);

        this.bindSettings();
        this.bindTranscriptClicks();

        // Wire translation row updater
        setTranslationRowUpdater((index) => this.updateRowTranslation(index));

        // React to state
        this.listen('transcript', () => this.render());
        this.listen('lastActiveSegmentIndex', (idx, prev) => this.highlightSegment(idx, prev));

        // Initial render
        this.render();
    }

    unmount(): void {
        setTranslationRowUpdater(null);
        super.unmount();
    }

    // --- rendering ---

    render(): void {
        const container = this.q('#yt-transcript-rows');
        if (!container) return;

        const { transcript } = state;
        if (!transcript.length) {
            container.innerHTML = '<div class="yt-empty">loading transcript...</div>';
            this.rowCache = null;
            return;
        }

        this.renderToken += 1;
        const currentToken = this.renderToken;

        if (transcript.length <= RENDER_CHUNK_SIZE) {
            container.innerHTML = transcript.map(rowHtml).join('');
            this.rowCache = childElements(container);
        } else {
            container.innerHTML = '';
            this.rowCache = [];
            let index = 0;
            let cachedLength = 0;

            const appendChunk = () => {
                if (this.renderToken !== currentToken) return;
                const slice = transcript.slice(index, index + RENDER_CHUNK_SIZE);
                container.insertAdjacentHTML('beforeend', slice.map(rowHtml).join(''));

                const children = container.children;
                for (let i = cachedLength; i < children.length; i++) {
                    const child = children[i];
                    if (child instanceof HTMLElement) this.rowCache?.push(child);
                }
                cachedLength = children.length;
                index += RENDER_CHUNK_SIZE;

                if (index < transcript.length) {
                    setTimeout(appendChunk, 0);
                }
            };

            appendChunk();
        }
    }

    renderMessage(message: string): void {
        const container = this.q('#yt-transcript-rows');
        if (!container) return;
        this.renderToken += 1;
        container.innerHTML = `<div class="yt-empty">${escapeHtml(message)}</div>`;
        this.rowCache = null;
    }

    // --- sync highlighting ---

    private highlightSegment(idx: number | undefined, prevIdx: number | undefined): void {
        if (!this.rowCache) {
            const container = this.q('#yt-transcript-rows');
            if (container) this.rowCache = childElements(container);
        }
        if (!this.rowCache) return;

        const prev = prevIdx ?? -1;
        const next = idx ?? -1;
        if (next === prev) return;

        if (prev !== -1 && this.rowCache[prev]) {
            this.rowCache[prev].classList.remove('active');
        }
        if (next !== -1 && this.rowCache[next]) {
            const row = this.rowCache[next];
            row.classList.add('active');
            if (state.autoSync && state.panelOpen) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // --- translation row updates ---

    updateRowTranslation(index: number): void {
        if (!this.rowCache?.[index]) return;
        const text = state.translatedSegments[index];
        if (!text) return;

        const textEl = this.rowCache[index].querySelector('.yt-text');
        if (!textEl) return;

        let transRow = textEl.querySelector('.yt-translated-text');
        if (!transRow) {
            transRow = document.createElement('div');
            transRow.className = 'yt-translated-text';
            textEl.appendChild(transRow);
        }
        transRow.textContent = text;
    }

    private toggleAllTranslations(enabled: boolean): void {
        if (!this.rowCache) return;
        if (enabled) {
            state.transcript.forEach((_, i) => this.updateRowTranslation(i));
        } else {
            this.rowCache.forEach((row) => {
                const trans = row.querySelector('.yt-translated-text');
                if (trans) trans.remove();
            });
        }
    }

    // --- events ---

    private bindTranscriptClicks(): void {
        this.q('#yt-transcript-rows')?.addEventListener(
            'click',
            (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;
                const row = target.closest<HTMLElement>('.yt-row');
                if (row) seekTo(parseFloat(row.dataset.seconds || '0'));
            },
            { signal: this.signal },
        );
    }

    private bindSettings(): void {
        this.bindSettingsToggle();
        this.bindSyncToggle();
        this.bindCaptionToggles();
        this.bindTranslationControls();
        this.bindOffsetInput();
        this.bindFontSizeInput();
    }

    private bindSettingsToggle(): void {
        this.q('#yt-toggle-settings')?.addEventListener(
            'click',
            () => {
                const settings = this.q('#yt-transcript-settings');
                const btn = this.q('#yt-toggle-settings');
                if (settings) {
                    settings.classList.toggle('active');
                    btn?.classList.toggle('active');
                    settings.querySelectorAll('.yt-expandable-row').forEach((row) => {
                        row.classList.toggle('active');
                    });
                }
            },
            { signal: this.signal },
        );
    }

    private bindSyncToggle(): void {
        this.setupToggle(this.q('#yt-sync-btn'), this.q('#yt-sync-status'), {
            initial: state.autoSync,
            onLabel: 'Sync ON',
            offLabel: 'Sync OFF',
            onToggle: (enabled) => {
                store.set('autoSync', enabled);
                if (enabled) {
                    const idx = state.lastActiveSegmentIndex;
                    if (idx !== undefined && idx !== -1 && this.rowCache?.[idx]) {
                        this.rowCache[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            },
        });
    }

    private bindCaptionToggles(): void {
        this.setupToggle(this.q('#yt-caption-btn'), this.q('#yt-caption-status'), {
            initial: state.captionsEnabled,
            onLabel: 'Captions ON',
            offLabel: 'Captions OFF',
            onToggle: (enabled) => store.set('captionsEnabled', enabled),
        });

        this.setupToggle(this.q('#yt-caption-bg-btn'), this.q('#yt-caption-bg-status'), {
            initial: state.captionBackgroundEnabled,
            onLabel: 'ON',
            offLabel: 'OFF',
            onToggle: (enabled) => {
                store.set('captionBackgroundEnabled', enabled);
                persistSetting({ captionBackgroundEnabled: enabled });
            },
        });
    }

    private bindTranslationControls(): void {
        this.setupToggle(this.q('#yt-translate-btn'), this.q('#yt-translate-status'), {
            initial: state.translationEnabled,
            onLabel: 'ON',
            offLabel: 'OFF',
            onToggle: (enabled) => {
                store.set('translationEnabled', enabled);
                if (enabled) {
                    startTranslationPrefetch();
                    this.toggleAllTranslations(true);
                } else {
                    invalidateTranslationRequests();
                    store.mutate('pendingTranslations', (s) => s.clear());
                    this.toggleAllTranslations(false);
                }
            },
        });

        const langSelect = this.q<HTMLSelectElement>('#yt-target-lang');
        if (langSelect) langSelect.value = state.targetLanguage;
        langSelect?.addEventListener(
            'change',
            (e) => {
                store.set('targetLanguage', (e.target as HTMLSelectElement).value);
                this.toggleAllTranslations(false);
                store.set('translatedSegments', {});
                store.mutate('pendingTranslations', (s) => s.clear());
                invalidateTranslationRequests();
                persistSetting({ targetLanguage: state.targetLanguage });
                if (state.translationEnabled) startTranslationPrefetch();
            },
            { signal: this.signal },
        );
    }

    private bindOffsetInput(): void {
        const offsetInput = this.q<HTMLInputElement>('#yt-offset-input');
        const updateOffset = () => {
            if (offsetInput) offsetInput.value = state.transcriptOffset.toString();
        };
        this.q('#yt-offset-plus')?.addEventListener(
            'click',
            () => {
                store.set('transcriptOffset', state.transcriptOffset + 1);
                updateOffset();
            },
            { signal: this.signal },
        );
        this.q('#yt-offset-minus')?.addEventListener(
            'click',
            () => {
                store.set('transcriptOffset', state.transcriptOffset - 1);
                updateOffset();
            },
            { signal: this.signal },
        );
        offsetInput?.addEventListener(
            'input',
            (e) => {
                store.set('transcriptOffset', parseInt((e.target as HTMLInputElement).value || '0', 10));
            },
            { signal: this.signal },
        );
    }

    private bindFontSizeInput(): void {
        const fontInput = this.q<HTMLInputElement>('#yt-font-size-input');
        const updateFontSize = () => {
            if (fontInput) fontInput.value = state.captionFontSize.toString();
            persistSetting({ captionFontSize: state.captionFontSize });
        };
        this.q('#yt-font-size-plus')?.addEventListener(
            'click',
            () => {
                store.set('captionFontSize', Math.min(FONT_SIZE_MAX, state.captionFontSize + FONT_SIZE_STEP));
                updateFontSize();
            },
            { signal: this.signal },
        );
        this.q('#yt-font-size-minus')?.addEventListener(
            'click',
            () => {
                store.set('captionFontSize', Math.max(FONT_SIZE_MIN, state.captionFontSize - FONT_SIZE_STEP));
                updateFontSize();
            },
            { signal: this.signal },
        );
        fontInput?.addEventListener(
            'input',
            (e) => {
                const val = parseInt((e.target as HTMLInputElement).value || '48', 10);
                store.set('captionFontSize', Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, val)));
                updateFontSize();
            },
            { signal: this.signal },
        );
        updateFontSize();
    }

    // --- template ---

    private html(): string {
        return `
    <div class="yt-transcript-toolbar">
      <span class="yt-label-small">Transcript</span>
      <button class="yt-icon-btn" id="yt-toggle-settings" title="Transcription Settings">
        ${ICONS.SETTINGS}
      </button>
    </div>
    <div id="yt-transcript-settings" class="yt-expandable-controls">
      <div class="yt-expandable-row">
        <span class="yt-label-small">Offset</span>
        <div class="yt-offset-controls">
          <button class="yt-offset-btn" id="yt-offset-minus">-1s</button>
          <input type="number" id="yt-offset-input" class="yt-offset-input" value="0" step="1">
          <button class="yt-offset-btn" id="yt-offset-plus">+1s</button>
        </div>
      </div>
      <div class="yt-expandable-row">
        <span class="yt-label-small">Sync</span>
        <button class="yt-sync-btn active" id="yt-sync-btn">
          ${ICONS.SYNC}
          <span id="yt-sync-status">Sync ON</span>
        </button>
      </div>
      <div class="yt-expandable-row">
        <span class="yt-label-small">Captions</span>
        <button class="yt-sync-btn" id="yt-caption-btn">
          ${ICONS.CAPTIONS}
          <span id="yt-caption-status">Captions OFF</span>
        </button>
      </div>
      <div class="yt-expandable-row">
        <span class="yt-label-small">Caption Font Size</span>
        <div class="yt-offset-controls">
          <button class="yt-offset-btn" id="yt-font-size-minus">-</button>
          <input type="number" id="yt-font-size-input" class="yt-offset-input" value="48" step="4" min="20" max="80">
          <button class="yt-offset-btn" id="yt-font-size-plus">+</button>
          <span class="yt-offset-unit">px</span>
        </div>
      </div>
      <div class="yt-expandable-row">
        <span class="yt-label-small">Background</span>
        <button class="yt-sync-btn" id="yt-caption-bg-btn">
          ${ICONS.BACKGROUND}
          <span id="yt-caption-bg-status">ON</span>
        </button>
      </div>
      <div class="yt-expandable-row">
        <span class="yt-label-small">Translate</span>
        <div class="yt-translate-group">
          <button class="yt-sync-btn" id="yt-translate-btn">
            <span id="yt-translate-status">OFF</span>
          </button>
          <select id="yt-target-lang" class="yt-select">
            <option value="English">English</option>
            <option value="Spanish">Spanish</option>
            <option value="French">French</option>
            <option value="German">German</option>
            <option value="Japanese">Japanese</option>
            <option value="Chinese">Chinese</option>
            <option value="Korean">Korean</option>
            <option value="Italian">Italian</option>
            <option value="Portuguese">Portuguese</option>
            <option value="Russian">Russian</option>
          </select>
        </div>
      </div>
    </div>
    <div id="yt-transcript-rows"></div>`;
    }
}

// --- helpers ---

function rowHtml(t: { seconds: number; time: string; text: string }): string {
    return `<div class="yt-row" data-seconds="${t.seconds}">
      <div class="yt-time">${escapeHtml(t.time)}</div>
      <div class="yt-text">${escapeHtml(t.text)}</div>
    </div>`;
}

function childElements(container: HTMLElement): HTMLElement[] {
    const result: HTMLElement[] = [];
    for (let i = 0; i < container.children.length; i++) {
        const child = container.children[i];
        if (child instanceof HTMLElement) result.push(child);
    }
    return result;
}

// --- register ---

registerTab({
    id: 'transcript',
    label: 'Transcript',
    create: () => new TranscriptTab(),
});
