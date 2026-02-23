/**
 * Shared Chrome API mock for tests
 */
import { vi } from 'vitest';

export function createChromeMock() {
    return {
        storage: {
            local: { set: vi.fn(), get: vi.fn() },
            session: { setAccessLevel: vi.fn() },
            onChanged: { addListener: vi.fn() },
        },
        runtime: {
            getURL: vi.fn(),
            onMessage: { addListener: vi.fn() },
            sendMessage: vi.fn(),
            connect: vi.fn(() => ({
                postMessage: vi.fn(),
                disconnect: vi.fn(),
                onMessage: { addListener: vi.fn() },
                onDisconnect: { addListener: vi.fn() },
            })),
        },
    };
}

export function stubChrome() {
    const mock = createChromeMock();
    vi.stubGlobal('chrome', mock);
    return mock;
}
