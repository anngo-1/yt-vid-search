import { describe, it, expect } from 'vitest';
import { escapeHtml, stripHtml } from '../../src/content/selectors';
import { renderMarkdown } from '../../src/utils/markdown';

describe('escapeHtml', () => {
    it('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes less than', () => {
        expect(escapeHtml('a < b')).toBe('a &lt; b');
    });

    it('escapes greater than', () => {
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
    });

    it('escapes single quotes', () => {
        expect(escapeHtml("a 'b' c")).toBe('a &#39;b&#39; c');
    });

    it('escapes all 5 entities together', () => {
        expect(escapeHtml('<div class="a" data-x=\'b\'>&')).toBe(
            '&lt;div class=&quot;a&quot; data-x=&#39;b&#39;&gt;&amp;',
        );
    });

    it('returns empty string for empty input', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('preserves normal text', () => {
        expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    });
});

describe('stripHtml', () => {
    it('strips simple tags', () => {
        expect(stripHtml('<p>Hello</p>')).toBe('Hello');
    });

    it('strips nested tags', () => {
        expect(stripHtml('<div><span>nested</span></div>')).toBe('nested');
    });

    it('strips script tags safely', () => {
        // In jsdom, script content may be stripped entirely. The key is no script executes.
        const result = stripHtml('<script>alert("xss")</script>');
        expect(result).not.toContain('<script>');
    });

    it('handles malformed HTML', () => {
        expect(stripHtml('<p>unclosed')).toBe('unclosed');
        expect(stripHtml('no tags')).toBe('no tags');
    });

    it('returns empty string for empty input', () => {
        expect(stripHtml('')).toBe('');
    });

    it('strips attributes', () => {
        expect(stripHtml('<a href="evil">click</a>')).toBe('click');
    });
});

describe('renderMarkdown XSS prevention', () => {
    it('escapes script tags', () => {
        const result = renderMarkdown('<script>alert("xss")</script>');
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;script&gt;');
    });

    it('escapes img onerror', () => {
        const result = renderMarkdown('<img onerror="alert(1)" src="x">');
        // The img tag should be escaped to text, not rendered as HTML
        expect(result).not.toContain('<img');
    });

    it('allows safe markdown links', () => {
        const result = renderMarkdown('[link](https://example.com)');
        expect(result).toContain('href="https://example.com"');
    });

    it('blocks javascript: URLs', () => {
        const result = renderMarkdown('[link](javascript:alert(1))');
        expect(result).not.toContain('javascript:');
    });

    it('renders timestamps safely', () => {
        const result = renderMarkdown('[2:30]');
        expect(result).toContain('yt-timestamp');
        expect(result).toContain('data-timestamp="150"');
    });
});
