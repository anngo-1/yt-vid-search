/**
 * translation-api - translation-specific API calls and response parsing
 */

import type { Settings } from '@/types';
import { completion } from '@/services/api';
import { TranslationParseError } from '@/services/errors';
import { TRANSLATION_TEMPERATURE } from '@/utils/constants';

/** translate transcript segments */
export async function translateSegments(
    segments: { text: string; index: number }[],
    context: string[],
    targetLanguage: string,
    settings: Settings,
): Promise<Record<number, string>> {
    const systemPrompt = `You are a subtitle translator. Translate video transcript segments.

RULES:
1. Output ONLY valid JSON - no markdown, no explanations
2. Every input segment ID MUST appear in output
3. Preserve meaning and tone
4. Keep translations concise for subtitles
5. Use natural ${targetLanguage}
6. DO NOT THINK. JUST OUTPUT.

OUTPUT: {"id": "translation", ...} /no_think`;

    const userPrompt = `Translate to ${targetLanguage}.
${context.length ? `\nContext:\n${context.join('\n')}\n` : ''}
Segments:
${segments.map((s) => `${s.index}: ${s.text}`).join('\n')}

JSON only:`;

    const response = await completion(
        [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        settings,
        TRANSLATION_TEMPERATURE,
        'captions',
    );

    return parseTranslationResponse(response);
}

// --- response parsing ---

export function parseTranslationResponse(response: string): Record<number, string> {
    return (
        tryParseJsonBlock(response) ??
        tryParseRelaxedJson(response) ??
        tryParseLineFormat(response) ??
        throwParseError(response)
    );
}

/** Strategy 1: Extract JSON object from response (handles markdown code fences) */
function tryParseJsonBlock(response: string): Record<number, string> | null {
    try {
        const cleaned = response
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();

        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            return normalizeTranslationMap(JSON.parse(match[0]));
        }
    } catch (e) {
        console.warn('[ask-transcript] Direct JSON parse failed, trying fallbacks:', e);
    }
    return null;
}

/** Strategy 2: Relaxed regex for JSON-like key-value pairs ("1": "val", '1': 'val', 1: "val") */
function tryParseRelaxedJson(response: string): Record<number, string> | null {
    const result: Record<number, string> = {};
    const jsonRegex = /(?:^|\s|,|{)(?:['"]?)(\d+)(?:['"]?):\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

    let match;
    while ((match = jsonRegex.exec(response)) !== null) {
        const key = parseInt(match[1], 10);
        const rawVal = match[2] !== undefined ? match[2] : match[3];
        if (rawVal !== undefined) {
            result[key] = rawVal.replace(/\\(["'])/g, '$1').replace(/\\n/g, '\n');
        }
    }

    return Object.keys(result).length > 0 ? normalizeTranslationMap(result) : null;
}

/** Strategy 3: Line-based parsing (123: Translation text) */
function tryParseLineFormat(response: string): Record<number, string> | null {
    const lineRegex = /^(\d+):\s+(.+)$/gm;
    const result: Record<number, string> = {};
    let lineMatch;

    while ((lineMatch = lineRegex.exec(response)) !== null) {
        const key = parseInt(lineMatch[1], 10);
        let val = lineMatch[2].trim();

        if (val.endsWith(',')) val = val.slice(0, -1);
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }

        result[key] = val;
    }

    return Object.keys(result).length > 0 ? normalizeTranslationMap(result) : null;
}

function throwParseError(response: string): never {
    console.error('[ask-transcript] Translation parsing failed. Raw response:', response);
    throw new TranslationParseError('Failed to parse translation response (check console for raw output)', response);
}

/** Normalize a raw translation response object into a numeric-keyed string map */
export function normalizeTranslationMap(value: unknown): Record<number, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TranslationParseError('Invalid translation response format', JSON.stringify(value));
    }

    const output: Record<number, string> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
        if (typeof val === 'string') {
            output[parseInt(key, 10)] = val;
        }
    });

    if (Object.keys(output).length === 0) {
        throw new TranslationParseError('Invalid translation response format', JSON.stringify(value));
    }

    return output;
}
