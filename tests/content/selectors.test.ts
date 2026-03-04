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

    it('getVideoId extracts video id from /watch URLs only', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?v=abc123', pathname: '/watch' },
            writable: true,
        });
        expect(getVideoId()).toBe('abc123');

        Object.defineProperty(window, 'location', {
            value: { search: '?v=abc123', pathname: '/shorts/xyz' },
            writable: true,
        });
        expect(getVideoId()).toBeNull();

        Object.defineProperty(window, 'location', {
            value: { search: '', pathname: '/watch' },
            writable: true,
        });
        expect(getVideoId()).toBeNull();
    });
});
