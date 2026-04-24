/**
 * Panel - main extension panel (header + tab bar + content area)
 *
 * Reads TAB_REGISTRY to build tabs dynamically. Manages CaptionOverlay lifecycle.
 * To add a tab: create a new file in tabs/, call registerTab(). No changes here needed.
 */

import { Component } from '@/components/Component';
import { CaptionOverlay } from '@/components/CaptionOverlay';
import { TAB_REGISTRY, type TabDefinition } from '@/components/tabs/registry';
import type { ChatTab } from '@/components/tabs/ChatTab';
import type { TopicsTab } from '@/components/tabs/TopicsTab';
import { state } from '@/services/state';
import { store } from '@/services/store';
import { loadSettings, isProviderConfigured } from '@/services/state';
import { ICONS } from '@/content/icons';
import { createElement } from '@/content/selectors';
import { makeDraggable } from '@/utils/drag';
import { downloadTranscript, copyTranscript } from '@/utils/download';
import { isAutoGenerateEnabled } from '@/features/topics';

export class Panel extends Component {
    private tabs = new Map<string, Component>();
    private tabViews = new Map<string, HTMLElement>();
    private activeTabId = '';
    private captionOverlay: CaptionOverlay | null = null;
    private contentEl: HTMLElement | null = null;

    mount(parent: HTMLElement): void {
        if (document.getElementById('yt-custom-panel') || state.panelCreating) return;
        store.set('panelCreating', true);

        this.el = createElement('div', 'yt-panel');
        this.el.id = 'yt-custom-panel';

        // Header
        const header = createElement('div', 'yt-panel-header');
        header.innerHTML = `
      <span class="yt-panel-title">Transcript</span>
      <span id="yt-token-count" class="yt-token-count"></span>
      <button class="yt-icon-btn" id="yt-copy-btn" title="Copy transcript">
        ${ICONS.COPY}
      </button>
      <button class="yt-icon-btn" id="yt-download-btn" title="Download transcript">
        ${ICONS.DOWNLOAD}
      </button>
      <button class="yt-icon-btn" id="yt-close-btn">
        ${ICONS.CLOSE}
      </button>`;

        // Tab bar - built from registry
        const tabBar = createElement('div', 'yt-tab-bar');
        TAB_REGISTRY.forEach((def, i) => {
            const btn = createElement('button', `yt-tab${i === 0 ? ' active' : ''}`);
            btn.textContent = def.label;
            btn.dataset.tab = def.id;
            tabBar.appendChild(btn);
        });

        // Content area
        const content = createElement('div', 'yt-content');

        this.el.append(header, tabBar, content);
        parent.appendChild(this.el);

        makeDraggable(this.el, header, this.signal);

        this.contentEl = content;

        // Mount the initial tab only; the rest are created on first activation.
        const initialTab = TAB_REGISTRY[0];
        if (initialTab) {
            this.activeTabId = initialTab.id;
            this.mountTab(initialTab, content);
        }

        // Header events
        this.q('#yt-close-btn')?.addEventListener('click', () => this.hide(), { signal: this.signal });
        this.q('#yt-copy-btn')?.addEventListener('click', () => copyTranscript(), { signal: this.signal });
        this.q('#yt-download-btn')?.addEventListener('click', () => downloadTranscript(), { signal: this.signal });

        // Tab switching
        tabBar.addEventListener(
            'click',
            (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement) || !target.dataset.tab) return;
                this.switchTab(target.dataset.tab, tabBar, content);
            },
            { signal: this.signal },
        );

        // Tab bar horizontal drag scrolling
        // Removed scrollable tabs for now

        // Escape key
        document.addEventListener(
            'keydown',
            (e) => {
                if (e.key === 'Escape') this.hide();
            },
            { signal: this.signal },
        );

        // Captions lifecycle (reactive)
        this.listen('captionsEnabled', (enabled) => {
            if (enabled && !this.captionOverlay) {
                this.captionOverlay = new CaptionOverlay();
                this.captionOverlay.mount(document.body);
            } else if (!enabled) {
                this.captionOverlay?.unmount();
                this.captionOverlay = null;
            }
        });

        // Token count
        this.listen('fullTranscriptText', () => this.updateTokenCount());

        store.set('panelOpen', true);
        store.set('panelCreating', false);

        // Async init
        this.initialize();
    }

    hide(): void {
        if (this.el) this.el.style.display = 'none';
        store.set('panelOpen', false);
    }

    show(): void {
        if (this.el) this.el.style.display = 'flex';
        store.set('panelOpen', true);
    }

    unmount(): void {
        this.tabs.forEach((tab) => tab.unmount());
        this.tabs.clear();
        this.tabViews.clear();
        this.contentEl = null;
        this.captionOverlay?.unmount();
        this.captionOverlay = null;
        store.set('panelOpen', false);
        store.set('panelCreating', false);
        super.unmount();
    }

    /** Get a mounted tab by ID */
    getTab<T extends Component>(id: string): T | undefined {
        return this.tabs.get(id) as T | undefined;
    }

    // --- private ---

    private mountTab(defOrId: TabDefinition | string, content = this.contentEl): Component | undefined {
        if (!content) return undefined;

        const def = typeof defOrId === 'string' ? TAB_REGISTRY.find((d) => d.id === defOrId) : defOrId;
        if (!def) return undefined;

        const existing = this.tabs.get(def.id);
        if (existing) return existing;

        const childCount = content.children.length;
        const tab = def.create();
        tab.mount(content);
        this.tabs.set(def.id, tab);

        const view = content.children[childCount];
        if (view instanceof HTMLElement) {
            view.classList.toggle('active', def.id === this.activeTabId);
            this.tabViews.set(def.id, view);
        }

        this.updateKeyWarningForTab(def.id, tab);
        return tab;
    }

    private async initialize(): Promise<void> {
        await loadSettings();
        this.updateTokenCount();
        this.updateKeyWarnings();

        // Restore captions if they were enabled
        if (state.captionsEnabled && !this.captionOverlay) {
            this.captionOverlay = new CaptionOverlay();
            this.captionOverlay.mount(document.body);
        }

        // Auto-generate topics if configured
        if (state.transcript.length && isProviderConfigured() && isAutoGenerateEnabled()) {
            const topicsTab = this.mountTab('topics') as TopicsTab | undefined;
            topicsTab?.generate();
        }
    }

    private switchTab(id: string, tabBar: HTMLElement, content: HTMLElement): void {
        if (id === this.activeTabId) return;
        this.activeTabId = id;
        this.mountTab(id, content);

        // Update tab bar buttons
        tabBar.querySelectorAll('.yt-tab').forEach((btn) => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === id);
        });

        // Show/hide views
        this.tabViews.forEach((view, viewId) => {
            view.classList.toggle('active', viewId === id);
        });

        // Fire onActivate callback
        const def = TAB_REGISTRY.find((d) => d.id === id);
        def?.onActivate?.();
    }

    private updateTokenCount(): void {
        const el = this.q('#yt-token-count');
        if (!el) return;
        const text = state.fullTranscriptText;
        if (text) {
            const tokens = Math.ceil(text.length / 4);
            el.textContent = `~${tokens.toLocaleString()} tokens`;
        }
    }

    private updateKeyWarnings(): void {
        const configured = isProviderConfigured();
        const message = configured ? '' : '⚠️ No API key configured. Set one in the extension popup.';

        const chatTab = this.getTab<ChatTab>('ask');
        chatTab?.updateKeyWarning(message);

        const topicsTab = this.getTab<TopicsTab>('topics');
        topicsTab?.updateKeyWarning(message);
    }

    private updateKeyWarningForTab(id: string, tab: Component): void {
        const configured = isProviderConfigured();
        const message = configured ? '' : '⚠️ No API key configured. Set one in the extension popup.';

        if (id === 'ask') {
            (tab as ChatTab).updateKeyWarning(message);
        } else if (id === 'topics') {
            (tab as TopicsTab).updateKeyWarning(message);
        }
    }
}
