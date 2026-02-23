import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome } from '../helpers/chrome-mock';
import { ApiError } from '../../src/services/errors';
import type { AppState } from '../../src/types';

stubChrome();

// Mock state module
vi.mock('../../src/services/state', async () => {
    const types = await vi.importActual<typeof import('../../src/types')>('../../src/types');
    return {
        state: types.createInitialState(),
        isProviderConfigured: vi.fn(() => true),
        getProviderConfigMessage: vi.fn(() => ''),
    };
});

// Mock selectors
vi.mock('../../src/content/selectors', () => ({
    $: vi.fn(() => null),
    createElement: vi.fn(() => document.createElement('div')),
    getVideoTitle: vi.fn(() => 'Test Video'),
    seekTo: vi.fn(),
    stripHtml: vi.fn((s: string) => s),
    escapeHtml: vi.fn((s: string) => s),
}));

import { buildMessages, buildFullSystemPrompt, buildFollowUpSystemPrompt } from '../../src/features/chat';

describe('buildMessages', () => {
    let state: AppState;

    beforeEach(async () => {
        const stateModule = await import('../../src/services/state');
        state = stateModule.state as AppState;
        state.chatHistory = [];
        state.fullTranscriptText = '';
        state.settings = {};
    });

    it('includes system message from provided prompt', () => {
        state.fullTranscriptText = '';
        const prompt = 'Test system prompt';
        const messages = buildMessages(prompt, []);
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe('Test system prompt');
    });

    it('includes full transcript in full system prompt', () => {
        state.fullTranscriptText = '[0:00] Hello world';
        const prompt = buildFullSystemPrompt();
        expect(prompt).toContain('[0:00] Hello world');
    });

    it('includes transcript in follow-up prompt by default', () => {
        state.fullTranscriptText = '[0:00] Test transcript text here';
        const prompt = buildFollowUpSystemPrompt();
        expect(prompt).toContain('[0:00] Test transcript text here');
    });

    it('omits transcript in follow-up prompt when fast_followups enabled', () => {
        state.fullTranscriptText = '[0:00] Test transcript text here';
        state.settings = { fast_followups: true };
        const prompt = buildFollowUpSystemPrompt();
        expect(prompt).not.toContain('[0:00] Test transcript text here');
    });

    it('appends chat history to messages', () => {
        state.fullTranscriptText = '[0:00] Hi';
        const history = [
            { role: 'user' as const, content: 'Question' },
            { role: 'assistant' as const, content: 'Answer' },
        ];
        const messages = buildMessages('system prompt', history);
        expect(messages).toHaveLength(3);
        expect(messages[1]).toEqual({ role: 'user', content: 'Question' });
        expect(messages[2]).toEqual({ role: 'assistant', content: 'Answer' });
    });

    it('system prompt includes video title', () => {
        state.fullTranscriptText = '[0:00] Content';
        const prompt = buildFullSystemPrompt();
        expect(prompt).toContain('Test Video');
    });

    it('includes markdown rules in system prompt', () => {
        state.fullTranscriptText = '[0:00] Content';
        const prompt = buildFullSystemPrompt();
        expect(prompt).toContain('markdown');
    });
});

describe('ApiError in chat', () => {
    it('ApiError has status information', () => {
        const err = new ApiError('Rate limited', { status: 429 });
        expect(err.status).toBe(429);
        expect(err.message).toBe('Rate limited');
    });

    it('ApiError is catchable as Error', () => {
        const fn = () => {
            throw new ApiError('fail', { status: 500 });
        };
        expect(fn).toThrow(Error);
        expect(fn).toThrow(ApiError);
    });

    it('ApiError instanceof checks work correctly', () => {
        const err = new ApiError('test');
        expect(err instanceof ApiError).toBe(true);
        expect(err instanceof Error).toBe(true);
    });
});
