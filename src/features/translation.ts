/**
 * translation - real-time transcript translation with chunked prefetch
 */

import { state, isProviderConfigured } from '@/services/state';
import { store } from '@/services/store';
import { getVideoElement } from '@/content/selectors';
import { translateSegments } from '@/services/translation-api';
import { findActiveSegmentIndex } from '@/utils/transcript';
import { showToast } from '@/services/notifications';

export const TRANSLATION_CONFIG = {
    chunkSize: 5,
    maxPending: 100,
    immediateBuffer: 10,
    lookaheadBuffer: 60,
    refillThreshold: 30,
    maxRetries: 3,
};

function getConfig() {
    return {
        lookaheadBuffer: state.settings.translation_lookahead_buffer ?? TRANSLATION_CONFIG.lookaheadBuffer,
        refillThreshold: state.settings.translation_refill_threshold ?? TRANSLATION_CONFIG.refillThreshold,
        maxConcurrent: state.settings.translation_max_concurrent ?? 3,
    };
}

/**
 * Mutable state for translation tracking.
 * - Created at module load; survives video changes (module is never re-imported).
 * - `version` is bumped by invalidateTranslationRequests() to discard in-flight results.
 * - `retryCount` is cleared by clearRetryState() on video/language change.
 * - `activeRequests` tracks concurrent API calls for the concurrency limiter.
 * - `syncPending` prevents cascading microtask loops in handleTranslationSync().
 */
const translationState = {
    version: 0,
    retryCount: new Map<number, number>(),
    activeRequests: 0,
    rowUpdater: null as ((index: number) => void) | null,
};

/** Register a callback to update a translated row in the UI */
export function setTranslationRowUpdater(fn: ((index: number) => void) | null): void {
    translationState.rowUpdater = fn;
}

/** invalidate in-flight translation requests */
export function invalidateTranslationRequests(): void {
    translationState.version += 1;
}

/** Clear retry counts - call when language changes or video changes */
export function clearRetryState(): void {
    translationState.retryCount.clear();
}

/** Kick-start translation with aggressive prefetch - call when translation is first enabled */
export function startTranslationPrefetch(): void {
    const { transcript, pendingTranslations, settings } = state;
    if (!transcript.length || !isProviderConfigured(settings)) return;

    // Clear any stale retry counts
    translationState.retryCount.clear();

    const currentTime = getVideoElement()?.currentTime || 0;

    // Find current segment using binary search
    const activeIndex = findActiveSegmentIndex(transcript, currentTime, state.lastActiveSegmentIndex);

    // Progressive loading strategy:
    // 1. First chunk: Tiny (1 item) -> INSTANT response for immediate context
    // 2. Second chunk: Small (2 items) -> very quick follow up
    // 3. Subsequent chunks: Normal sized

    // Chunk 1: Immediate context (1 item)
    if (activeIndex < transcript.length && !pendingTranslations.has(activeIndex)) {
        triggerTranslationChunk(activeIndex, true, 1);
    }

    // Chunk 2: Near future (2 items)
    const secondChunkIdx = activeIndex + 1;
    if (secondChunkIdx < transcript.length && !pendingTranslations.has(secondChunkIdx)) {
        triggerTranslationChunk(secondChunkIdx, true, 2);
    }

    // Chunk 3+: Fill buffer with standard size
    let nextStart = activeIndex + 3;
    const INITIAL_FILL_CHUNKS = 3;

    for (let c = 0; c < INITIAL_FILL_CHUNKS; c++) {
        if (nextStart < transcript.length && !pendingTranslations.has(nextStart)) {
            triggerTranslationChunk(nextStart, false);
            nextStart += TRANSLATION_CONFIG.chunkSize;
        }
    }
}

/**
 * Handle translation prefetch and gap-filling during playback sync.
 *
 * Uses a 3-priority strategy to keep translations ahead of playback:
 *   1. Current segment — immediate single-segment request for instant display
 *   2. Immediate gaps — fill any missing segments in the next `immediateBuffer` range
 *   3. Lookahead buffer — maintain a rolling window of `lookaheadBuffer` ready segments
 *
 * A debounced syncToTime call at the end ensures the UI reflects new translations
 * without cascading microtask loops.
 */
export function handleTranslationSync(activeIndex: number): void {
    const { translationEnabled } = state;
    if (!translationEnabled || activeIndex === -1) return;

    // Priority 1: Current segment — single-item request for instant subtitle display
    if (isUntranslated(activeIndex)) {
        triggerTranslationChunk(activeIndex, true, 1);
    }

    // Priority 2: Fill gaps in the immediate future
    triggerContiguousGaps(
        findUntranslatedGaps(activeIndex + 1, activeIndex + TRANSLATION_CONFIG.immediateBuffer),
        true,
    );

    // Priority 3: Maintain a large lookahead buffer to stay ahead of playback
    refillLookaheadBuffer(activeIndex);
}

/** Find untranslated, non-pending indices in a range */
function findUntranslatedGaps(start: number, end: number): number[] {
    const { transcript } = state;
    const gaps: number[] = [];
    for (let i = start; i < Math.min(end, transcript.length); i++) {
        if (isUntranslated(i)) gaps.push(i);
    }
    return gaps;
}

/** Check if a segment index needs translation */
function isUntranslated(index: number): boolean {
    return !state.translatedSegments[index] && !state.pendingTranslations.has(index);
}

/** Trigger translation for contiguous runs of gap indices */
function triggerContiguousGaps(gaps: number[], highPriority: boolean): void {
    if (gaps.length === 0) return;
    const { pendingTranslations } = state;

    let chunkStart = gaps[0];
    for (let i = 1; i <= gaps.length; i++) {
        if (i < gaps.length && gaps[i] === gaps[i - 1] + 1) continue;

        // End of a contiguous run
        if (!pendingTranslations.has(chunkStart)) {
            triggerTranslationChunk(chunkStart, highPriority);
        }
        if (i < gaps.length) chunkStart = gaps[i];
    }
}

/** Refill the lookahead buffer if it's running low */
function refillLookaheadBuffer(activeIndex: number): void {
    const { transcript, translatedSegments, pendingTranslations } = state;
    const config = getConfig();

    let readyCount = 0;
    let firstMissingIdx = -1;
    for (let i = activeIndex + 1; i < Math.min(activeIndex + config.lookaheadBuffer, transcript.length); i++) {
        if (translatedSegments[i] || pendingTranslations.has(i)) {
            readyCount++;
        } else if (firstMissingIdx === -1) {
            firstMissingIdx = i;
        }
    }

    if (readyCount >= config.refillThreshold || firstMissingIdx === -1) return;

    const chunksToFire = Math.min(4, Math.ceil((config.refillThreshold - readyCount) / TRANSLATION_CONFIG.chunkSize));
    let nextStart = firstMissingIdx;

    for (let c = 0; c < chunksToFire; c++) {
        if (nextStart < transcript.length && !pendingTranslations.has(nextStart)) {
            triggerTranslationChunk(nextStart, false);
            nextStart += TRANSLATION_CONFIG.chunkSize;
        }
    }
}

/** trigger translation for a chunk of segments starting from index */
export async function triggerTranslationChunk(
    startIndex: number,
    highPriority: boolean = false,
    maxChunkSize: number = TRANSLATION_CONFIG.chunkSize,
): Promise<void> {
    const { transcript, targetLanguage, settings, translatedSegments, pendingTranslations } = state;

    const versionAtStart = translationState.version;
    const languageAtStart = targetLanguage;

    // Early exit if provider not configured
    if (!isProviderConfigured(settings)) return;

    // Concurrency limiter: skip if too many active requests (unless high priority)
    const config = getConfig();
    if (!highPriority && translationState.activeRequests >= config.maxConcurrent) {
        return;
    }

    // Check if we're already at max pending (unless high priority)
    if (!highPriority && pendingTranslations.size >= TRANSLATION_CONFIG.maxPending) {
        return;
    }

    const CONTEXT_SIZE = 3;

    // find segments in this chunk that aren't translated or pending
    const chunkIndices: number[] = [];
    for (let i = startIndex; i < Math.min(startIndex + maxChunkSize, transcript.length); i++) {
        if (!translatedSegments[i] && !pendingTranslations.has(i)) {
            chunkIndices.push(i);
        }
    }

    if (chunkIndices.length === 0) return;
    store.mutate('pendingTranslations', (s) => chunkIndices.forEach((i) => s.add(i)));

    translationState.activeRequests++;
    try {
        // get context segments
        const contextSegments = transcript.slice(Math.max(0, startIndex - CONTEXT_SIZE), startIndex).map((s) => s.text);

        const segmentsToTranslate = chunkIndices
            .map((i) => ({ text: transcript[i].text, index: i }))
            .filter((s) => s.text.trim() !== '');

        if (segmentsToTranslate.length === 0) {
            store.mutate('pendingTranslations', (s) => chunkIndices.forEach((i) => s.delete(i)));
            return;
        }

        const results = await translateSegments(segmentsToTranslate, contextSegments, targetLanguage, settings);

        if (
            versionAtStart !== translationState.version ||
            !state.translationEnabled ||
            state.targetLanguage !== languageAtStart
        ) {
            store.mutate('pendingTranslations', (s) => chunkIndices.forEach((i) => s.delete(i)));
            return;
        }

        // store results and track which ones we got
        const receivedIndices = new Set<number>();
        const translatedUpdates: Array<[number, string]> = [];
        Object.entries(results).forEach(([idxStr, text]) => {
            const idx = parseInt(idxStr, 10);
            if (text && typeof text === 'string' && text.trim()) {
                translatedUpdates.push([idx, text]);
                translationState.retryCount.delete(idx);
            }
            receivedIndices.add(idx);
        });
        store.mutate('translatedSegments', (segs) =>
            translatedUpdates.forEach(([idx, text]) => {
                segs[idx] = text;
            }),
        );
        store.mutate('pendingTranslations', (s) => receivedIndices.forEach((i) => s.delete(i)));
        translatedUpdates.forEach(([idx]) => translationState.rowUpdater?.(idx));

        // Check for missing indices (API didn't return them)
        const missingIndices = chunkIndices.filter((i) => !receivedIndices.has(i) && !translatedSegments[i]);
        if (missingIndices.length > 0) {
            console.warn('[ask-transcript] API missed indices:', missingIndices);
            store.mutate('pendingTranslations', (s) => missingIndices.forEach((i) => s.delete(i)));
            scheduleRetry(missingIndices, 500);
        }
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        console.error('[ask-transcript] translation chunk failed:', error);

        // Remove from pending set so they can be retried
        store.mutate('pendingTranslations', (s) => chunkIndices.forEach((i) => s.delete(i)));

        // Schedule retry with error context
        scheduleRetry(chunkIndices, 1000, error.message);
    } finally {
        translationState.activeRequests--;
    }
}

/** Schedule retry for failed indices with exponential backoff */
function scheduleRetry(indices: number[], baseDelay: number, lastError?: string): void {
    const { translatedSegments } = state;

    const toRetry: number[] = [];
    let failedCount = 0;

    indices.forEach((idx) => {
        const attempts = translationState.retryCount.get(idx) || 0;
        if (attempts < TRANSLATION_CONFIG.maxRetries && !translatedSegments[idx]) {
            translationState.retryCount.set(idx, attempts + 1);
            toRetry.push(idx);
        } else if (attempts >= TRANSLATION_CONFIG.maxRetries) {
            console.warn(`[ask-transcript] giving up on index ${idx} after ${TRANSLATION_CONFIG.maxRetries} retries`);
            failedCount++;
        }
    });

    if (failedCount > 0) {
        const msg = `Translation failed for ${failedCount} segment${failedCount > 1 ? 's' : ''}`;
        showToast(lastError ? `${msg}: ${lastError}` : msg, 'error');
    }

    if (toRetry.length === 0) return;

    const maxAttempts = Math.max(...toRetry.map((i) => translationState.retryCount.get(i) || 1));
    const delay = baseDelay * Math.pow(2, maxAttempts - 1);

    setTimeout(() => {
        const stillNeeded = toRetry.filter((i) => !translatedSegments[i] && !state.pendingTranslations.has(i));
        if (stillNeeded.length > 0) {
            const chunks: number[][] = [];

            // Re-batch into contiguous chunks
            let currentChunk: number[] = [];
            for (const idx of stillNeeded.sort((a, b) => a - b)) {
                if (currentChunk.length === 0 || idx === currentChunk[currentChunk.length - 1] + 1) {
                    currentChunk.push(idx);
                } else {
                    if (currentChunk.length > 0) chunks.push(currentChunk);
                    currentChunk = [idx];
                }
            }
            if (currentChunk.length > 0) chunks.push(currentChunk);

            for (const chunk of chunks) {
                if (chunk.length > 0 && !state.pendingTranslations.has(chunk[0])) {
                    triggerTranslationChunk(chunk[0], true);
                }
            }
        }
    }, delay);
}
