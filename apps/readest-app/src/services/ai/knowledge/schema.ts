import { z } from 'zod';

import type { KnowledgeEventFact, KnowledgeMention, KnowledgeRelationFact } from './types';

const MAX_MENTIONS = 200;
const MAX_RELATIONS = 300;
const MAX_EVENTS = 120;
const MAX_ALIASES = 12;

const text = z.preprocess((value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}, z.string());

const textList = z.preprocess((value) => {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、;；]/)
      : [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (typeof item === 'number') return String(item);
      return '';
    })
    .filter(Boolean);
}, z.array(z.string()));

const optionalText = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}, z.string().optional());

const mentionSchema = z.object({
  name: text,
  aliases: textList.catch([]),
  description: text.catch(''),
  category: optionalText,
  parent: optionalText,
});

const relationSchema = z.object({
  source: text,
  target: text,
  type: text,
  evidence: text.catch(''),
});

const eventSchema = z.object({
  summary: text,
  type: text.catch('other'),
  importance: z.preprocess(
    (value) => {
      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (normalized === 'high' || normalized === '高' || normalized === '重要') return 'high';
      if (normalized === 'low' || normalized === '低' || normalized === '次要') return 'low';
      return 'medium';
    },
    z.enum(['high', 'medium', 'low']),
  ),
  participants: textList.catch([]),
  location: optionalText,
  evidence: text.catch(''),
});

const extractionSchema = z.object({
  people: z.array(mentionSchema).catch([]),
  locations: z.array(mentionSchema).catch([]),
  items: z.array(mentionSchema).catch([]),
  orgs: z.array(mentionSchema).catch([]),
  concepts: z.array(mentionSchema).catch([]),
  relations: z.array(relationSchema).catch([]),
  events: z.array(eventSchema).catch([]),
});

export interface ParsedKnowledgeExtraction {
  people: KnowledgeMention[];
  locations: KnowledgeMention[];
  items: KnowledgeMention[];
  orgs: KnowledgeMention[];
  concepts: KnowledgeMention[];
  relations: KnowledgeRelationFact[];
  events: KnowledgeEventFact[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept a few common container/key spellings emitted by weaker models. */
function unwrapExtraction(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const container = isRecord(value['chapter_fact'])
    ? value['chapter_fact']
    : isRecord(value['data'])
      ? value['data']
      : isRecord(value['result'])
        ? value['result']
        : value;
  if (!isRecord(container)) return container;
  return {
    ...container,
    people: container['people'] ?? container['characters'],
    concepts: container['concepts'] ?? container['new_concepts'],
  };
}

export function normalizeKnowledgeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function knowledgeNameKey(value: string): string {
  return normalizeKnowledgeName(value).toLocaleLowerCase();
}

/** Extract the first balanced JSON object, tolerating prose or code fences. */
export function sliceJsonObject(raw: string): string | null {
  const cleaned = raw.replace(/^\uFEFF/, '').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1]!.trim() : cleaned;
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function uniqueStrings(values: string[], limit = MAX_ALIASES): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeKnowledgeName(value);
    if (!normalized) continue;
    const key = knowledgeNameKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeMentions(mentions: KnowledgeMention[]): KnowledgeMention[] {
  const byKey = new Map<string, KnowledgeMention>();
  for (const mention of mentions) {
    const name = normalizeKnowledgeName(mention.name);
    if (!name) continue;
    const aliases = uniqueStrings(mention.aliases.filter((alias) => alias !== mention.name));
    const key = knowledgeNameKey(name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name,
        aliases,
        description: mention.description?.trim() ?? '',
        category: mention.category?.trim() || undefined,
        parent: mention.parent?.trim() || undefined,
      });
      continue;
    }
    existing.aliases = uniqueStrings([...existing.aliases, ...aliases]);
    if ((mention.description?.length ?? 0) > existing.description.length) {
      existing.description = mention.description.trim();
    }
    existing.category ||= mention.category?.trim() || undefined;
    existing.parent ||= mention.parent?.trim() || undefined;
  }
  return Array.from(byKey.values()).slice(0, MAX_MENTIONS);
}

function normalizeRelations(relations: KnowledgeRelationFact[]): KnowledgeRelationFact[] {
  const seen = new Set<string>();
  const result: KnowledgeRelationFact[] = [];
  for (const relation of relations) {
    const source = normalizeKnowledgeName(relation.source);
    const target = normalizeKnowledgeName(relation.target);
    const type = normalizeKnowledgeName(relation.type) || 'other';
    if (!source || !target) continue;
    if (knowledgeNameKey(source) === knowledgeNameKey(target)) continue;
    const key = `${knowledgeNameKey(source)}\u0000${knowledgeNameKey(target)}\u0000${knowledgeNameKey(type)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ source, target, type, evidence: relation.evidence.trim() });
    if (result.length >= MAX_RELATIONS) break;
  }
  return result;
}

function normalizeEvents(events: KnowledgeEventFact[]): KnowledgeEventFact[] {
  const seen = new Set<string>();
  const result: KnowledgeEventFact[] = [];
  for (const event of events) {
    const summary = normalizeKnowledgeName(event.summary);
    if (!summary) continue;
    const key = summary.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      summary,
      type: normalizeKnowledgeName(event.type) || 'other',
      importance: event.importance,
      participants: uniqueStrings(event.participants, 30),
      location: event.location ? normalizeKnowledgeName(event.location) : undefined,
      evidence: event.evidence.trim(),
    });
    if (result.length >= MAX_EVENTS) break;
  }
  return result;
}

/**
 * Parses a model response that should be a JSON object with the extraction
 * keys. Throws a useful error when no object can be recovered so the caller
 * can retry once with a stricter prompt.
 */
export function parseKnowledgeExtraction(raw: string): ParsedKnowledgeExtraction {
  const candidate = sliceJsonObject(raw);
  if (!candidate) throw new Error('The model did not return a JSON object.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `The model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = extractionSchema.safeParse(unwrapExtraction(parsed));
  if (!result.success) {
    throw new Error(`The model returned an unexpected knowledge shape: ${result.error.message}`);
  }

  return {
    people: normalizeMentions(result.data.people),
    locations: normalizeMentions(result.data.locations),
    items: normalizeMentions(result.data.items),
    orgs: normalizeMentions(result.data.orgs),
    concepts: normalizeMentions(result.data.concepts),
    relations: normalizeRelations(result.data.relations),
    events: normalizeEvents(result.data.events),
  };
}
