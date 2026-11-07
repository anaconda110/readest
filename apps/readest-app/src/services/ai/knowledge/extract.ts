import { generateText } from 'ai';

import type { BookDoc } from '@/libs/document';
import { getAnalysisChatModelName, truncateAnalysisText } from '@/services/ai/analysisService';
import { getAIProvider } from '@/services/ai/providers';
import { extractTextFromDocument } from '@/services/ai/utils/chunker';
import type { AISettings } from '@/services/ai/types';

import { parseKnowledgeExtraction, type ParsedKnowledgeExtraction } from './schema';
import type { ChapterKnowledge } from './types';

const MAX_EXTRACTION_CHARS = 24_000;
const MAX_OUTPUT_TOKENS = 4096;

export interface ChapterExtractionContext {
  settings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  chapterIndex: number;
  chapterTitle: string;
  cfi?: string;
  text: string;
  language: string;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = `You are a meticulous structured-fact extractor for fiction and narrative non-fiction.
Your output is consumed by a reading knowledge base. Extract only what the supplied chapter states.

Absolute rules:
- Never invent characters, relations, places, items, organizations, concepts, or events.
- Use names exactly as written in the chapter. Preserve the source language; do not translate proper nouns.
- Do not extract pronouns or generic nouns (he, she, the old man, the crowd, 老者, 众人, 那人) as entities.
- An alias must be explicitly supported by the text ("also known as", "called", "又名", "即", or stable alternating usage). Never merge two characters who both act independently.
- A relation needs a verbatim evidence quote of 1-2 sentences from this chapter. If there is no direct interaction or explicit statement, do not add a relation.
- Never relate an entity to itself. Never treat co-appearance as a relationship.
- Descriptions and summaries are written in the UI language. Verbatim evidence stays in the chapter language.
- Keep the JSON compact. Do not repeat the chapter text.

Return ONLY one valid JSON object, no markdown fence, no commentary:
{
  "people": [{"name": "exact name", "aliases": ["exact alias"], "description": "one short sentence", "category": "role if explicit"}],
  "locations": [{"name": "exact place", "aliases": [], "description": "short", "category": "city/room/realm/...", "parent": "containing place name if explicit"}],
  "items": [{"name": "exact item", "aliases": [], "description": "short", "category": "weapon/token/..."}],
  "orgs": [{"name": "exact organization", "aliases": [], "description": "short", "category": "sect/army/family/..."}],
  "concepts": [{"name": "exact term", "aliases": [], "description": "definition grounded in the chapter", "category": "cultivation/currency/technique/..."}],
  "relations": [{"source": "person name", "target": "person name", "type": "stable relation word", "evidence": "verbatim quote"}],
  "events": [{"summary": "one sentence", "type": "battle/growth/social/travel/other", "importance": "high|medium|low", "participants": ["person name"], "location": "place name or empty", "evidence": "verbatim quote"}]
}

Relation vocabulary (reuse consistently): 父子, 父女, 母子, 母女, 兄弟, 兄妹, 姐弟, 姐妹, 叔侄, 祖孙, 夫妻, 恋人, 师徒, 主仆, 君臣, 上下级, 朋友, 同门, 同事, 邻居, 结拜兄弟, 师兄弟, 敌对, 竞争, 盟友.
Prefer precise relation words when the text supports them; otherwise use a short descriptive type.

Every array must exist. Use [] when the chapter has nothing for that key.`;

function buildPrompt(
  context: ChapterExtractionContext,
  truncated: boolean,
  repair?: string,
): string {
  const repairNote = repair
    ? `\nYour previous response could not be parsed (${repair}). Return a single complete JSON object this time.`
    : '';
  return `Book: "${context.bookTitle}"${context.authorName ? ` by ${context.authorName}` : ''}
Chapter ${context.chapterIndex + 1}: "${context.chapterTitle}"
UI language for descriptions: ${context.language || 'en'}
${truncated ? 'The chapter was truncated; extract only from the supplied text.' : 'The chapter text is complete.'}
${repairNote}

<chapter>
${context.text}
</chapter>`;
}

async function requestExtraction(
  context: ChapterExtractionContext,
  truncated: boolean,
  repair?: string,
): Promise<string> {
  const { text } = await generateText({
    model: getAIProvider(context.settings).getModel(),
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(context, truncated, repair),
    temperature: 0.1,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: context.signal,
  });
  if (!text.trim()) throw new Error('The AI provider returned an empty knowledge extraction.');
  return text;
}

/** Extracts structured facts from one section. The caller owns persistence. */
export async function extractChapterKnowledge(
  context: ChapterExtractionContext,
): Promise<ChapterKnowledge> {
  if (!context.text.trim()) throw new Error('This chapter has no extractable text.');

  const truncated = context.text.length > MAX_EXTRACTION_CHARS;
  const chapterText = truncateAnalysisText(context.text, MAX_EXTRACTION_CHARS);
  const promptContext: ChapterExtractionContext = { ...context, text: chapterText };

  let parsed: ParsedKnowledgeExtraction;
  try {
    parsed = parseKnowledgeExtraction(await requestExtraction(promptContext, truncated));
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    parsed = parseKnowledgeExtraction(await requestExtraction(promptContext, truncated, reason));
  }

  const now = Date.now();
  return {
    bookHash: context.bookHash,
    chapterIndex: context.chapterIndex,
    chapterTitle: context.chapterTitle,
    cfi: context.cfi,
    model: getAnalysisChatModelName(context.settings),
    truncated,
    createdAt: now,
    updatedAt: now,
    ...parsed,
  };
}

/** Reads a section directly. Kept separate so batch analysis can reuse it. */
export async function readSectionText(bookDoc: BookDoc, chapterIndex: number): Promise<string> {
  const section = bookDoc.sections[chapterIndex];
  if (!section) throw new Error(`Chapter section ${chapterIndex + 1} was not found in this book.`);
  const doc = await section.createDocument();
  return extractTextFromDocument(doc);
}
