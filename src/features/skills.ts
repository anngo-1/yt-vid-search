export interface Skill {
    name: string;
    description: string;
    prompt: string;
    path: string;
}

export interface SkillInvocation {
    skill: Skill;
    input: string;
    displayText: string;
    modelText: string;
}

const rawSkillModules = import.meta.glob('../skills/*.md', {
    eager: true,
    import: 'default',
    query: '?raw',
}) as Record<string, string>;

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

function basename(path: string): string {
    return path.split('/').pop()?.replace(/\.md$/i, '') ?? '';
}

function parseFrontmatter(raw: string): { attrs: Record<string, string>; body: string } {
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!match) return { attrs: {}, body: raw.trim() };

    const attrs: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!parts) continue;
        attrs[parts[1].toLowerCase()] = parts[2].replace(/^["']|["']$/g, '').trim();
    }

    return { attrs, body: raw.slice(match[0].length).trim() };
}

function normalizeSkillName(name: string): string {
    return name.trim().toLowerCase();
}

function descriptionFromBody(body: string): string {
    const line = body
        .split('\n')
        .map((value) => value.trim())
        .find((value) => value && !value.startsWith('#'));
    if (!line) return '';
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

export function parseSkillMarkdown(path: string, raw: string): Skill | null {
    const { attrs, body } = parseFrontmatter(raw);
    const name = normalizeSkillName(attrs.name || basename(path));
    if (!SKILL_NAME_RE.test(name) || !body) return null;

    return {
        name,
        description: attrs.description || descriptionFromBody(body),
        prompt: body,
        path,
    };
}

export function buildSkillRegistry(rawModules: Record<string, string>): Skill[] {
    const byName = new Map<string, Skill>();
    for (const [path, raw] of Object.entries(rawModules)) {
        const skill = parseSkillMarkdown(path, raw);
        if (!skill) continue;
        byName.set(skill.name, skill);
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const AVAILABLE_SKILLS: Skill[] = buildSkillRegistry(rawSkillModules);

export function findSkill(name: string, skills: Skill[] = AVAILABLE_SKILLS): Skill | null {
    const normalized = normalizeSkillName(name);
    return skills.find((skill) => skill.name === normalized) ?? null;
}

export function filterSkills(query: string, skills: Skill[] = AVAILABLE_SKILLS): Skill[] {
    const normalized = normalizeSkillName(query);
    if (!normalized) return skills;
    return skills.filter((skill) => skill.name.includes(normalized));
}

export function parseSkillCommand(text: string): { name: string; input: string } | null {
    const match = text.match(/^\/([A-Za-z][A-Za-z0-9-]*)(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    return {
        name: normalizeSkillName(match[1]),
        input: (match[2] || '').trim(),
    };
}

export function buildSkillPrompt(skill: Skill, input: string): string {
    const request = input || 'Run this skill using the available transcript context.';
    return `Use the /${skill.name} skill for this request.

Skill instructions:
${skill.prompt}

User request:
${request}`;
}

export function resolveSkillInvocation(text: string, skills: Skill[] = AVAILABLE_SKILLS): SkillInvocation | null {
    const command = parseSkillCommand(text);
    if (!command) return null;

    const skill = findSkill(command.name, skills);
    if (!skill) return null;

    return {
        skill,
        input: command.input,
        displayText: text,
        modelText: buildSkillPrompt(skill, command.input),
    };
}

export function isUnknownSkillCommand(text: string, skills: Skill[] = AVAILABLE_SKILLS): boolean {
    const command = parseSkillCommand(text);
    return !!command && !findSkill(command.name, skills);
}
