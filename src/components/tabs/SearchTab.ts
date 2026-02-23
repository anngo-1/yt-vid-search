/**
 * SearchTab - transcript search with highlighting
 */

import { Component } from '@/components/Component';
import { registerTab } from '@/components/tabs/registry';
import { state } from '@/services/state';
import { seekTo } from '@/content/selectors';
import { SEARCH_DEBOUNCE_MS } from '@/utils/constants';

export class SearchTab extends Component {
    private searchTimeout: number | null = null;

    mount(parent: HTMLElement): void {
        this.el = document.createElement('div');
        this.el.id = 'yt-search-view';
        this.el.className = 'yt-view';
        this.el.innerHTML = `
      <div class="yt-search-input-wrap">
        <input id="yt-search-input" class="yt-input" placeholder="search in transcript..." autocomplete="off">
      </div>
      <div id="yt-search-results" class="yt-results">
        <div class="yt-empty">type to search transcript</div>
      </div>`;
        parent.appendChild(this.el);

        this.bindEvents();
    }

    unmount(): void {
        if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
        super.unmount();
    }

    /** Re-run search if input has a value (called after transcript updates) */
    refreshSearch(): void {
        const input = this.q<HTMLInputElement>('#yt-search-input');
        if (input?.value) this.renderSearch(input.value);
    }

    // --- events ---

    private bindEvents(): void {
        const input = this.q<HTMLInputElement>('#yt-search-input');
        input?.addEventListener(
            'input',
            (e) => {
                const value = (e.target as HTMLInputElement).value;
                if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
                this.searchTimeout = window.setTimeout(() => this.renderSearch(value), SEARCH_DEBOUNCE_MS);
            },
            { signal: this.signal },
        );

        // Row clicks → seek
        this.q('#yt-search-results')?.addEventListener(
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

    // --- search rendering ---

    private renderSearch(query: string): void {
        const container = this.q('#yt-search-results');
        if (!container) return;

        if (!query) {
            container.innerHTML = '<div class="yt-empty">type to search transcript</div>';
            return;
        }

        const { transcript } = state;
        if (!transcript.length) {
            container.innerHTML = '<div class="yt-empty">transcript not loaded</div>';
            return;
        }

        const q = query.toLowerCase();
        const matches = transcript.filter((t) => t.text.toLowerCase().includes(q));

        if (!matches.length) {
            container.innerHTML = '<div class="yt-empty">no matches found</div>';
            return;
        }

        container.innerHTML = `<div class="yt-result-count">${matches.length} result${matches.length === 1 ? '' : 's'}</div>`;

        for (const m of matches) {
            const row = document.createElement('div');
            row.className = 'yt-row';
            row.dataset.seconds = String(m.seconds);

            const timeDiv = document.createElement('div');
            timeDiv.className = 'yt-time';
            timeDiv.textContent = m.time;

            const textDiv = document.createElement('div');
            textDiv.className = 'yt-text';
            highlightText(textDiv, m.text, query);

            row.append(timeDiv, textDiv);
            container.appendChild(row);
        }
    }
}

/** Highlight query matches using DOM nodes (safe against XSS) */
function highlightText(container: HTMLElement, text: string, query: string): void {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let lastIndex = 0;

    let pos = lowerText.indexOf(lowerQuery, lastIndex);
    while (pos !== -1) {
        if (pos > lastIndex) {
            container.appendChild(document.createTextNode(text.slice(lastIndex, pos)));
        }
        const mark = document.createElement('mark');
        mark.textContent = text.slice(pos, pos + query.length);
        container.appendChild(mark);
        lastIndex = pos + query.length;
        pos = lowerText.indexOf(lowerQuery, lastIndex);
    }

    if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}

// --- register ---

registerTab({
    id: 'search',
    label: 'Search',
    create: () => new SearchTab(),
    onActivate: () => {
        requestAnimationFrame(() => {
            document.getElementById('yt-search-input')?.focus();
        });
    },
});
