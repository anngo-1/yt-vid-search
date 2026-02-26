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

// Pre-compiled timestamp regexes — must be outside tokenizer() or they're rebuilt on every call
const _timePattern = '\\d{1,2}:\\d{2}(?::\\d{2})?';
const _sep = '\\s*(?:to|-|–|—|\\u2011)\\s*';
const TS_BRACKET = new RegExp(`^\\[(${_timePattern}(?:${_sep}${_timePattern})?)\\]`);
const TS_AT = new RegExp(`^(?:at|around|~|about|from)\\s+(${_timePattern}(?:${_sep}${_timePattern})?)`, 'i');
const TS_RANGE = new RegExp(`^(${_timePattern}${_sep}${_timePattern})`);

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
        let match = TS_BRACKET.exec(src);
        if (match) {
            const display = match[1];
            const firstTime = (display.match(/\d{1,2}:\d{2}:\d{2}/) || display.match(/\d{1,2}:\d{2}/))?.[0] || '0:00';
            return { type: 'timestamp', raw: match[0], text: match[0], seconds: timeToSeconds(firstTime) } as TimestampToken;
        }

        match = TS_AT.exec(src);
        if (match) {
            const firstTime = (match[1].match(/\d{1,2}:\d{2}:\d{2}/) || match[1].match(/\d{1,2}:\d{2}/))?.[0] || '0:00';
            return { type: 'timestamp', raw: match[0], text: match[0], seconds: timeToSeconds(firstTime) } as TimestampToken;
        }

        match = TS_RANGE.exec(src);
        if (match) {
            const display = match[1];
            const firstTime = (display.match(/\d{1,2}:\d{2}:\d{2}/) || display.match(/\d{1,2}:\d{2}/))?.[0] || '0:00';
            return { type: 'timestamp', raw: match[0], text: display, seconds: timeToSeconds(firstTime) } as TimestampToken;
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
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const root = tpl.content;
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
                el.replaceWith(document.createTextNode(el.textContent || ''));
                return;
            }

            const allowed = allowedAttrs[el.tagName] || new Set<string>();
            for (let i = el.attributes.length - 1; i >= 0; i--) {
                const attr = el.attributes[i];
                if (!allowed.has(attr.name)) el.removeAttribute(attr.name);
            }

            if (el.tagName === 'A') {
                const href = el.getAttribute('href') || '#';
                if (!/^(https?:|mailto:)/i.test(href)) el.setAttribute('href', '#');
            }
        }

        for (const child of Array.from(node.childNodes)) walk(child);
    };

    walk(root);
    const div = document.createElement('div');
    div.appendChild(root);
    return div.innerHTML;
}
