import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome } from '../helpers/chrome-mock';

// Mock chrome before importing module
const mock = stubChrome();
const mockSet = mock.storage.local.set;

import { safePersist } from '../../src/utils/storage';

describe('safePersist', () => {
    beforeEach(() => {
        mockSet.mockReset();
    });

    it('calls chrome.storage.local.set with the provided data', () => {
        safePersist({ foo: 'bar' });
        expect(mockSet).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('does not throw when chrome.storage.local.set throws', () => {
        mockSet.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });
        expect(() => safePersist({ key: 'value' })).not.toThrow();
    });

    it('logs a warning when storage call fails', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockSet.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });

        safePersist({ key: 'value' });

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to persist'));
        warnSpy.mockRestore();
    });
});
