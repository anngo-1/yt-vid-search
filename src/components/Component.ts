/**
 * Component - base class for UI components with lifecycle management
 *
 * Each component owns its DOM, events, and store subscriptions.
 * Everything is auto-cleaned on unmount via AbortController + subscription tracking.
 */

import { store } from '@/services/store';
import type { AppState } from '@/types';

type Listener<T> = (value: T, prev: T) => void;

export abstract class Component {
    protected el: HTMLElement | null = null;
    private _ac = new AbortController();
    private _subs: (() => void)[] = [];

    /** AbortSignal for addEventListener cleanup */
    get signal(): AbortSignal {
        return this._ac.signal;
    }

    /** Subscribe to store changes (auto-cleaned on unmount) */
    protected listen<K extends keyof AppState>(key: K, fn: Listener<AppState[K]>): void {
        this._subs.push(store.on(key, fn));
    }

    /** Query within component's DOM */
    protected q<T extends HTMLElement = HTMLElement>(selector: string): T | null {
        return this.el?.querySelector<T>(selector) ?? null;
    }

    /** Setup a toggle button with status label */
    protected setupToggle(
        btn: HTMLElement | null,
        statusEl: HTMLElement | null,
        opts: {
            initial: boolean;
            onLabel: string;
            offLabel: string;
            onToggle: (enabled: boolean) => void;
        },
    ): void {
        if (!btn) return;
        btn.classList.toggle('active', opts.initial);
        if (statusEl) statusEl.textContent = opts.initial ? opts.onLabel : opts.offLabel;
        btn.addEventListener(
            'click',
            () => {
                const next = !btn.classList.contains('active');
                btn.classList.toggle('active', next);
                if (statusEl) statusEl.textContent = next ? opts.onLabel : opts.offLabel;
                opts.onToggle(next);
            },
            { signal: this.signal },
        );
    }

    /** Create DOM and bind events */
    abstract mount(parent: HTMLElement): void;

    /** Remove DOM, abort listeners, unsubscribe from store */
    unmount(): void {
        this._ac.abort();
        this._ac = new AbortController();
        this._subs.forEach((fn) => fn());
        this._subs = [];
        this.el?.remove();
        this.el = null;
    }
}
