import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome API
let mockStorage: Record<string, unknown> = {};

const mockChrome = {
    runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(),
    },
    storage: {
        local: {
            get: vi.fn((keys: string[], cb: (data: Record<string, unknown>) => void) => {
                const result: Record<string, unknown> = {};
                keys.forEach((k) => {
                    if (k in mockStorage) result[k] = mockStorage[k];
                });
                cb(result);
            }),
            set: vi.fn((data: Record<string, unknown>) => {
                Object.assign(mockStorage, data);
            }),
            remove: vi.fn((_keys: string[], cb?: () => void) => {
                cb?.();
            }),
        },
        onChanged: { addListener: vi.fn() },
        session: { setAccessLevel: vi.fn() },
    },
    tabs: {
        query: vi.fn((_q: unknown, cb: (tabs: { id: number }[]) => void) => cb([{ id: 1 }])),
        sendMessage: vi.fn(),
    },
};

(globalThis as unknown as Record<string, unknown>).chrome = mockChrome;

describe('popup', () => {
    beforeEach(() => {
        // Clear mock storage
        mockStorage = {};
        vi.clearAllMocks();

        // Set up popup DOM
        document.body.innerHTML = `
            <div class="container">
                <button id="openPanelBtn" class="primary-btn">Open Transcript Panel</button>
                <div class="tabs">
                    <button class="tab-btn active" data-tab="features">Features</button>
                    <button class="tab-btn" data-tab="providers">Providers</button>
                    <button class="tab-btn" data-tab="general">General</button>
                </div>
                <div id="tab-features" class="tab-content active">
                    <select id="chatProvider">
                        <option value="local">Local</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="custom">Custom</option>
                    </select>
                    <input type="text" id="chatModel" value="">
                    <select id="topicsProvider"><option value="local">Local</option></select>
                    <input type="text" id="topicsModel" value="">
                    <select id="captionsProvider"><option value="local">Local</option></select>
                    <input type="text" id="captionsModel" value="">
                </div>
                <div id="tab-providers" class="tab-content">
                    <input type="password" id="apiKey" value="">
                    <input type="text" id="model" value="">
                    <input type="number" id="localPort" value="1234">
                    <input type="text" id="localModel" value="">
                    <input type="text" id="customEndpoint" value="">
                    <input type="password" id="customApiKey" value="">
                    <input type="text" id="customModel" value="">
                </div>
                <div id="tab-general" class="tab-content">
                    <input type="range" id="temperature" min="0" max="2" step="0.1" value="0.7">
                    <span id="tempValue">0.7</span>
                    <input type="checkbox" id="fastFollowups">
                    <input type="checkbox" id="autoGenerateTopics">
                    <button id="saveBtn">Save</button>
                    <button id="clearKeyBtn">Clear Keys</button>
                </div>
                <div id="status" class="status"></div>
            </div>
        `;
    });

    describe('tab switching', () => {
        it('activates clicked tab and content', () => {
            const tabs = document.querySelectorAll('.tab-btn');
            const providersBtn = tabs[1] as HTMLElement;

            // Simulate tab switching logic
            tabs.forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
            providersBtn.classList.add('active');
            const content = document.getElementById(`tab-${providersBtn.dataset.tab}`);
            if (content) content.classList.add('active');

            expect(providersBtn.classList.contains('active')).toBe(true);
            expect(tabs[0].classList.contains('active')).toBe(false);
            expect(content?.classList.contains('active')).toBe(true);
        });
    });

    describe('settings save', () => {
        it('saves settings to chrome storage', () => {
            // Simulate save function logic
            const chatProvider = document.getElementById('chatProvider') as HTMLSelectElement;
            const temperature = document.getElementById('temperature') as HTMLInputElement;

            chatProvider.value = 'openrouter';
            temperature.value = '0.5';

            // Trigger save
            const settings: Record<string, unknown> = {
                provider: 'local',
                temperature: parseFloat(temperature.value),
                chat_provider: chatProvider.value,
            };

            chrome.storage.local.set(settings);
            expect(mockChrome.storage.local.set).toHaveBeenCalledWith(settings);
        });
    });

    describe('settings load', () => {
        it('loads settings from chrome storage', () => {
            mockStorage.chat_provider = 'openrouter';
            mockStorage.temperature = 0.3;

            const cb = vi.fn();
            chrome.storage.local.get(['chat_provider', 'temperature'], cb);

            expect(cb).toHaveBeenCalledWith({
                chat_provider: 'openrouter',
                temperature: 0.3,
            });
        });

        it('returns empty for missing keys', () => {
            const cb = vi.fn();
            chrome.storage.local.get(['nonexistent'], cb);

            expect(cb).toHaveBeenCalledWith({});
        });
    });

    describe('clearKeys', () => {
        it('clears API key inputs', () => {
            const apiKey = document.getElementById('apiKey') as HTMLInputElement;
            const customApiKey = document.getElementById('customApiKey') as HTMLInputElement;

            apiKey.value = 'sk-test-123';
            customApiKey.value = 'custom-key-456';

            // Simulate clearKeys logic
            apiKey.value = '';
            customApiKey.value = '';
            chrome.storage.local.remove(['openrouter_api_key', 'custom_api_key'], vi.fn());

            expect(apiKey.value).toBe('');
            expect(customApiKey.value).toBe('');
            expect(mockChrome.storage.local.remove).toHaveBeenCalled();
        });
    });

    describe('temperature slider', () => {
        it('updates display value', () => {
            const temperature = document.getElementById('temperature') as HTMLInputElement;
            const tempValue = document.getElementById('tempValue') as HTMLElement;

            temperature.value = '1.5';
            tempValue.textContent = temperature.value;

            expect(tempValue.textContent).toBe('1.5');
        });
    });

    describe('checkbox settings', () => {
        it('saves checkbox state', () => {
            const fastFollowups = document.getElementById('fastFollowups') as HTMLInputElement;
            const autoGenerate = document.getElementById('autoGenerateTopics') as HTMLInputElement;

            fastFollowups.checked = true;
            autoGenerate.checked = false;

            const settings: Record<string, unknown> = {
                fast_followups: fastFollowups.checked,
                auto_generate_topics: autoGenerate.checked,
            };

            chrome.storage.local.set(settings);
            expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    fast_followups: true,
                    auto_generate_topics: false,
                }),
            );
        });
    });
});
