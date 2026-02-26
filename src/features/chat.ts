/**
 * chat - pure logic for building chat messages and prompts
 *
 * DOM rendering lives in components/tabs/ChatTab.ts
 */

import { state } from '@/services/state';
import { getVideoTitle } from '@/content/selectors';
import type { ChatMessage } from '@/types';

/** Auto-inline transcript for videos up to ~30k chars (~6k tokens). */
const TRANSCRIPT_INLINE_CHARS = 30_000;

function getInlineTranscript(): string | null {
    if (!state.transcript.length) return null;
    const directMode = state.settings?.chat_direct_mode === true;
    if (!directMode && (!state.fullTranscriptText || state.fullTranscriptText.length > TRANSCRIPT_INLINE_CHARS)) {
        return null;
    }
    return state.transcript.map((s) => `[${s.time}] ${s.text}`).join('\n');
}

/** Returns true when tool calls should be sent to the API. */
export function shouldUseTools(): boolean {
    if (state.settings?.chat_direct_mode === true) return false;
    if (state.fullTranscriptText && state.fullTranscriptText.length <= TRANSCRIPT_INLINE_CHARS) return false;
    return true;
}

export function buildMessages(systemPrompt: string, chatHistory: ChatMessage[]): ChatMessage[] {
    return [{ role: 'system', content: systemPrompt }, ...chatHistory];
}

const TIMESTAMP_RULES = `- Always cite timestamps from the transcript. Each timestamp MUST be in its own square brackets: [MM:SS] or [HH:MM:SS]. For multiple timestamps, write each separately like [1:30] [2:45] [10:02], NEVER group them like [1:30, 2:45].
- For ranges, use [MM:SS-MM:SS] format.
- Be concise and direct.
- Use markdown formatting.
- NEVER repeat yourself or restate what you or the user have already said. Build on your previous responses instead of restating them.
- Answer each question fully in a single response. Do not split responses across multiple turns unless the user asks for a follow-up.
- Keep responses brief - one to three paragraphs maximum unless the user requests detail.`;

const TOOL_RULES = `HOW THE TOOLS WORK:
- search_transcript: case-insensitive substring match against every segment. Returns up to 15 matching segments. A short stem like "invest" matches "investing", "investment", "investor", etc., so shorter roots catch more results than full inflected words.
- read_transcript: returns all segments in a time window (default 120 s, max 300 s). Use it to read a passage in full once you know roughly where it is.
- The transcript is stored exactly as it appears in the video — if the video is in French, German, Japanese, etc., all segments are in that language. Search terms must match the transcript language, not English.

TOOL USE RULES:
- Before calling tools, write one short sentence saying what you're about to look for (e.g. "Let me search for a few variations of that."). This keeps the user informed while tools run.
- Call multiple tools in a SINGLE response whenever possible — they run in parallel at no extra cost.
- Search for root/stem forms alongside full words (e.g. for "investments" also try "invest", "capital", "fund").
- Search for synonyms and related concepts in parallel (e.g. for "happy" also try "joy", "excit", "glad").
- If the video is not in English, use the transcript's actual language for all search queries.
- If searches return 0 results, fall back to read_transcript to scan the relevant time range directly.
- Prefer breadth: multiple short parallel searches beat one long sequential chain.`;

export function buildFullSystemPrompt(): string {
    const title = getVideoTitle();
    const inlineTranscript = getInlineTranscript();

    if (inlineTranscript) {
        return `You are an expert at analyzing video transcripts. You are helping a user understand a YouTube video titled "${title}".

The full transcript is provided below. Answer questions directly from it.

## Transcript
${inlineTranscript}

RULES:
${TIMESTAMP_RULES}`;
    }

    return `You are an expert at analyzing video transcripts. You are helping a user understand a YouTube video titled "${title}".

You have access to tools that let you search the video transcript for specific keywords and read segments of the transcript. Use them to gather information before answering the user's questions accurately.

${TOOL_RULES}

RESPONSE RULES:
${TIMESTAMP_RULES}`;
}

export function buildFollowUpSystemPrompt(): string {
    const title = getVideoTitle();
    const inlineTranscript = getInlineTranscript();

    if (inlineTranscript) {
        return `You are an expert at analyzing video transcripts. You are helping a user understand a YouTube video titled "${title}".

The full transcript is provided below. Answer questions directly from it.

## Transcript
${inlineTranscript}

RULES:
${TIMESTAMP_RULES}`;
    }

    const fast = state.settings?.fast_followups === true;
    let prompt = `You are an expert at analyzing video transcripts. You are helping a user understand a YouTube video titled "${title}".`;

    if (fast) {
        prompt += `\n\nUse your transcript tools along with the conversation history to answer the user's query.`;
    } else {
        prompt += `\n\nYou have access to tools that let you search the video transcript for specific keywords and read segments of the transcript.`;
    }

    prompt += `\n\n${TOOL_RULES}

RESPONSE RULES:
${TIMESTAMP_RULES}`;

    return prompt;
}
