/**
 * store - lightweight reactive wrapper around AppState
 */

import type { AppState } from '@/types';
import { createInitialState } from '@/types';

type Listener<T> = (value: T, prev: T) => void;

export class Store {
    private _state: AppState;
    private _listeners = new Map<string, Set<Listener<unknown>>>();

    constructor(initial?: Partial<AppState>) {
        this._state = { ...createInitialState(), ...initial };
    }

    get state(): AppState {
        return this._state;
    }

    get<K extends keyof AppState>(key: K): AppState[K] {
        return this._state[key];
    }

    set<K extends keyof AppState>(key: K, value: AppState[K]): void {
        const prev = this._state[key];
        this._state[key] = value;
        if (prev !== value) {
            this._listeners.get(key as string)?.forEach((fn) => fn(value, prev));
        }
    }

    /** Force-notify listeners after in-place mutation of a value (Set, Object, etc.) */
    notify<K extends keyof AppState>(key: K): void {
        const value = this._state[key];
        this._listeners.get(key as string)?.forEach((fn) => fn(value, value));
    }

    /** Mutate a value in-place and automatically notify listeners */
    mutate<K extends keyof AppState>(key: K, fn: (value: AppState[K]) => void): void {
        fn(this._state[key]);
        this.notify(key);
    }

    on<K extends keyof AppState>(key: K, fn: Listener<AppState[K]>): () => void {
        const k = key as string;
        if (!this._listeners.has(k)) this._listeners.set(k, new Set());
        this._listeners.get(k)!.add(fn as Listener<unknown>);
        return () => this._listeners.get(k)?.delete(fn as Listener<unknown>);
    }

    reset(videoId: string): void {
        this.set('currentVideoId', videoId);
        this.set('transcript', []);
        this.set('fullTranscriptText', '');
        this.set('chatHistory', []);
        this.set('buttonVideoId', null);
        this.set('topicsVideoId', null);
        this.set('topicsData', null);
        this.set('isChatCleared', false);
        this.set('transcriptOffset', 0);
        this.set('captionsEnabled', false);
        this.set('translationEnabled', false);
        this.set('translatedSegments', {});
        this.set('lastActiveSegmentIndex', undefined);
        this.set('panelCreating', false);
        this.set('pendingTranslations', new Set());
        this.set('comments', []);
        this.set('commentsLoading', false);
        this.set('commentsError', null);
    }

    dispose(): void {
        this._listeners.clear();
    }
}

/** default store instance */
export const store = new Store();
