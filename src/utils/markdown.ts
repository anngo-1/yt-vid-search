/**
 * markdown - rendering with marked and custom timestamp handling
 */

import { marked, type TokenizerAndRendererExtension } from 'marked';
import { timeToSeconds } from '@/utils/time';
import { escapeHtml } from '@/content/selectors';

// Extend Token interface to include our custom properties
interface TimestampToken {
    type: 'timestamp';
    raw: string;
    text: string; // The displayed text (e.g., "1:30" or "1:30-2:00")
    seconds: number; // The parsed seconds
}

// Configure Marked
marked.use({
    gfm: true,
    breaks: true,
    renderer: {
        html({ text }: { raw: string; text: string }) {
            return escapeHtml(text || '');
        },
        link({ href, text }: { href: string; text: string }) {
            const safeHref = href && /^(https?:|mailto:)/i.test(href) ? href : '#';
            return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text || ''}</a>`;
        },
    },
});

// 2. Custom Extension for Timestamps
// Matches: [1:30], [1:30-2:00], at 1:30, 0:00-1:00
const timestampExtension: TokenizerAndRendererExtension = {
    name: 'timestamp',
    level: 'inline',
    start(src: string) {
        // Hint to marked where to check for this token
        // Match numbers, brackets, or "at"/"from"
        return src.match(/[[\d]|at|from/i)?.index;
    },
    tokenizer(src: string) {
        // Regex for time format: M:SS or MM:SS or H:MM:SS
        const timePattern = '\\d{1,2}:\\d{2}(?::\\d{2})?';

        // Common separators (including non-breaking hyphen \u2011)
        const separator = '\\s*(?:to|-|–|—|\\u2011)\\s*';

        // 1. Bracketed: [1:30] or [1:30-2:00]
        const bracketRegex = new RegExp(`^\\[(${timePattern}(?:${separator}${timePattern})?)\\]`);

        // 2. "At" style: at 1:30
        const atRegex = new RegExp(
            `^(?:at|around|~|about|from)\\s+(${timePattern}(?:${separator}${timePattern})?)`,
            'i',
        );

        // 3. Plain Range style: 0:00-0:30 or 0:00 - 0:30
        // Must start with a number.
        const rangeRegex = new RegExp(`^(${timePattern}${separator}${timePattern})`);

        let match = bracketRegex.exec(src);
        if (match) {
            const display = match[1];
            const firstTime = (display.match(/\d{1,2}:\d{2}:\d{2}/) || display.match(/\d{1,2}:\d{2}/))?.[0] || '0:00';

            return {
                type: 'timestamp',
                raw: match[0],
                text: match[0],
                seconds: timeToSeconds(firstTime),
            } as TimestampToken;
        }

        match = atRegex.exec(src);
        if (match) {
            const display = match[0];
            const timePart = match[1];
            const firstTime = (timePart.match(/\d{1,2}:\d{2}:\d{2}/) || timePart.match(/\d{1,2}:\d{2}/))?.[0] || '0:00';

            return {
                type: 'timestamp',
                raw: match[0],
                text: display,
                seconds: timeToSeconds(firstTime),
            } as TimestampToken;
        }

        match = rangeRegex.exec(src);
        if (match) {
            const display = match[1];
            const firstTime = (display.match(/\d{1,2}:\d{2}:\d{2}/) || display.match(/\d{1,2}:\d{2}/))?.[0] || '0:00';

            return {
                type: 'timestamp',
                raw: match[0],
                text: display,
                seconds: timeToSeconds(firstTime),
            } as TimestampToken;
        }

        return undefined;
    },
    renderer(token: Record<string, unknown>) {
        // marked extension API types tokens as Record<string, unknown>; safe cast since tokenizer above produces TimestampToken
        const t = token as unknown as TimestampToken;
        return `<button type="button" class="yt-timestamp" data-timestamp="${t.seconds}">${t.text}</button>`;
    },
};

marked.use({ extensions: [timestampExtension] });

/** render markdown text to html with clickable timestamps */
export function renderMarkdown(text: string): string {
    if (!text) return '';

    // Pre-processing

    // 1. Remove clock emojis
    text = text.replace(/(?:⏱️|[🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛])\s*/gu, '');

    // 2. Normalize hyphens (replace non-breaking hyphen with normal hyphen)
    text = text.replace(/\u2011/g, '-');

    // 3. Split grouped timestamps: [1:30, 2:45, 3:00] -> [1:30] [2:45] [3:00]
    text = text.replace(
        /\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*,\s*\d{1,2}:\d{2}(?::\d{2})?)+)\]/g,
        (_match, inner: string) => {
            return inner
                .split(/\s*,\s*/)
                .map((t: string) => `[${t.trim()}]`)
                .join(' ');
        },
    );

    // 4. Fix Bold Timestamps:
    // **[1:30]** -> [1:30]
    text = text.replace(/\*\*(\s*\[\s*\d{1,2}:\d{2}[^\]]*\]\s*)\*\*/g, '$1');

    // **at 1:30** -> at 1:30
    text = text.replace(/\*\*((?:at|around|from)\s+\d{1,2}:\d{2}[^*]*)\*\*/gi, '$1');

    // **0:00-0:30** -> 0:00-0:30
    // Matches ** TIME - TIME **
    text = text.replace(/\*\*(\s*\d{1,2}:\d{2}\s*(?:-|–|—|to)\s*\d{1,2}:\d{2}\s*)\*\*/gi, '$1');

    try {
        const html = marked.parse(text) as string;
        return sanitizeHtml(html);
    } catch (e) {
        console.error('[ask-transcript] Markdown rendering error:', e);
        return text; // Fallback to raw text
    }
}

function sanitizeHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement;
    const allowedTags = new Set([
        'P',
        'STRONG',
        'EM',
        'CODE',
        'PRE',
        'UL',
        'OL',
        'LI',
        'A',
        'BUTTON',
        'BLOCKQUOTE',
        'H1',
        'H2',
        'H3',
        'H4',
        'TABLE',
        'THEAD',
        'TBODY',
        'TR',
        'TH',
        'TD',
        'BR',
        'HR',
    ]);
    const allowedAttrs: Record<string, Set<string>> = {
        A: new Set(['href', 'target', 'rel', 'class']),
        BUTTON: new Set(['type', 'data-timestamp', 'class']),
    };

    const walk = (node: Node): void => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (!allowedTags.has(el.tagName)) {
                const textNode = doc.createTextNode(el.textContent || '');
                el.replaceWith(textNode);
                return;
            }

            const allowed = allowedAttrs[el.tagName] || new Set<string>();
            Array.from(el.attributes).forEach((attr) => {
                if (!allowed.has(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });

            if (el.tagName === 'A') {
                const href = el.getAttribute('href') || '#';
                if (!/^(https?:|mailto:)/i.test(href)) {
                    el.setAttribute('href', '#');
                }
            }
        }

        Array.from(node.childNodes).forEach((child) => walk(child));
    };

    walk(root);
    return root.innerHTML;
}
