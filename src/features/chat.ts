/**
 * chat - pure logic for building chat messages and prompts
 *
 * DOM rendering lives in components/tabs/ChatTab.ts
 */

import { state } from '@/services/state';
import { getVideoTitle } from '@/content/selectors';
import type { ChatMessage } from '@/types';

export function buildMessages(systemPrompt: string, chatHistory: ChatMessage[]): ChatMessage[] {
    return [{ role: 'system', content: systemPrompt }, ...chatHistory];
}

function buildTranscriptBlock(): string {
    return `<transcript>\n${state.fullTranscriptText}\n</transcript>`;
}

export function buildFullSystemPrompt(): string {
    const title = getVideoTitle();
    return `You are an expert at analyzing video transcripts. You are helping a user understand a YouTube video titled "${title}".

The full transcript with timestamps is provided below. Use it to answer the user's questions accurately.

${buildTranscriptBlock()}

RULES:
- Always cite timestamps from the transcript. Each timestamp MUST be in its own square brackets: [MM:SS] or [HH:MM:SS]. For multiple timestamps, write each separately like [1:30] [2:45] [10:02], NEVER group them like [1:30, 2:45].
- For ranges, use [MM:SS-MM:SS] format.
- Be concise and direct.
- Use markdown formatting.`;
}

export function buildFollowUpSystemPrompt(): string {
    const title = getVideoTitle();
    const fast = state.settings?.fast_followups === true;

    let prompt = `You are an expert at analyzing video transcripts. You are helping a user understand a YouTube video titled "${title}".`;

    if (fast) {
        prompt += `\n\nThe transcript was provided earlier in this conversation. Use it along with the conversation history to answer.`;
    } else {
        prompt += `\n\nThe full transcript with timestamps is provided below.\n\n${buildTranscriptBlock()}`;
    }

    prompt += `\n\nRULES:
- Always cite timestamps from the transcript. Each timestamp MUST be in its own square brackets: [MM:SS] or [HH:MM:SS]. For multiple timestamps, write each separately like [1:30] [2:45] [10:02], NEVER group them like [1:30, 2:45].
- For ranges, use [MM:SS-MM:SS] format.
- Be concise and direct.
- Use markdown formatting.`;

    return prompt;
}
