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
import { FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_STEP, SEARCH_DEBOUNCE_MS } from '@/utils/constants';
import { getLowercasedTranscriptText } from '@/utils/transcript-derived';
import {
    startTranslationPrefetch,
    invalidateTranslationRequests,
    setTranslationRowUpdater,
} from '@/features/translation';

const RENDER_CHUNK_SIZE = 500;

export class TranscriptTab extends Component {
    private rowCache: HTMLElement[] | null = null;
    private renderToken = 0;
    private searchQuery = '';
    private searchTimeout: number | null = null;
    private searchMatches: SearchMatch[] = [];
    private activeSearchMatchIndex = -1;
    private pendingSearchScroll = false;

    mount(parent: HTMLElement): void {
        this.el = document.createElement('div');
        this.el.id = 'yt-transcript-view';
        this.el.className = 'yt-view active';
        this.el.innerHTML = this.html();
        parent.appendChild(this.el);

        this.bindSettings();
        this.bindTranscriptSearch();
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
        if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
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
            this.renderSearchStatus(null);
            this.rowCache = null;
            return;
        }

        const search = createSearchContext(transcript, this.searchQuery);
        this.syncSearchNavigation(search);
        this.renderSearchStatus(search);

        this.renderToken += 1;
        const currentToken = this.renderToken;
        const activeIndex = state.lastActiveSegmentIndex ?? -1;
        const activeSearchMatch = this.searchMatches[this.activeSearchMatchIndex] ?? null;

        if (transcript.length <= RENDER_CHUNK_SIZE) {
            container.innerHTML = transcript
                .map((segment, index) => rowHtml(segment, index, search, activeIndex, activeSearchMatch))
                .join('');
            this.rowCache = childElements(container);
            this.updateActiveSearchRow();
            this.scrollToActiveSearchMatch();
        } else {
            container.innerHTML = '';
            this.rowCache = [];
            let index = 0;
            let cachedLength = 0;

            const appendChunk = () => {
                if (this.renderToken !== currentToken) return;
                const end = Math.min(index + RENDER_CHUNK_SIZE, transcript.length);
                const currentSearchMatch = this.searchMatches[this.activeSearchMatchIndex] ?? null;
                const html = transcript
                    .slice(index, end)
                    .map((segment, offset) =>
                        rowHtml(segment, index + offset, search, activeIndex, currentSearchMatch),
                    )
                    .join('');
                container.insertAdjacentHTML('beforeend', html);

                const children = container.children;
                for (let i = cachedLength; i < children.length; i++) {
                    const child = children[i];
                    if (child instanceof HTMLElement) this.rowCache?.push(child);
                }
                cachedLength = children.length;
                index += RENDER_CHUNK_SIZE;
                this.updateActiveSearchRow();
                this.scrollToActiveSearchMatch();

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
        this.renderSearchStatus(null);
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
            if (state.autoSync && state.panelOpen && !isInView(row, this.q('#yt-transcript-rows'))) {
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

    private bindTranscriptSearch(): void {
        const input = this.q<HTMLInputElement>('#yt-transcript-search-input');
        input?.addEventListener(
            'input',
            (e) => {
                const value = (e.target as HTMLInputElement).value;
                if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
                this.searchTimeout = window.setTimeout(() => {
                    this.searchTimeout = null;
                    this.searchQuery = value;
                    this.activeSearchMatchIndex = -1;
                    this.pendingSearchScroll = true;
                    this.render();
                }, SEARCH_DEBOUNCE_MS);
            },
            { signal: this.signal },
        );

        input?.addEventListener(
            'keydown',
            (e) => {
                if (e.key !== 'Escape' || !input.value) return;
                e.stopPropagation();
                if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
                this.searchTimeout = null;
                input.value = '';
                this.searchQuery = '';
                this.activeSearchMatchIndex = -1;
                this.pendingSearchScroll = false;
                this.render();
            },
            { signal: this.signal },
        );

        input?.addEventListener(
            'keydown',
            (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                this.navigateSearch(e.shiftKey ? -1 : 1);
            },
            { signal: this.signal },
        );

        this.q('#yt-search-prev')?.addEventListener('click', () => this.navigateSearch(-1), { signal: this.signal });
        this.q('#yt-search-next')?.addEventListener('click', () => this.navigateSearch(1), { signal: this.signal });
    }

    private renderSearchStatus(search: SearchRenderContext | null): void {
        this.updateSearchStatus(!!search?.query, search?.matchCount ?? 0);
    }

    private updateSearchStatus(hasQuery: boolean, matchCount: number): void {
        const status = this.q('#yt-transcript-search-count');
        const prev = this.q<HTMLButtonElement>('#yt-search-prev');
        const next = this.q<HTMLButtonElement>('#yt-search-next');
        const disabled = !hasQuery || matchCount <= 1;

        prev?.toggleAttribute('disabled', disabled);
        next?.toggleAttribute('disabled', disabled);

        if (!status) return;

        if (!hasQuery) {
            status.textContent = '';
            return;
        }

        status.textContent = matchCount > 0 ? `${this.activeSearchMatchIndex + 1} / ${matchCount}` : '0 / 0';
    }

    private syncSearchNavigation(search: SearchRenderContext): void {
        this.searchMatches = search.matches;

        if (!search.query || !this.searchMatches.length) {
            this.activeSearchMatchIndex = -1;
            this.pendingSearchScroll = false;
            return;
        }

        if (this.activeSearchMatchIndex < 0 || this.activeSearchMatchIndex >= this.searchMatches.length) {
            this.activeSearchMatchIndex = 0;
        }
    }

    private navigateSearch(delta: number): void {
        if (!this.searchMatches.length) return;
        const previousMatch = this.searchMatches[this.activeSearchMatchIndex] ?? null;

        this.activeSearchMatchIndex =
            (this.activeSearchMatchIndex + delta + this.searchMatches.length) % this.searchMatches.length;
        this.updateSearchStatus(!!this.searchQuery.trim(), this.searchMatches.length);
        this.updateActiveSearchRow(previousMatch);
        this.pendingSearchScroll = true;
        this.scrollToActiveSearchMatch();
    }

    private scrollToActiveSearchMatch(): void {
        if (!this.pendingSearchScroll) return;

        const target = this.searchMatches[this.activeSearchMatchIndex];
        if (!target) {
            this.pendingSearchScroll = false;
            return;
        }

        const row = this.rowCache?.[target.segmentIndex];
        if (!row) return;

        const targetEl = findSearchMark(row, target) ?? row;
        centerElementInContainer(targetEl, this.q('#yt-transcript-rows'));
        this.pendingSearchScroll = false;
    }

    private updateActiveSearchRow(previousMatch: SearchMatch | null = null): void {
        const target = this.searchMatches[this.activeSearchMatchIndex] ?? null;

        if (previousMatch) {
            const previousRow = this.rowCache?.[previousMatch.segmentIndex];
            findSearchMark(previousRow, previousMatch)?.classList.remove('search-current-match');
            if (previousMatch.segmentIndex !== target?.segmentIndex) {
                previousRow?.classList.remove('search-current');
            }
        }

        if (!target) return;
        const targetRow = this.rowCache?.[target.segmentIndex];
        targetRow?.classList.add('search-current');
        findSearchMark(targetRow, target)?.classList.add('search-current-match');
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
                persistSetting({ autoSync: enabled });
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
      <div class="yt-transcript-search">
        <input id="yt-transcript-search-input" class="yt-input" type="search" placeholder="search transcript..." autocomplete="off">
        <span id="yt-transcript-search-count" class="yt-result-count" aria-live="polite"></span>
        <div class="yt-search-nav" aria-label="Search results">
          <button class="yt-search-nav-btn" id="yt-search-prev" type="button" title="Previous match" disabled>
            ${ICONS.CHEVRON_UP}
          </button>
          <button class="yt-search-nav-btn" id="yt-search-next" type="button" title="Next match" disabled>
            ${ICONS.CHEVRON_DOWN}
          </button>
        </div>
      </div>
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
        <button class="yt-sync-btn" id="yt-sync-btn">
          ${ICONS.SYNC}
          <span id="yt-sync-status">Sync OFF</span>
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

type TranscriptRow = { seconds: number; time: string; text: string };

interface SearchMatch {
    segmentIndex: number;
    start: number;
    ordinalInSegment: number;
}

interface SearchRenderContext {
    query: string;
    lowerQuery: string;
    loweredTranscript: string[] | null;
    matchCount: number;
    matches: SearchMatch[];
}

function createSearchContext(transcript: TranscriptRow[], rawQuery: string): SearchRenderContext {
    const query = rawQuery.trim();
    if (!query) {
        return { query: '', lowerQuery: '', loweredTranscript: null, matchCount: 0, matches: [] };
    }

    const lowerQuery = query.toLowerCase();
    const loweredTranscript = getLowercasedTranscriptText(transcript);
    const matches: SearchMatch[] = [];

    for (let i = 0; i < loweredTranscript.length; i++) {
        let ordinalInSegment = 0;
        let pos = loweredTranscript[i].indexOf(lowerQuery);

        while (pos !== -1) {
            matches.push({ segmentIndex: i, start: pos, ordinalInSegment });
            ordinalInSegment += 1;
            pos = loweredTranscript[i].indexOf(lowerQuery, pos + lowerQuery.length);
        }
    }

    return { query, lowerQuery, loweredTranscript, matchCount: matches.length, matches };
}

function rowHtml(
    t: TranscriptRow,
    index: number,
    search: SearchRenderContext,
    activeIndex: number,
    activeSearchMatch: SearchMatch | null,
): string {
    const classes = ['yt-row'];
    if (index === activeIndex) classes.push('active');
    if (index === activeSearchMatch?.segmentIndex) classes.push('search-current');
    const translated = state.translationEnabled ? state.translatedSegments[index] : '';

    return `<div class="${classes.join(' ')}" data-seconds="${t.seconds}">
      <div class="yt-time">${escapeHtml(t.time)}</div>
      <div class="yt-text">${renderTranscriptText(t.text, index, search, activeSearchMatch)}${renderTranslatedText(translated)}</div>
    </div>`;
}

function renderTranscriptText(
    text: string,
    index: number,
    search: SearchRenderContext,
    activeSearchMatch: SearchMatch | null,
): string {
    if (!search.lowerQuery || !search.loweredTranscript) return escapeHtml(text);

    const lowerText = search.loweredTranscript[index];
    if (!lowerText?.includes(search.lowerQuery)) return escapeHtml(text);

    let html = '';
    let lastIndex = 0;
    let pos = lowerText.indexOf(search.lowerQuery, lastIndex);
    let ordinalInSegment = 0;

    while (pos !== -1) {
        if (pos > lastIndex) {
            html += escapeHtml(text.slice(lastIndex, pos));
        }
        const activeClass =
            activeSearchMatch?.segmentIndex === index &&
            activeSearchMatch.start === pos &&
            activeSearchMatch.ordinalInSegment === ordinalInSegment
                ? ' class="search-current-match"'
                : '';
        html += `<mark${activeClass} data-search-start="${pos}" data-search-ordinal="${ordinalInSegment}">${escapeHtml(
            text.slice(pos, pos + search.lowerQuery.length),
        )}</mark>`;
        lastIndex = pos + search.lowerQuery.length;
        ordinalInSegment += 1;
        pos = lowerText.indexOf(search.lowerQuery, lastIndex);
    }

    if (lastIndex < text.length) {
        html += escapeHtml(text.slice(lastIndex));
    }

    return html;
}

function renderTranslatedText(text: string | undefined): string {
    return text ? `<div class="yt-translated-text">${escapeHtml(text)}</div>` : '';
}

function isInView(el: HTMLElement, container: HTMLElement | null): boolean {
    if (!container) return false;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    return elRect.top >= cRect.top && elRect.bottom <= cRect.bottom;
}

function findSearchMark(row: HTMLElement | undefined, match: SearchMatch): HTMLElement | null {
    return (
        row?.querySelector<HTMLElement>(
            `mark[data-search-start="${match.start}"][data-search-ordinal="${match.ordinalInSegment}"]`,
        ) ?? null
    );
}

function centerElementInContainer(target: HTMLElement, container: HTMLElement | null): void {
    if (!container) {
        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
        return;
    }

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const targetCenter = targetRect.top - containerRect.top + container.scrollTop + targetRect.height / 2;
    const top = targetCenter - container.clientHeight / 2;

    const nextScrollTop = Math.max(0, top);
    if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
    } else {
        container.scrollTop = nextScrollTop;
    }
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
