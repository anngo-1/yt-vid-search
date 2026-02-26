/**
 * popup - settings popup
 */
import '../../popup.css';
import type { Settings } from '@/types';
import { STORAGE_KEYS } from '@/services/settings';

interface SettingConfig {
    id: string;
    key: keyof Settings;
    type: 'text' | 'select' | 'checkbox' | 'number';
    default?: string | number | boolean;
}

const SETTING_FIELDS: SettingConfig[] = [
    // Features
    { id: 'chatProvider', key: 'chat_provider', type: 'select', default: 'local' },
    { id: 'chatModel', key: 'chat_model', type: 'text', default: '' },
    { id: 'topicsProvider', key: 'topics_provider', type: 'select', default: 'local' },
    { id: 'topicsModel', key: 'topics_model', type: 'text', default: '' },
    { id: 'captionsProvider', key: 'captions_provider', type: 'select', default: 'local' },
    { id: 'captionsModel', key: 'captions_model', type: 'text', default: '' },

    // Providers
    { id: 'apiKey', key: 'openrouter_api_key', type: 'text', default: '' },
    { id: 'model', key: 'openrouter_model', type: 'text', default: '' },
    { id: 'localPort', key: 'local_port', type: 'number', default: 1234 },
    { id: 'localModel', key: 'local_model', type: 'text', default: '' },
    { id: 'customEndpoint', key: 'custom_endpoint', type: 'text', default: '' },
    { id: 'customApiKey', key: 'custom_api_key', type: 'text', default: '' },
    { id: 'customModel', key: 'custom_model', type: 'text', default: '' },

    // Flags
    { id: 'fastFollowups', key: 'fast_followups', type: 'checkbox', default: false },
    { id: 'chatDirectMode', key: 'chat_direct_mode', type: 'checkbox', default: false },
    { id: 'autoGenerateTopics', key: 'auto_generate_topics', type: 'checkbox', default: undefined }, // undefined handled specially

    // Advanced Translation
    { id: 'translationLookahead', key: 'translation_lookahead_buffer', type: 'number', default: 60 },
    { id: 'translationRefill', key: 'translation_refill_threshold', type: 'number', default: 30 },
    { id: 'translationConcurrent', key: 'translation_max_concurrent', type: 'number', default: 3 },
];

function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            // Deactivate all
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

            // Activate click
            btn.classList.add('active');
            const tabId = (btn as HTMLElement).dataset.tab;
            const content = $(`tab-${tabId}`);
            if (content) content.classList.add('active');
        });
    });

    $('openPanelBtn')?.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab?.id) {
                chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' });
                window.close();
            }
        });
    });

    $('saveBtn')?.addEventListener('click', () => {
        save();
        showStatus('settings saved!');
    });

    $('clearKeyBtn')?.addEventListener('click', clearKeys);

    $<HTMLInputElement>('temperature')?.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        const tempValue = $('tempValue');
        if (tempValue) tempValue.textContent = value;
        save();
    });

    // Auto-save fields
    const autoSaveFields = [
        'chatModel',
        'topicsModel',
        'captionsModel',
        'apiKey',
        'model',
        'localPort',
        'localModel',
        'customEndpoint',
        'customApiKey',
        'customModel',
        'translationLookahead',
        'translationRefill',
        'translationConcurrent',
    ];
    ['input', 'paste', 'change'].forEach((event) => {
        autoSaveFields.forEach((fieldId) => {
            $(fieldId)?.addEventListener(event, save);
        });
    });

    // Selects
    ['chatProvider', 'topicsProvider', 'captionsProvider'].forEach((id) => {
        $(id)?.addEventListener('change', save);
    });

    // Checkbox auto-save
    $('fastFollowups')?.addEventListener('change', save);
    $('autoGenerateTopics')?.addEventListener('change', save);
});

// save when popup loses focus or closes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
});
window.addEventListener('blur', save);

function loadSettings(): void {
    chrome.storage.local.get(STORAGE_KEYS, (data: Record<string, unknown>) => {
        // Handle fields systematically
        SETTING_FIELDS.forEach((field) => {
            const el = $(field.id);
            if (!el) return;

            const val = data[field.key];

            if (field.type === 'checkbox') {
                const checked = val === undefined ? field.default === true : !!val;
                (el as HTMLInputElement).checked = checked;
            } else {
                const value = val !== undefined ? String(val) : String(field.default || '');
                // Special case for select fallback
                if (field.type === 'select' && !val) {
                    (el as HTMLSelectElement).value = typeof data.provider === 'string' ? data.provider : 'local';
                } else {
                    (el as HTMLInputElement | HTMLSelectElement).value = value;
                }
            }
        });

        // Temperature (handled separately due to specific UI logic)
        const temperature = $<HTMLInputElement>('temperature');
        const tempValue = $('tempValue');
        if (data.temperature !== undefined) {
            if (temperature) temperature.value = String(data.temperature);
            if (tempValue) tempValue.textContent = String(data.temperature);
        }
    });
}

function save(): void {
    const temperature = parseFloat($<HTMLInputElement>('temperature')?.value || '0.7');

    const settings: Record<string, unknown> = {
        provider: 'local', // Legacy fallback
        temperature,
    };

    SETTING_FIELDS.forEach((field) => {
        const el = $(field.id);
        if (!el) return;

        if (field.type === 'checkbox') {
            settings[field.key] = (el as HTMLInputElement).checked;
        } else if (field.type === 'number') {
            settings[field.key] = parseInt((el as HTMLInputElement).value || String(field.default || 0), 10);
        } else {
            settings[field.key] = (el as HTMLInputElement | HTMLSelectElement).value.trim();
        }
    });

    chrome.storage.local.set(settings);
}

function clearKeys(): void {
    const apiKey = $<HTMLInputElement>('apiKey');
    const customApiKey = $<HTMLInputElement>('customApiKey');
    if (apiKey) apiKey.value = '';
    if (customApiKey) customApiKey.value = '';
    chrome.storage.local.remove(['openrouter_api_key', 'custom_api_key'], () => {
        showStatus('API keys cleared');
    });
}

function showStatus(message: string, isError = false): void {
    const el = $('status');
    if (el) {
        el.textContent = message;
        el.className = isError ? 'status error' : 'status success';
        setTimeout(() => {
            el.textContent = '';
            el.className = 'status';
        }, 3000);
    }
}
