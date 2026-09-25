import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../src/services/store';
import {
    setupLiveDebug,
    debugFetchStarted,
    debugPayloadReceived,
    debugTranscriptParsed,
    debugRenderStarted,
} from '../../src/features/debug';
import { TranscriptTab } from '../../src/components/tabs/TranscriptTab';

const MiB = 1024 ** 2;
let cleanup: () => void;
let clock = 0;
let observerCallback: PerformanceObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
const takeRecords = vi.fn();
const writeText = vi.fn().mockResolvedValue(undefined);
const persist = vi.fn();
const originalMemory = Object.getOwnPropertyDescriptor(performance, 'memory');

function setHeap(mib: number): void {
    Object.defineProperty(performance, 'memory', { configurable: true, value: { usedJSHeapSize: mib * MiB } });
}

function overlay(): ShadowRoot | null {
    return document.getElementById('ask-transcript-debug')?.shadowRoot ?? null;
}

function enable(): void {
    store.set('settings', { live_debug: true });
}

async function snapshot() {
    overlay()!.querySelector<HTMLButtonElement>('#copy')!.click();
    await Promise.resolve();
    return JSON.parse(writeText.mock.lastCall![0]);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal(
        'PerformanceObserver',
        class {
            static supportedEntryTypes = ['longtask'];
            constructor(callback: PerformanceObserverCallback) {
                observerCallback = callback;
            }
            observe = observe;
            disconnect = disconnect;
            takeRecords = takeRecords;
        },
    );
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('chrome', { storage: { local: { set: persist } } });
    document.body.innerHTML = '';
    store.reset('video-a');
    store.set('settings', {});
    setHeap(100);
    cleanup = setupLiveDebug();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalMemory) Object.defineProperty(performance, 'memory', originalMemory);
    else Reflect.deleteProperty(performance, 'memory');
    document.body.innerHTML = '';
});

describe('live debug lifecycle', () => {
    it('is off by default, with no DOM, sampling timer, observer, or instrumentation', () => {
        expect(overlay()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        expect(observe).not.toHaveBeenCalled();
        debugFetchStarted();
        debugPayloadReceived();
        debugTranscriptParsed();
        expect(debugRenderStarted()).toBeUndefined();
    });

    it('starts once, survives unrelated settings updates, and cleans up completely when disabled', () => {
        enable();
        const host = overlay();
        store.set('settings', { live_debug: true, temperature: 0.5 });
        expect(overlay()).toBe(host);
        expect(vi.getTimerCount()).toBe(1);
        expect(observe).toHaveBeenCalledOnce();
        store.set('settings', { live_debug: false });
        expect(overlay()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        expect(disconnect).toHaveBeenCalledOnce();
        enable();
        expect(vi.getTimerCount()).toBe(1);
        expect(overlay()).not.toBe(host);
    });

    it('close disables the saved setting as well as the current overlay', () => {
        enable();
        overlay()!.querySelector<HTMLButtonElement>('#close')!.click();
        expect(persist).toHaveBeenCalledWith({ live_debug: false });
        expect(store.state.settings.live_debug).toBe(false);
        expect(overlay()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('live debug dragging', () => {
    let host: HTMLElement;
    let handle: HTMLElement;

    beforeEach(() => {
        enable();
        host = document.getElementById('ask-transcript-debug')!;
        handle = overlay()!.querySelector<HTMLElement>('#drag-handle')!;
        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 100, 360, 440));
    });

    function startDrag(): void {
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 25, clientY: 110, bubbles: true }));
    }

    it.each(['#drag-handle', 'header', 'pre', 'p', 'section'])(
        'drags from %s and keeps its position through metric updates and video changes',
        (selector) => {
            handle = overlay()!.querySelector<HTMLElement>(selector)!;
            startDrag();
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 125, clientY: 210 }));
            document.dispatchEvent(new MouseEvent('mouseup'));
            expect(host.style.left).toBe('112px');
            expect(host.style.top).toBe('200px');
            expect(host.style.bottom).toBe('auto');
            expect(host.style.transform).toBe('none');
            vi.advanceTimersByTime(1000);
            store.set('currentVideoId', 'video-b');
            expect(host.style.left).toBe('112px');
            expect(host.style.top).toBe('200px');
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
            expect(host.style.left).toBe('112px');
        },
    );

    it('preserves browser-set resize dimensions across updates, resets, and navigation', () => {
        // Native CSS resizing writes inline dimensions; jsdom cannot perform the resize gesture.
        const section = overlay()!.querySelector('section')!;
        section.style.width = '500px';
        section.style.height = '300px';
        vi.advanceTimersByTime(1000);
        overlay()!.querySelector<HTMLButtonElement>('#reset')!.click();
        store.set('currentVideoId', 'video-b');
        expect(overlay()!.querySelector('section')).toBe(section);
        expect(section.style.width).toBe('500px');
        expect(section.style.height).toBe('300px');

        // Dragging uses the resized bounds, not the default overlay dimensions.
        vi.mocked(host.getBoundingClientRect).mockReturnValue(new DOMRect(12, 100, 500, 300));
        startDrag();
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 5000 }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(host.style.left).toBe(`${Math.max(0, window.innerWidth - 500)}px`);
        expect(host.style.top).toBe(`${Math.max(0, window.innerHeight - 300)}px`);
    });

    it('clamps dragging to the viewport', () => {
        startDrag();
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: -1000, clientY: -1000 }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(host.style.left).toBe('0px');
        expect(host.style.top).toBe('0px');
        startDrag();
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 5000 }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(host.style.left).toBe(`${Math.max(0, window.innerWidth - 360)}px`);
        expect(host.style.top).toBe(`${Math.max(0, window.innerHeight - 440)}px`);
    });

    it('does not start dragging from buttons', () => {
        for (const selector of ['#close', '#reset', '#copy']) {
            overlay()!
                .querySelector(selector)!
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
            document.dispatchEvent(new MouseEvent('mouseup'));
            expect(host.style.left).toBe('12px');
            expect(host.style.top).toBe('');
            expect(host.style.bottom).toBe('12px');
        }
    });

    it('keeps native resize and scrollbar gestures separate from moving', () => {
        const section = overlay()!.querySelector('section')!;
        section.style.resize = 'both';
        vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 100, 360, 440));
        const metrics = overlay()!.querySelector<HTMLElement>('#metrics')!;
        vi.spyOn(metrics, 'getBoundingClientRect').mockReturnValue(new DOMRect(25, 140, 334, 250));
        Object.defineProperties(metrics, {
            scrollHeight: { value: 400, configurable: true },
            clientHeight: { value: 250, configurable: true },
            clientWidth: { value: 320, configurable: true },
        });
        for (const [target, x, y] of [
            [section, 368, 536],
            [metrics, 350, 200],
        ] as const) {
            target.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800, clientY: 800 }));
            document.dispatchEvent(new MouseEvent('mouseup'));
            expect(host.style.left).toBe('12px');
            expect(host.style.top).toBe('');
        }
    });

    it('continues dragging over page elements that stop mouse events from bubbling', () => {
        const player = document.createElement('div');
        document.body.appendChild(player);
        player.addEventListener('mousemove', (e) => e.stopPropagation());
        player.addEventListener('mouseup', (e) => e.stopPropagation());
        startDrag();
        player.dispatchEvent(new MouseEvent('mousemove', { clientX: 125, clientY: 210, bubbles: true }));
        player.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        expect(host.style.left).toBe('112px');
        expect(host.style.top).toBe('200px');
        player.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 400, bubbles: true }));
        expect(host.style.left).toBe('112px');
    });

    it('cancels a pending drag and its listeners when debug is disabled', () => {
        startDrag();
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 125, clientY: 210 }));
        store.set('settings', { live_debug: false });
        const style = host.style.cssText;
        vi.advanceTimersByTime(1000);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(host.style.cssText).toBe(style);
        expect(host.isConnected).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('live metrics', () => {
    it('samples heap delta/peak and resets the baseline on demand and on SPA video changes', async () => {
        enable();
        setHeap(125);
        vi.advanceTimersByTime(1000);
        expect(overlay()!.textContent).toContain('25.0 MiB');
        setHeap(110);
        let data = await snapshot();
        expect(data.tabHeapMiB).toBe(110);
        expect(data.tabHeapDeltaMiB).toBe(10);
        expect(data.tabHeapSampledPeakMiB).toBe(125);
        overlay()!.querySelector<HTMLButtonElement>('#reset')!.click();
        data = await snapshot();
        expect(data.tabHeapDeltaMiB).toBe(0);
        expect(data.tabHeapSampledPeakMiB).toBe(110);
        setHeap(130);
        store.set('currentVideoId', 'video-b');
        data = await snapshot();
        expect(data.videoId).toBe('video-b');
        expect(data.tabHeapDeltaMiB).toBe(0);
    });

    it('does not render live samples while the page is hidden', () => {
        enable();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        setHeap(200);
        vi.advanceTimersByTime(5000);
        expect(overlay()!.textContent).not.toContain('200.0 MiB');
    });

    it('degrades gracefully when memory/long-task APIs are absent', async () => {
        Reflect.deleteProperty(performance, 'memory');
        vi.stubGlobal('PerformanceObserver', undefined);
        enable();
        expect(overlay()!.textContent).toContain('unavailable');
        const data = await snapshot();
        expect(data.tabHeapMiB).toBeNull();
        expect(data.tabHeapDeltaMiB).toBeNull();
        expect(data.tabLongTasks).toBeNull();
    });

    it('aggregates long tasks without storing entries, ignoring entries from before a reset', async () => {
        enable();
        const deliver = (entries: { startTime: number; duration: number }[]) => {
            observerCallback({ getEntries: () => entries } as PerformanceObserverEntryList, {} as PerformanceObserver);
        };
        deliver([
            { startTime: 10, duration: 80 },
            { startTime: 100, duration: 120 },
        ]);
        expect((await snapshot()).tabLongTasks).toEqual({ count: 2, totalMs: 200, maxMs: 120 });
        clock = 500;
        store.set('currentVideoId', 'video-b');
        deliver([
            { startTime: 200, duration: 90 },
            { startTime: 600, duration: 60 },
        ]);
        expect((await snapshot()).tabLongTasks).toEqual({ count: 1, totalMs: 60, maxMs: 60 });
        expect(takeRecords).toHaveBeenCalled();
    });

    it('reports extension-only counts but never copies API keys or transcript/chat contents', async () => {
        document.body.innerHTML =
            '<div id="youtube"><p>unrelated</p></div><div id="yt-custom-panel"><div id="yt-transcript-rows"><div class="yt-row"></div></div></div>';
        store.set('transcript', [{ time: '0:00', seconds: 0, text: 'PRIVATE_TRANSCRIPT' }]);
        store.set('fullTranscriptText', 'PRIVATE_TRANSCRIPT');
        store.set('chatHistory', [{ role: 'user', content: 'PRIVATE_CHAT' }]);
        store.set('settings', { live_debug: true, openrouter_api_key: 'SECRET_KEY' });
        const data = await snapshot();
        expect(data.extensionElements).toBe(3);
        expect(data.transcriptSegments).toBe(1);
        expect(data.renderedRows).toBe(1);
        expect(data.chatMessages).toBe(1);
        expect(data.transcriptCharacters).toBe('PRIVATE_TRANSCRIPT'.length);
        expect(writeText.mock.lastCall![0]).not.toMatch(/PRIVATE_TRANSCRIPT|PRIVATE_CHAT|SECRET_KEY/);
    });
});

describe('transcript timings', () => {
    it('tracks fetch/parse/render separately and keeps the initial ready time across searches', async () => {
        enable();
        clock = 100;
        debugFetchStarted();
        clock = 200;
        debugPayloadReceived();
        clock = 220;
        debugTranscriptParsed();
        clock = 230;
        const finish = debugRenderStarted()!;
        clock = 280;
        finish();
        expect((await snapshot()).timings).toEqual({ fetchMs: 100, parseMs: 20, renderMs: 50, readyMs: 180 });
        clock = 300;
        const searchFinish = debugRenderStarted()!;
        clock = 330;
        searchFinish();
        expect((await snapshot()).timings).toEqual({ fetchMs: 100, parseMs: 20, renderMs: 30, readyMs: 180 });
    });

    it('does not attribute stale render completions to a new video or debug session', async () => {
        enable();
        debugFetchStarted();
        const finish = debugRenderStarted()!;
        store.set('currentVideoId', 'video-b');
        clock = 100;
        finish();
        expect((await snapshot()).timings.readyMs).toBeNull();
        store.set('settings', { live_debug: false });
        enable();
        finish();
        expect((await snapshot()).timings.renderMs).toBeNull();
    });

    it.each([5, 1001])(
        'instruments actual TranscriptTab rendering for %i rows, including async chunks',
        async (count) => {
            enable();
            debugFetchStarted();
            store.set(
                'transcript',
                Array.from({ length: count }, (_, i) => ({ time: '0:00', seconds: i, text: `Segment ${i}` })),
            );
            const parent = document.createElement('div');
            document.body.appendChild(parent);
            const tab = new TranscriptTab();
            try {
                clock = 10;
                tab.mount(parent);
                if (count > 500) expect((await snapshot()).timings.readyMs).toBeNull();
                clock = 50;
                vi.advanceTimersByTime(100);
                expect(parent.querySelectorAll('.yt-row')).toHaveLength(count);
                expect((await snapshot()).timings.readyMs).toBe(count > 500 ? 50 : 10);
            } finally {
                tab.unmount();
            }
        },
    );
});
