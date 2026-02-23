import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/utils/markdown';

describe('renderMarkdown', () => {
    it('renders basic formatting', () => {
        expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
        expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
        expect(renderMarkdown('`code`')).toContain('<code');
    });

    it('escapes HTML', () => {
        expect(renderMarkdown('<script>')).toContain('&lt;script&gt;');
    });

    it('renders timestamps', () => {
        const result = renderMarkdown('[2:30]');
        expect(result).toContain('yt-timestamp');
        expect(result).toContain('data-timestamp="150"');
    });
});
