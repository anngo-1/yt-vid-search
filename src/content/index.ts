/**
 * main - entry point and navigation handling
 */

// import css - vite will bundle this with content script
import '../styles/content.css';

// Import tab registrations — each import triggers registerTab()
import '@/components/tabs/TranscriptTab';
import '@/components/tabs/SearchTab';
import '@/components/tabs/ChatTab';
import '@/components/tabs/TopicsTab';

import { state, loadSettings, resetState } from '@/services/state';
import { store } from '@/services/store';
import { getVideoId } from '@/content/selectors';
import { Panel } from '@/components/Panel';
import { TranscriptTab } from '@/components/tabs/TranscriptTab';
import { clearRetryState, handleTranslationSync } from '@/features/translation';
import {
    findActiveSegmentIndex,
    parsePanelTranscript,
    parseTimedTextTranscript,
    parseTranscript,
} from '@/utils/transcript';
import { isOpenPanelMessage } from '@/services/validators';
import { showToast } from '@/services/notifications';
import { TRANSCRIPT_FETCH_TIMEOUT_MS } from '@/utils/constants';
import type { TranscriptSegment } from '@/types';

let panel: Panel | null = null;
let fetchTimeout: ReturnType<typeof setTimeout> | null = null;
// Monotonically-increasing counter. Incremented on every resetForNewVideo and
// every fresh fetchTranscript call. Async retries and response handlers
// capture the value at the time they start and bail out if it has changed.
let fetchId = 0;

const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
const TIMEDTEXT_EVENT = 'ask-transcript:timedtext';

function ensureSessionStorage(): void {
    const storageWithSession = chrome.storage as typeof chrome.storage & {
        session?: chrome.storage.StorageArea;
    };
    if (!storageWithSession.session) {
        storageWithSession.session = chrome.storage.local;
    }
}

function init(): void {
    ensureSessionStorage();
    loadSettings();
    injectTimedTextInterceptor();
    setupEventListeners();
    setupTimedTextListener();
    setupNavigationListener();
    setupErrorBoundary();
}

/** catch unhandled promise rejections from our extension */
function setupErrorBoundary(): void {
    window.addEventListener('unhandledrejection', (e) => {
        const error = e.reason;
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack || '' : '';
        const isOurs =
            msg.includes('ask-transcript') ||
            msg.includes('ApiError') ||
            msg.includes('AppError') ||
            stack.includes('ask-transcript') ||
            stack.includes('/content.js');
        if (isOurs) {
            console.error('[ask-transcript] Unhandled rejection:', error);
            showToast('An unexpected error occurred.', 'error');
        }
    });
}

function setupEventListeners(): void {
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message): undefined => {
        if (isOpenPanelMessage(message)) {
            togglePanel();
        }
        return undefined;
    });

    chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === 'local') loadSettings();
    });

    // --- video sync ---
    let syncScheduled = false;
    let lastVideo: HTMLVideoElement | null = null;
    let lastTime = 0;

    const scheduleSync = () => {
        if (syncScheduled) return;
        syncScheduled = true;
        requestAnimationFrame(() => {
            syncScheduled = false;
            if (lastVideo && (state.panelOpen || state.captionsEnabled)) {
                updateActiveSegment(lastTime);
            }
        });
    };

    const syncEvent = (e: Event) => {
        const video = e.target as HTMLVideoElement;
        if (video.tagName !== 'VIDEO') return;
        lastVideo = video;
        lastTime = video.currentTime;
        scheduleSync();
    };

    document.addEventListener('timeupdate', syncEvent, true);
    document.addEventListener('seeking', syncEvent, true);
    document.addEventListener('seeked', syncEvent, true);
}

/** Compute active segment index and set it in the store. Components react via subscriptions. */
function updateActiveSegment(seconds: number): void {
    const { transcript, transcriptOffset } = state;
    if (!transcript.length) return;

    const adjusted = seconds + transcriptOffset;
    const index = findActiveSegmentIndex(transcript, adjusted, state.lastActiveSegmentIndex);

    if (index !== (state.lastActiveSegmentIndex ?? -1)) {
        store.set('lastActiveSegmentIndex', index);
    }

    // Translation prefetch
    if (state.translationEnabled && index !== -1) {
        handleTranslationSync(index);
    }
}

// --- panel lifecycle ---

function togglePanel(): void {
    if (state.panelOpen && panel) {
        panel.hide();
    } else if (panel) {
        panel.show();
    } else if (state.transcript.length) {
        createPanel();
    } else if (!state.isOurFetch) {
        fetchTranscript();
    }
}

function createPanel(): void {
    if (panel) return;
    panel = new Panel();
    panel.mount(document.body);
}

function destroyPanel(): void {
    panel?.unmount();
    panel = null;
}

function handleTranscript(parsed: TranscriptSegment[], myFetchId: number): void {
    if (fetchId !== myFetchId || !state.isOurFetch) return;
    if (!parsed.length) return;

    store.set('transcript', parsed);
    store.set('fullTranscriptText', parsed.map((t) => `[${t.time}] ${t.text}`).join('\n'));
    clearFetchTimeout();

    closeYouTubePanel();
    createPanel();
    store.set('isOurFetch', false);
}

function setupTimedTextListener(): void {
    window.addEventListener(TIMEDTEXT_EVENT, ((event: Event) => {
        const customEvent = event as CustomEvent<{ url?: string; body?: string }>;
        const { url, body } = customEvent.detail ?? {};
        if (!url || !body || !state.isOurFetch) return;

        try {
            const requestUrl = new URL(url, window.location.href);
            const raw = JSON.parse(body) as unknown;

            if (requestUrl.pathname.includes('/api/timedtext')) {
                const videoId = requestUrl.searchParams.get('v');
                if (videoId && videoId === state.currentVideoId) {
                    const parsed = parseTimedTextTranscript(raw);
                    handleTranscript(parsed, fetchId);
                }
                return;
            }

            if (requestUrl.pathname.includes('/youtubei/v1/get_transcript')) {
                const parsed = parseTranscript(raw);
                handleTranscript(parsed, fetchId);
                return;
            }

            if (requestUrl.pathname.includes('/youtubei/v1/get_panel')) {
                const parsed = parsePanelTranscript(raw);
                handleTranscript(parsed, fetchId);
            }
        } catch {
            // ignore malformed timedtext payloads and wait for timeout
        }
    }) as EventListener);
}

function injectTimedTextInterceptor(): void {
    if (document.getElementById('ask-transcript-timedtext-interceptor')) return;
    if (!chrome?.runtime?.id) return;

    let interceptorUrl = '';
    try {
        interceptorUrl = chrome.runtime.getURL('timedtext-interceptor.js');
    } catch {
        return;
    }

    const script = document.createElement('script');
    script.id = 'ask-transcript-timedtext-interceptor';
    script.src = interceptorUrl;
    script.dataset.eventName = TIMEDTEXT_EVENT;
    script.addEventListener('load', () => script.remove());
    script.addEventListener('error', () => script.remove());

    (document.documentElement || document.head || document.body).appendChild(script);
}

function clickTranscriptButton(): boolean {
    const directSelectors = [
        'button[aria-label*="transcript" i]',
        'button[aria-label*="Show transcript" i]',
        'ytd-video-description-transcript-section-renderer button',
    ];

    for (const selector of directSelectors) {
        const button = document.querySelector<HTMLElement>(selector);
        if (button) {
            button.click();
            return true;
        }
    }
    return false;
}

// --- transcript fetching ---

const FETCH_MAX_RETRIES = 5;
const FETCH_INITIAL_DELAY = 300;

function fetchTranscript(retryCount = 0, myFetchId = ++fetchId): void {
    if (retryCount === 0) {
        store.set('isOurFetch', true);
        clearFetchTimeout();

        fetchTimeout = setTimeout(() => {
            if (state.isOurFetch && fetchId === myFetchId) {
                store.set('isOurFetch', false);
                store.set('transcript', []);
                store.set('fullTranscriptText', '');
                closeYouTubePanel();
                if (panel) {
                    panel.getTab<TranscriptTab>('transcript')?.renderMessage('No transcript available for this video.');
                } else {
                    showToast('No transcript available for this video.', 'error');
                }
            }
        }, TRANSCRIPT_FETCH_TIMEOUT_MS);

        // Expand YouTube's description only once — it's a toggle, so clicking
        // again on retries would collapse it and hide the transcript button.
        const expandBtn = document.querySelector<HTMLElement>('tp-yt-paper-button#expand');
        if (expandBtn) expandBtn.click();
    }

    setTimeout(() => {
        // Bail out if this fetch was superseded by a newer one (e.g. video changed)
        if (fetchId !== myFetchId) return;

        if (clickTranscriptButton()) {
            return;
        }

        if (!state.isOurFetch || fetchId !== myFetchId) return;

        if (retryCount >= FETCH_MAX_RETRIES) {
            clearFetchTimeout();
            store.set('isOurFetch', false);
            store.set('transcript', []);
            store.set('fullTranscriptText', '');
            closeYouTubePanel();
            showToast('Could not find transcript button. Try opening transcript manually.', 'error');
            return;
        }

        // YouTube's DOM may not be ready after SPA navigation, retry with backoff
        const delay = retryCount < 2 ? 500 : 1000;
        setTimeout(() => fetchTranscript(retryCount + 1, myFetchId), delay);
    }, FETCH_INITIAL_DELAY);
}

function clearFetchTimeout(): void {
    if (fetchTimeout) {
        clearTimeout(fetchTimeout);
        fetchTimeout = null;
    }
}

function closeYouTubePanel(): void {
    const panels = document.querySelectorAll<HTMLElement>(PANEL_SELECTOR);
    for (const segmentPanel of Array.from(panels)) {
        const closeBtn = segmentPanel.querySelector<HTMLElement>(
            '#visibility-button button, tp-yt-icon-button#visibility-button, button[aria-label*="Close" i]',
        );
        closeBtn?.click();
    }
}

/** setup listener for youtube navigation to reset state */
function setupNavigationListener(): void {
    const handleNavigation = () => {
        const videoId = getVideoId();
        if (videoId) {
            if (videoId !== state.currentVideoId) {
                resetForNewVideo(videoId);
            }
        } else {
            closeAndCleanup();
        }
    };

    window.addEventListener('yt-navigate-finish', handleNavigation);
    window.addEventListener('yt-page-data-updated', handleNavigation);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleNavigation();
        }
    });

    handleNavigation();
}

function resetForNewVideo(videoId: string): void {
    fetchId++; // invalidate any in-flight observer, poller, or retry callbacks
    clearFetchTimeout();
    closeYouTubePanel();
    store.set('isOurFetch', false);

    store.set('transcript', []);
    store.set('fullTranscriptText', '');

    resetState(videoId);
    clearRetryState();
    destroyPanel();

    setTimeout(() => {
        if (state.currentVideoId === videoId) {
            if (state.settings.auto_open_transcript) {
                fetchTranscript();
            }
        }
    }, 100);
}

function closeAndCleanup(): void {
    destroyPanel();
    closeYouTubePanel();
    store.set('currentVideoId', null);
    store.set('buttonVideoId', null);
    store.set('transcript', []);
    store.set('fullTranscriptText', '');
    store.set('isOurFetch', false);
    clearFetchTimeout();
}

init();
