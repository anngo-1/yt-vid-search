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
import { findActiveSegmentIndex } from '@/utils/transcript';
import { timeToSeconds } from '@/utils/time';
import { isOpenPanelMessage } from '@/services/validators';
import { showToast } from '@/services/notifications';
import { TRANSCRIPT_FETCH_TIMEOUT_MS } from '@/utils/constants';
import type { TranscriptSegment } from '@/types';

let panel: Panel | null = null;
let fetchTimeout: ReturnType<typeof setTimeout> | null = null;
let transcriptObserver: MutationObserver | null = null;
let observingForVideoId: string | null = null;

const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
const SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer';

function init(): void {
    loadSettings();
    setupEventListeners();
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

// --- transcript reading via DOM observer ---

function observeTranscriptPanel(): void {
    if (transcriptObserver) return;

    // Snapshot the video ID so we can discard segments that arrive after a switch
    observingForVideoId = state.currentVideoId;

    // Check if segments already exist (user had panel open)
    const ytPanel = document.querySelector(PANEL_SELECTOR);
    if (ytPanel) {
        const segments = ytPanel.querySelectorAll(SEGMENT_SELECTOR);
        if (segments.length > 0) {
            handleDOMTranscript(segments);
            return;
        }
    }

    transcriptObserver = new MutationObserver(() => {
        const ytPanel = document.querySelector(PANEL_SELECTOR);
        if (!ytPanel) return;
        const segments = ytPanel.querySelectorAll(SEGMENT_SELECTOR);
        if (segments.length === 0) return;

        transcriptObserver?.disconnect();
        transcriptObserver = null;
        handleDOMTranscript(segments);
    });

    transcriptObserver.observe(document.body, { childList: true, subtree: true });
}

function disconnectObserver(): void {
    transcriptObserver?.disconnect();
    transcriptObserver = null;
    observingForVideoId = null;
}

function parseDOMTranscript(segments: NodeListOf<Element>): TranscriptSegment[] {
    const result: TranscriptSegment[] = [];
    for (const segment of segments) {
        // YouTube renders timestamp in first yt-formatted-string, text in second
        const formattedStrings = segment.querySelectorAll('yt-formatted-string');
        const timeEl = segment.querySelector('[class*="timestamp"]') ?? formattedStrings[0];
        const textEl =
            formattedStrings.length > 1 ? formattedStrings[formattedStrings.length - 1] : formattedStrings[0];

        const time = timeEl?.textContent?.trim() ?? '';
        const text = textEl?.textContent?.trim() ?? '';
        if (!text || text === time) continue; // skip if only timestamp found

        const seconds = timeToSeconds(time);
        result.push({ time, seconds, text });
    }
    return result;
}

function handleDOMTranscript(segments: NodeListOf<Element>): void {
    // Discard if the video changed since we started observing (stale DOM segments)
    if (observingForVideoId !== null && observingForVideoId !== state.currentVideoId) return;
    if (!state.isOurFetch && !state.transcript.length) return; // ignore passive fires after timeout
    const parsed = parseDOMTranscript(segments);
    store.set('transcript', parsed);
    store.set('fullTranscriptText', parsed.map((t) => `[${t.time}] ${t.text}`).join('\n'));
    clearFetchTimeout();

    if (state.isOurFetch) {
        disconnectObserver();
        closeYouTubePanel();
        createPanel();
        store.set('isOurFetch', false);
    }
}

/** Poll for segments after clicking the transcript button (active backup for the passive observer) */
function pollForSegments(attempts = 0, forVideoId = state.currentVideoId): void {
    if (!state.isOurFetch) return; // already completed or timed out
    if (forVideoId !== state.currentVideoId) return; // video changed, abort this poll chain

    const ytPanel = document.querySelector(PANEL_SELECTOR);
    if (ytPanel) {
        const segments = ytPanel.querySelectorAll(SEGMENT_SELECTOR);
        if (segments.length > 0) {
            handleDOMTranscript(segments);
            return;
        }
    }

    if (attempts < 20) {
        // 20 × 400ms = 8s
        setTimeout(() => pollForSegments(attempts + 1, forVideoId), 400);
    }
}

// --- transcript fetching ---

const FETCH_MAX_RETRIES = 5;
const FETCH_INITIAL_DELAY = 300;

function fetchTranscript(retryCount = 0): void {
    if (retryCount === 0) {
        store.set('isOurFetch', true);
        clearFetchTimeout();

        fetchTimeout = setTimeout(() => {
            if (state.isOurFetch) {
                store.set('isOurFetch', false);
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
        const transcriptBtn = document.querySelector<HTMLElement>(
            'button[aria-label*="transcript" i], button[aria-label*="Transcript" i]',
        );

        if (transcriptBtn) {
            transcriptBtn.click();
            observeTranscriptPanel();
            pollForSegments();
            return;
        }

        if (retryCount >= FETCH_MAX_RETRIES) {
            clearFetchTimeout();
            store.set('isOurFetch', false);
            showToast('Could not find transcript button. Try opening transcript manually.', 'error');
            return;
        }

        // YouTube's DOM may not be ready after SPA navigation, retry with backoff
        const delay = retryCount < 2 ? 500 : 1000;
        setTimeout(() => fetchTranscript(retryCount + 1), delay);
    }, FETCH_INITIAL_DELAY);
}

function clearFetchTimeout(): void {
    if (fetchTimeout) {
        clearTimeout(fetchTimeout);
        fetchTimeout = null;
    }
}

function closeYouTubePanel(): void {
    const segmentPanel = document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    );
    if (segmentPanel) {
        const closeBtn = segmentPanel.querySelector<HTMLElement>(
            '#visibility-button button, tp-yt-icon-button#visibility-button',
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
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleNavigation();
        }
    });
}

function resetForNewVideo(videoId: string): void {
    clearFetchTimeout();
    disconnectObserver();
    store.set('isOurFetch', false);
    resetState(videoId);
    clearRetryState();
    destroyPanel();
    observeTranscriptPanel();

    if (state.settings.auto_open_transcript) {
        fetchTranscript();
    }
}

function closeAndCleanup(): void {
    destroyPanel();
    store.set('currentVideoId', null);
    store.set('buttonVideoId', null);
}

init();
