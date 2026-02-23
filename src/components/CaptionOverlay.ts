/**
 * CaptionOverlay - floating caption overlay for transcript segments
 *
 * Subscribes to state changes and updates autonomously.
 * Managed by Panel (created/destroyed when captionsEnabled changes).
 */

import { Component } from '@/components/Component';
import { state } from '@/services/state';
import { store } from '@/services/store';
import { makeDraggable, makeResizable } from '@/utils/drag';
import { safePersist } from '@/utils/storage';
import { isOldPositionFormat, migratePosition } from '@/features/captions';
import { DEFAULT_CAPTION_WIDTH, DEFAULT_CAPTION_HEIGHT, FONT_SIZE_MIN } from '@/utils/constants';
import type { CenterPosition } from '@/types';

export class CaptionOverlay extends Component {
    private textEl: HTMLElement | null = null;
    private translatedEl: HTMLElement | null = null;

    mount(parent: HTMLElement): void {
        // Remove any existing overlay
        document.getElementById('yt-caption-overlay')?.remove();

        this.el = document.createElement('div');
        this.el.id = 'yt-caption-overlay';
        this.el.className = 'yt-caption-overlay';

        const textWrap = document.createElement('div');
        textWrap.className = 'yt-text-wrap';

        this.textEl = document.createElement('div');
        this.textEl.className = 'yt-caption-text';

        this.translatedEl = document.createElement('div');
        this.translatedEl.className = 'yt-translated-text';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'yt-caption-resize';

        textWrap.append(this.textEl, this.translatedEl);
        this.el.append(textWrap, resizeHandle);
        parent.appendChild(this.el);

        this.applyPosition();
        this.applySize();
        this.applyBackground();
        this.applyStyles();

        makeDraggable(this.el, this.el, this.signal, (pos: CenterPosition) => {
            store.set('captionPosition', pos);
            safePersist({ captionPosition: pos });
        });

        makeResizable(this.el, resizeHandle, this.signal, (size) => {
            store.set('captionSize', size);
            safePersist({ captionSize: size });
        });

        // React to state changes
        this.listen('lastActiveSegmentIndex', () => this.updateText());
        this.listen('translatedSegments', () => this.updateText());
        this.listen('translationEnabled', () => this.updateText());
        this.listen('captionFontSize', () => this.applyStyles());
        this.listen('captionBackgroundEnabled', () => this.applyBackground());

        // Initial text
        this.updateText();
    }

    unmount(): void {
        this.textEl = null;
        this.translatedEl = null;
        super.unmount();
    }

    // --- state-driven updates ---

    private updateText(): void {
        if (!this.textEl || !this.translatedEl) return;

        const { transcript, lastActiveSegmentIndex: idx, translationEnabled, translatedSegments } = state;

        if (idx === undefined || idx === -1 || !transcript[idx]) {
            this.textEl.textContent = '';
            this.translatedEl.textContent = '';
            return;
        }

        const original = transcript[idx].text;

        if (translationEnabled) {
            const translated = translatedSegments[idx];
            this.textEl.textContent = '';
            this.textEl.style.display = 'none';
            this.translatedEl.textContent = translated || 'translating...';
            this.translatedEl.classList.add('is-main');
        } else {
            this.textEl.textContent = original;
            this.textEl.style.display = 'block';
            this.translatedEl.textContent = '';
            this.translatedEl.classList.remove('is-main');
        }

        this.applyStyles();
    }

    private applyStyles(): void {
        if (!this.textEl || !this.translatedEl) return;
        const size = state.captionFontSize;
        this.textEl.style.fontSize = `${size}px`;

        const isMain = this.translatedEl.classList.contains('is-main');
        const translationSize = isMain ? size : Math.max(FONT_SIZE_MIN, size - 8);
        this.translatedEl.style.fontSize = `${translationSize}px`;
    }

    private applyBackground(): void {
        if (!this.el) return;
        if (state.captionBackgroundEnabled) {
            this.el.style.background = 'var(--yt-bg-overlay)';
            this.el.classList.remove('yt-caption-transparent');
        } else {
            this.el.style.background = 'transparent';
            this.el.classList.add('yt-caption-transparent');
        }
    }

    private applyPosition(): void {
        if (!this.el) return;

        let pos = state.captionPosition as CenterPosition | { top: number; left: number } | null;
        const width = state.captionSize?.width || DEFAULT_CAPTION_WIDTH;
        const height = state.captionSize?.height || DEFAULT_CAPTION_HEIGHT;

        if (pos && isOldPositionFormat(pos as { top: number; left: number })) {
            pos = migratePosition(pos as { top: number; left: number }, width, height);
            store.set('captionPosition', pos as CenterPosition);
            safePersist({ captionPosition: pos });
        }

        if (pos && 'centerX' in pos) {
            const left = pos.centerX - width / 2;
            const top = pos.centerY - height / 2;
            this.el.style.left = `${Math.max(0, left)}px`;
            this.el.style.top = `${Math.max(0, top)}px`;
            this.el.style.right = 'auto';
            this.el.style.bottom = 'auto';
            this.el.style.transform = 'none';
        }
    }

    private applySize(): void {
        if (!this.el) return;
        const size = state.captionSize;
        if (size?.width) {
            this.el.style.width = `${size.width}px`;
            this.el.classList.add('yt-caption-resized');
        }
    }
}
