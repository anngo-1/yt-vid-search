import type { AppState, Settings } from '@/types';
import { STORAGE_KEYS, normalizeSettings } from '@/services/settings';
import { resolveProvider } from '@/utils/llm';

import { store } from '@/services/store';
import { isFiniteNumber, isBoolean, isCaptionPosition, isSize } from '@/services/validators';
import { safePersist } from '@/utils/storage';

/** application state singleton */
export const state: AppState = store.state;

/** reset state for a new video */
export function resetState(videoId: string): void {
    store.reset(videoId);
}

/** load settings from chrome storage */
export function loadSettings(): Promise<Settings> {
    return new Promise((resolve) => {
        try {
            const keys: string[] = [
                ...STORAGE_KEYS,
                'captionFontSize',
                'captionBackgroundEnabled',
                'targetLanguage',
                'captionPosition',
                'captionSize',
            ];
            chrome.storage.local.get(keys, (data: Record<string, unknown>) => {
                store.set('settings', normalizeSettings(data));

                if (isFiniteNumber(data.captionFontSize)) {
                    store.set('captionFontSize', clamp(data.captionFontSize, 20, 80));
                }
                if (isBoolean(data.captionBackgroundEnabled)) {
                    store.set('captionBackgroundEnabled', data.captionBackgroundEnabled);
                }
                if (typeof data.targetLanguage === 'string') {
                    store.set('targetLanguage', data.targetLanguage);
                }
                if (isCaptionPosition(data.captionPosition)) {
                    store.set('captionPosition', data.captionPosition);
                }
                if (isSize(data.captionSize)) {
                    store.set('captionSize', data.captionSize);
                }

                resolve(state.settings);
            });
        } catch {
            // Extension context invalidated (e.g., after extension update). We resolve with
            // empty settings so the UI falls back to defaults. Surfacing a toast here would
            // create a circular dependency (showToast → notifications → constants), and the
            // user experience is acceptable: they see default values until they refresh.
            console.warn('[ask-transcript] Extension context invalidated, please refresh');
            resolve({});
        }
    });
}

/** persist a setting to chrome storage */
export function persistSetting(data: Record<string, unknown>): void {
    safePersist(data);
}

/** check if current provider is properly configured */
export function isProviderConfigured(settings?: Settings, feature?: 'chat' | 'topics' | 'captions'): boolean {
    const s = settings || state.settings;
    const provider = resolveProvider(s, feature);

    if (provider === 'local') return true;
    if (provider === 'openrouter') return !!s.openrouter_api_key;
    if (provider === 'custom') return !!s.custom_endpoint;
    return false;
}

// --- helpers ---

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
