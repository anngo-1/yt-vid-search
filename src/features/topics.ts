/**
 * topics - pure logic for parsing and validating topic data
 *
 * DOM rendering lives in components/tabs/TopicsTab.ts
 */

import { state } from '@/services/state';
import { TopicsParseError } from '@/services/errors';
import type { TopicsData, Topic } from '@/types';

export const TOPICS_SYSTEM_PROMPT = `You are an expert at analyzing video transcripts. Create a hierarchical topic outline.

REQUIREMENTS:
1. Create 8-40 topics based on video length
2. Topics should be specific, not generic
3. Include timestamps for each topic
4. Create 2-4 subtopics under main topics

OUTPUT FORMAT (STRICT JSON):
\`\`\`json
{
  "topics": [
    {
      "title": "Main Topic Name",
      "timestamp": "[MM:SS]-[MM:SS]",
      "subtopics": [
        { "title": "Specific Sub-topic", "timestamp": "[MM:SS]" }
      ]
    }
  ]
}
\`\`\`

Return ONLY valid JSON.`;

/** check if auto-generate is enabled (defaults to false) */
export function isAutoGenerateEnabled(): boolean {
    return state.settings?.auto_generate_topics === true;
}

/** Extract JSON from LLM response and parse into topics */
export function parseResponse(response: string): TopicsData {
    const match = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
    if (!match) throw new TopicsParseError('No JSON found in response');

    let parsed: unknown;
    try {
        parsed = JSON.parse(match[1] || match[0]);
    } catch (e) {
        throw new TopicsParseError(`Failed to parse topics JSON: ${e instanceof Error ? e.message : 'invalid JSON'}`);
    }

    return validateTopicsData(parsed);
}

/** Validate and normalize raw parsed topics data */
export function validateTopicsData(value: unknown): TopicsData {
    if (!value || typeof value !== 'object') {
        throw new TopicsParseError('Invalid topics format');
    }

    const raw = value as Record<string, unknown>;
    const topics = raw.topics;
    if (!Array.isArray(topics)) {
        throw new TopicsParseError('Invalid topics format');
    }

    const validated: Topic[] = topics
        .filter(
            (t): t is { title: string; timestamp: string; subtopics?: unknown[] } =>
                !!t &&
                typeof (t as { title: string }).title === 'string' &&
                typeof (t as { timestamp: string }).timestamp === 'string',
        )
        .map((topic) => ({
            title: topic.title,
            timestamp: topic.timestamp,
            subtopics: Array.isArray(topic.subtopics)
                ? topic.subtopics
                      .filter(
                          (s): s is { title: string; timestamp: string } =>
                              !!s &&
                              typeof (s as Record<string, unknown>).title === 'string' &&
                              typeof (s as Record<string, unknown>).timestamp === 'string',
                      )
                      .map((s) => ({
                          title: s.title,
                          timestamp: s.timestamp,
                      }))
                : [],
        }));

    return { topics: validated };
}
