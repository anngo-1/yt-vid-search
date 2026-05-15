import { describe, expect, it } from 'vitest';
import {
    AVAILABLE_SKILLS,
    buildSkillPrompt,
    buildSkillRegistry,
    filterSkills,
    parseSkillCommand,
    parseSkillMarkdown,
    resolveSkillInvocation,
} from '../../src/features/skills';

describe('skills', () => {
    it('loads packaged markdown skills', () => {
        expect(AVAILABLE_SKILLS.map((skill) => skill.name)).toContain('summarize');
    });

    it('parses optional frontmatter and uses markdown body as the prompt', () => {
        const skill = parseSkillMarkdown(
            '../skills/test.md',
            `---
name: custom
description: Custom skill
---

Do the custom thing.`,
        );

        expect(skill).toEqual({
            name: 'custom',
            description: 'Custom skill',
            prompt: 'Do the custom thing.',
            path: '../skills/test.md',
        });
    });

    it('derives name and description when frontmatter is omitted', () => {
        const skill = parseSkillMarkdown('../skills/dev-note.md', '# Title\n\nUse this skill for notes.');

        expect(skill?.name).toBe('dev-note');
        expect(skill?.description).toBe('Use this skill for notes.');
        expect(skill?.prompt).toBe('# Title\n\nUse this skill for notes.');
    });

    it('filters skills by slash query', () => {
        const skills = buildSkillRegistry({
            '../skills/summarize.md': 'Summarize.',
            '../skills/find-quotes.md': 'Find quotes.',
        });

        expect(filterSkills('sum', skills).map((skill) => skill.name)).toEqual(['summarize']);
        expect(filterSkills('', skills).map((skill) => skill.name)).toEqual(['find-quotes', 'summarize']);
    });

    it('parses and resolves slash skill invocations', () => {
        const skills = buildSkillRegistry({ '../skills/summarize.md': 'Summarize briefly.' });

        expect(parseSkillCommand('/summarize the second half')).toEqual({
            name: 'summarize',
            input: 'the second half',
        });

        const invocation = resolveSkillInvocation('/summarize the second half', skills);
        expect(invocation?.displayText).toBe('/summarize the second half');
        expect(invocation?.modelText).toContain('Use the /summarize skill');
        expect(invocation?.modelText).toContain('Summarize briefly.');
        expect(invocation?.modelText).toContain('the second half');
    });

    it('builds a default request when no skill input is provided', () => {
        const skills = buildSkillRegistry({ '../skills/summarize.md': 'Summarize briefly.' });

        expect(buildSkillPrompt(skills[0], '')).toContain('Run this skill using the available transcript context.');
    });
});
