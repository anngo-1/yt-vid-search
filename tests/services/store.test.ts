import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../../src/services/store';

describe('Store', () => {
    let store: Store;

    beforeEach(() => {
        store = new Store();
    });

    it('get() returns initial state values', () => {
        expect(store.get('currentVideoId')).toBeNull();
        expect(store.get('transcript')).toEqual([]);
        expect(store.get('captionFontSize')).toBe(48);
        expect(store.get('autoSync')).toBe(true);
    });

    it('set() updates state values', () => {
        store.set('currentVideoId', 'abc123');
        expect(store.get('currentVideoId')).toBe('abc123');

        store.set('captionFontSize', 60);
        expect(store.get('captionFontSize')).toBe(60);
    });

    it('state property reflects current state', () => {
        store.set('currentVideoId', 'xyz');
        expect(store.state.currentVideoId).toBe('xyz');
    });

    it('on() fires listeners on change', () => {
        const values: (string | null)[] = [];
        store.on('currentVideoId', (v) => values.push(v));

        store.set('currentVideoId', 'vid1');
        store.set('currentVideoId', 'vid2');

        expect(values).toEqual(['vid1', 'vid2']);
    });

    it('on() does not fire when value is the same', () => {
        store.set('captionFontSize', 48);
        const calls: number[] = [];
        store.on('captionFontSize', (v) => calls.push(v));

        store.set('captionFontSize', 48); // same value
        expect(calls).toEqual([]);

        store.set('captionFontSize', 60); // different value
        expect(calls).toEqual([60]);
    });

    it('on() provides previous value', () => {
        store.set('captionFontSize', 30);
        let prevVal: number | undefined;
        store.on('captionFontSize', (_v, prev) => {
            prevVal = prev;
        });

        store.set('captionFontSize', 50);
        expect(prevVal).toBe(30);
    });

    it('multiple listeners on same key', () => {
        const calls1: string[] = [];
        const calls2: string[] = [];

        store.on('targetLanguage', (v) => calls1.push(v));
        store.on('targetLanguage', (v) => calls2.push(v));

        store.set('targetLanguage', 'Spanish');

        expect(calls1).toEqual(['Spanish']);
        expect(calls2).toEqual(['Spanish']);
    });

    it('unsubscribe removes listener', () => {
        const calls: boolean[] = [];
        const unsub = store.on('captionsEnabled', (v) => calls.push(v));

        store.set('captionsEnabled', true);
        expect(calls).toEqual([true]);

        unsub();
        store.set('captionsEnabled', false);
        expect(calls).toEqual([true]); // no second call
    });

    it('reset() clears video-specific state, keeps settings', () => {
        store.set('settings', { provider: 'openrouter', openrouter_api_key: 'key123' });
        store.set('currentVideoId', 'old-video');
        store.set('chatHistory', [{ role: 'user', content: 'hello' }]);
        store.set('captionFontSize', 60);
        store.set('topicsData', { topics: [] });

        store.reset('new-video');

        expect(store.get('currentVideoId')).toBe('new-video');
        expect(store.get('chatHistory')).toEqual([]);
        expect(store.get('topicsData')).toBeNull();
        expect(store.get('transcript')).toEqual([]);
        // Settings and font size should be preserved
        expect(store.get('settings').openrouter_api_key).toBe('key123');
        expect(store.get('captionFontSize')).toBe(60);
    });

    it('dispose() clears all listeners', () => {
        const calls: boolean[] = [];
        store.on('captionsEnabled', (v) => calls.push(v));

        store.dispose();
        store.set('captionsEnabled', true);
        expect(calls).toEqual([]); // no calls after dispose
    });

    it('notify() fires listeners with current value as both args', () => {
        store.set('captionFontSize', 42);
        const calls: Array<{ value: number; prev: number }> = [];
        store.on('captionFontSize', (v, prev) => calls.push({ value: v, prev }));

        store.notify('captionFontSize');

        expect(calls).toEqual([{ value: 42, prev: 42 }]);
    });

    it('notify() fires even without a preceding set()', () => {
        const calls: boolean[] = [];
        store.on('autoSync', (v) => calls.push(v));

        store.notify('autoSync');

        expect(calls).toEqual([true]);
    });

    it('notify() does nothing when no listeners registered', () => {
        expect(() => store.notify('currentVideoId')).not.toThrow();
    });

    it('constructor accepts partial initial state', () => {
        const custom = new Store({ currentVideoId: 'init-vid', captionFontSize: 30 });
        expect(custom.get('currentVideoId')).toBe('init-vid');
        expect(custom.get('captionFontSize')).toBe(30);
        expect(custom.get('autoSync')).toBe(true); // default preserved
    });

    describe('mutate()', () => {
        it('applies mutation function and notifies listeners', () => {
            store.set('pendingTranslations', new Set([1, 2]));
            const calls: Set<number>[] = [];
            store.on('pendingTranslations', (v) => calls.push(new Set(v)));

            store.mutate('pendingTranslations', (s) => {
                s.add(3);
                s.delete(1);
            });

            expect(store.get('pendingTranslations')).toEqual(new Set([2, 3]));
            expect(calls).toHaveLength(1);
            expect(calls[0]).toEqual(new Set([2, 3]));
        });

        it('notifies even when mutation makes no change', () => {
            store.set('chatHistory', [{ role: 'user', content: 'hi' }]);
            const calls: number[] = [];
            store.on('chatHistory', () => calls.push(1));

            store.mutate('chatHistory', () => {
                // no-op mutation
            });

            expect(calls).toHaveLength(1);
        });

        it('preserves object reference identity', () => {
            const original = new Set([10, 20]);
            store.set('pendingTranslations', original);

            store.mutate('pendingTranslations', (s) => s.add(30));

            expect(store.get('pendingTranslations')).toBe(original);
            expect(original.has(30)).toBe(true);
        });

        it('works with array mutations', () => {
            store.set('translatedSegments', { 0: 'hello' } as Record<number, string>);
            const calls: number[] = [];
            store.on('translatedSegments', () => calls.push(1));

            store.mutate('translatedSegments', (segs) => {
                segs[1] = 'world';
            });

            expect(store.get('translatedSegments')[1]).toBe('world');
            expect(calls).toHaveLength(1);
        });
    });
});
