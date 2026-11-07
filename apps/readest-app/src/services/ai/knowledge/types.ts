import type { BookDoc } from '@/libs/document';
import type { AIAnalysisSource, AISettings } from '@/services/ai/types';

export type KnowledgeEntityType = 'person' | 'location' | 'item' | 'org' | 'concept';

export type KnowledgeRelationCategory =
  | 'family'
  | 'intimate'
  | 'hierarchical'
  | 'social'
  | 'hostile'
  | 'other';

export interface KnowledgeEvidence {
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
}

/** A name-level mention extracted from one chapter. */
export interface KnowledgeMention {
  name: string;
  aliases: string[];
  description: string;
  category?: string;
  parent?: string;
}

export interface KnowledgeRelationFact {
  source: string;
  target: string;
  type: string;
  evidence: string;
}

export interface KnowledgeEventFact {
  summary: string;
  type: string;
  importance: 'high' | 'medium' | 'low';
  participants: string[];
  location?: string;
  evidence: string;
}

/** Raw, per-chapter extraction result before cross-chapter aggregation. */
export interface ChapterKnowledge {
  bookHash: string;
  chapterIndex: number;
  chapterTitle: string;
  cfi?: string;
  model: string;
  truncated: boolean;
  createdAt: number;
  updatedAt: number;
  people: KnowledgeMention[];
  locations: KnowledgeMention[];
  items: KnowledgeMention[];
  orgs: KnowledgeMention[];
  concepts: KnowledgeMention[];
  relations: KnowledgeRelationFact[];
  events: KnowledgeEventFact[];
}

export interface KnowledgeEntity {
  id: string;
  type: KnowledgeEntityType;
  name: string;
  aliases: string[];
  description: string;
  category?: string;
  parent?: string;
  firstChapter: number;
  chapters: number[];
  evidence: KnowledgeEvidence[];
}

export interface KnowledgeRelation {
  id: string;
  source: string;
  target: string;
  type: string;
  category: KnowledgeRelationCategory;
  weight: number;
  chapters: number[];
  evidence: KnowledgeEvidence[];
}

export interface KnowledgeEvent {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  summary: string;
  type: string;
  importance: 'high' | 'medium' | 'low';
  participants: string[];
  location?: string;
  evidence: KnowledgeEvidence[];
}

export interface KnowledgeStats {
  people: number;
  locations: number;
  items: number;
  orgs: number;
  concepts: number;
  relations: number;
  events: number;
}

export interface BookKnowledge {
  bookHash: string;
  bookTitle: string;
  updatedAt: number;
  analyzedChapters: number[];
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  events: KnowledgeEvent[];
  stats: KnowledgeStats;
}

export interface KnowledgeAnalyzeContext {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  bookDoc: BookDoc;
  chapterIndices: number[];
  settings: AISettings;
  language: string;
}

export interface KnowledgeRunState {
  status: 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
  total: number;
  completed: number;
  currentChapter?: number;
  error?: string;
}

/**
 * Readest's source-jump contract. Knowledge cards reuse it so a fact can be
 * opened in the reader at the chapter that produced it.
 */
export function toAnalysisSource(
  chapterIndex: number,
  chapterTitle: string,
  text: string,
  cfi?: string,
): AIAnalysisSource {
  return {
    id: `knowledge-${chapterIndex}`,
    chapterTitle,
    sectionIndex: chapterIndex,
    text,
    score: 1,
    cfi,
  };
}
