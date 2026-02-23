import { describe, it, expect, vi, beforeEach } from 'vitest';
import { completion } from '../../src/services/api';

describe('completion', () => {
    beforeEach(() => {
        // Mock chrome.runtime.sendMessage with 3-arg callback pattern
        vi.stubGlobal('chrome', {
            runtime: {
                sendMessage: vi.fn(),
            },
        });
    });

    it('throws without API key for OpenRouter', async () => {
        await expect(completion([], { provider: 'openrouter' })).rejects.toThrow('OpenRouter API key not found');
    });

    it('calls API via background script for OpenRouter', async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
            (_msg: unknown, _opts: unknown, callback: (res: unknown) => void) => {
                callback({
                    ok: true,
                    body: JSON.stringify({ choices: [{ message: { content: 'response' } }] }),
                });
            },
        );

        const result = await completion([{ role: 'user', content: 'hi' }], {
            provider: 'openrouter',
            openrouter_api_key: 'key',
            openrouter_model: 'model',
        });

        expect(result).toBe('response');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'API_REQUEST',
                url: expect.stringContaining('openrouter.ai'),
            }),
            undefined,
            expect.any(Function),
        );
    });

    it('calls local LLM without API key', async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
            (_msg: unknown, _opts: unknown, callback: (res: unknown) => void) => {
                callback({
                    ok: true,
                    body: JSON.stringify({ choices: [{ message: { content: 'local response' } }] }),
                });
            },
        );

        const result = await completion([{ role: 'user', content: 'hi' }], { provider: 'local', local_port: 1234 });

        expect(result).toBe('local response');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'API_REQUEST',
                url: expect.stringContaining('localhost:1234'),
            }),
            undefined,
            expect.any(Function),
        );
    });
});
