/** Opt-in, local-only diagnostics. No timers/observers or history while disabled. */
import { store } from '@/services/store';
import { safePersist } from '@/utils/storage';
import { makeDraggable } from '@/utils/drag';

const MiB = 1024 ** 2;
let active: LiveDebug | null = null;

function heapMiB(): number | null {
    // Chromium's deprecated, approximate, shared-renderer JS heap API. Not
    // extension-only RAM, native DOM/video/GPU memory, or the background worker.
    try {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        const used = memory?.usedJSHeapSize;
        return typeof used === 'number' && Number.isFinite(used) && used > 0 ? used / MiB : null;
    } catch {
        return null;
    }
}

class LiveDebug {
    private host = document.createElement('aside');
    private shadow = this.host.attachShadow({ mode: 'open' });
    private output = document.createElement('pre');
    private abort = new AbortController();
    private timer: ReturnType<typeof setInterval>;
    private observer: PerformanceObserver | null = null;
    private unsubscribe: () => void;
    private started = performance.now();
    private baseline = heapMiB();
    private peak = this.baseline;
    private generation = 0;
    private longTasks = { count: 0, totalMs: 0, maxMs: 0 };
    private fetchStarted: number | null = null;
    private payloadAt: number | null = null;
    private timings: {
        fetchMs: number | null;
        parseMs: number | null;
        renderMs: number | null;
        readyMs: number | null;
    } = {
        fetchMs: null,
        parseMs: null,
        renderMs: null,
        readyMs: null,
    };

    constructor() {
        this.host.id = 'ask-transcript-debug';
        this.host.setAttribute('aria-label', 'Ask Transcript live debug');
        this.host.style.cssText = 'all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483647;';
        this.shadow.innerHTML = `<style>
            :host { color-scheme: dark; }
            section { box-sizing:border-box; width:360px; min-width:240px; min-height:220px;
                max-width:calc(100vw - 24px); max-height:calc(100vh - 24px);
                resize:both; overflow:hidden; display:flex; flex-direction:column;
                cursor:grab; user-select:none; touch-action:none;
                padding:12px; border:1px solid #555; border-radius:8px; background:#171717f5;
                color:#eee; font:12px/1.5 monospace; box-shadow:0 4px 20px #0008; }
            header { display:flex; flex-shrink:0; align-items:center; gap:8px; margin-bottom:8px; }
            #metrics { flex:1; min-height:0; overflow:auto; }
            footer { flex-shrink:0; }
            strong { flex:1; }
            button { cursor:pointer; background:#333; color:#eee;
                border:1px solid #666; border-radius:4px; padding:3px 7px; font:inherit; }
            pre { margin:8px 0; white-space:pre-wrap; font:inherit; overflow-wrap:anywhere; }
            p { margin:8px 0 0; color:#bbb; font:11px/1.4 sans-serif; }
        </style><section title="Drag anywhere to move · Bottom-right corner to resize">
            <header><strong id="drag-handle">Ask Transcript · live debug</strong><button id="close" aria-label="Disable live debug">×</button></header>
            <div id="metrics"></div>
            <footer><button id="reset">Reset baseline</button> <button id="copy">Copy snapshot</button>
            <p>Heap and long tasks include YouTube, not just this extension. Heap is approximate;
            excludes native/video/GPU memory. Debug sampling adds overhead. Updates every 1s.</p></footer>
        </section>`;
        this.shadow.querySelector('#metrics')!.appendChild(this.output);
        document.body.appendChild(this.host);
        // Like captions, the whole surface is a drag handle, not just the title.
        makeDraggable(this.host, this.shadow.querySelector('section')!, this.abort.signal);
        this.shadow
            .querySelector('#reset')!
            .addEventListener('click', () => this.reset(), { signal: this.abort.signal });
        this.shadow.querySelector('#close')!.addEventListener(
            'click',
            () => {
                store.set('settings', { ...store.state.settings, live_debug: false });
                safePersist({ live_debug: false });
            },
            { signal: this.abort.signal },
        );
        this.shadow.querySelector('#copy')!.addEventListener(
            'click',
            async (event) => {
                const button = event.currentTarget as HTMLButtonElement;
                try {
                    // Only numeric diagnostics and video ID; never settings, keys, or transcript/chat text.
                    await navigator.clipboard.writeText(JSON.stringify(this.snapshot(), null, 2));
                    button.textContent = 'Copied';
                } catch {
                    button.textContent = 'Copy failed';
                }
            },
            { signal: this.abort.signal },
        );
        this.unsubscribe = store.on('currentVideoId', () => this.reset());
        try {
            if (
                typeof PerformanceObserver !== 'undefined' &&
                PerformanceObserver.supportedEntryTypes?.includes('longtask')
            ) {
                this.observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.startTime < this.started) continue;
                        this.longTasks.count++;
                        this.longTasks.totalMs += entry.duration;
                        this.longTasks.maxMs = Math.max(this.longTasks.maxMs, entry.duration);
                    }
                });
                this.observer.observe({ type: 'longtask' });
            }
        } catch {
            this.observer?.disconnect();
            this.observer = null;
        }
        this.timer = setInterval(() => {
            if (document.visibilityState !== 'hidden') this.render();
        }, 1000);
        this.render();
    }

    reset(): void {
        this.generation++;
        this.started = performance.now();
        this.baseline = heapMiB();
        this.peak = this.baseline;
        this.longTasks = { count: 0, totalMs: 0, maxMs: 0 };
        this.observer?.takeRecords();
        this.fetchStarted = null;
        this.payloadAt = null;
        this.timings = { fetchMs: null, parseMs: null, renderMs: null, readyMs: null };
        this.render();
    }

    startFetch(): void {
        this.fetchStarted = performance.now();
        this.payloadAt = null;
        this.timings = { fetchMs: null, parseMs: null, renderMs: null, readyMs: null };
    }

    receivePayload(): void {
        this.payloadAt = performance.now();
        if (this.fetchStarted !== null) this.timings.fetchMs = this.payloadAt - this.fetchStarted;
    }

    parsed(): void {
        if (this.payloadAt !== null) this.timings.parseMs = performance.now() - this.payloadAt;
    }

    startRender(): () => void {
        const started = performance.now();
        const generation = this.generation;
        return () => {
            if (active !== this || this.generation !== generation) return;
            const now = performance.now();
            this.timings.renderMs = now - started;
            if (this.fetchStarted !== null && this.timings.readyMs === null) {
                this.timings.readyMs = now - this.fetchStarted;
            }
        };
    }

    private snapshot() {
        const state = store.state;
        const heap = heapMiB();
        if (heap !== null) this.peak = Math.max(this.peak ?? heap, heap);
        const panel = document.getElementById('yt-custom-panel');
        const captions = document.getElementById('yt-caption-overlay');
        const elements = (el: HTMLElement | null) => (el ? 1 + el.getElementsByTagName('*').length : 0);
        return {
            timestamp: new Date().toISOString(),
            videoId: state.currentVideoId,
            sinceResetMs: performance.now() - this.started,
            tabHeapMiB: heap,
            tabHeapDeltaMiB: heap !== null && this.baseline !== null ? heap - this.baseline : null,
            tabHeapSampledPeakMiB: this.peak,
            tabLongTasks: this.observer ? { ...this.longTasks } : null,
            extensionElements: elements(panel) + elements(captions), // Excludes the debug UI itself.
            panelOpen: state.panelOpen,
            fetching: state.isOurFetch,
            transcriptSegments: state.transcript.length,
            renderedRows: panel?.querySelectorAll('#yt-transcript-rows .yt-row').length ?? 0,
            transcriptCharacters: state.fullTranscriptText.length,
            translatedSegments: Object.keys(state.translatedSegments).length,
            pendingTranslations: state.pendingTranslations.size,
            chatMessages: state.chatHistory.length,
            timings: { ...this.timings },
        };
    }

    private render(): void {
        const s = this.snapshot();
        const memory = (n: number | null) => (n === null ? 'unavailable' : `${n.toFixed(1)} MiB`);
        const ms = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} ms`);
        this.output.textContent = [
            `Video: ${s.videoId ?? 'none'} · ${(s.sinceResetMs / 1000).toFixed(0)}s since reset`,
            `Tab JS heap ≈ ${memory(s.tabHeapMiB)}`,
            `Heap Δ: ${memory(s.tabHeapDeltaMiB)} · peak: ${memory(s.tabHeapSampledPeakMiB)}`,
            `Tab long tasks (>50ms): ${s.tabLongTasks ? `${s.tabLongTasks.count} / ${ms(s.tabLongTasks.totalMs)}` : 'unavailable'}`,
            `Longest task: ${ms(s.tabLongTasks?.maxMs ?? null)}`,
            '',
            `Panel: ${s.panelOpen ? 'open' : 'closed'} · fetch: ${s.fetching ? 'pending' : 'idle'}`,
            `Extension DOM elements: ${s.extensionElements}`,
            `Transcript: ${s.transcriptSegments} segments / ${s.renderedRows} rows`,
            `Transcript text: ${s.transcriptCharacters.toLocaleString()} chars`,
            `Translations: ${s.translatedSegments} cached / ${s.pendingTranslations} pending`,
            `Chat messages: ${s.chatMessages}`,
            '',
            `Fetch → payload: ${ms(s.timings.fetchMs)}`,
            `Payload parse: ${ms(s.timings.parseMs)}`,
            `Latest DOM render: ${ms(s.timings.renderMs)}`,
            `Fetch → rows ready: ${ms(s.timings.readyMs)}`,
        ].join('\n');
    }

    dispose(): void {
        clearInterval(this.timer);
        this.observer?.disconnect();
        this.unsubscribe();
        this.abort.abort();
        this.host.remove();
    }
}

/** Settings changes toggle immediately in all YouTube tabs; return cleanup for tests/lifecycle. */
export function setupLiveDebug(): () => void {
    const sync = () => {
        if (store.state.settings.live_debug) {
            active ??= new LiveDebug();
        } else {
            active?.dispose();
            active = null;
        }
    };
    const unsubscribe = store.on('settings', sync);
    sync();
    return () => {
        unsubscribe();
        active?.dispose();
        active = null;
    };
}

export function debugFetchStarted(): void {
    active?.startFetch();
}
export function debugPayloadReceived(): void {
    active?.receivePayload();
}
export function debugTranscriptParsed(): void {
    active?.parsed();
}
export function debugRenderStarted(): (() => void) | undefined {
    return active?.startRender();
}
