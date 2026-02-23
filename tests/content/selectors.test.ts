import { describe, it, expect, beforeEach } from 'vitest';
import { $, getVideoId } from '../../src/content/selectors';

describe('selectors', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('$ finds elements by id', () => {
        const div = document.createElement('div');
        div.id = 'test';
        document.body.appendChild(div);

        expect($('test')).toBe(div);
        expect($('nonexistent')).toBeNull();
    });

    it('getVideoId extracts video id from URL', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?v=abc123' },
            writable: true,
        });
        expect(getVideoId()).toBe('abc123');

        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
        });
        expect(getVideoId()).toBeNull();
    });
});
