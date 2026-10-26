import type { LanguageModel, EmbeddingModel } from 'ai';

export type AIProviderName = 'ollama' | 'ai-gateway' | 'openrouter';

export interface AIProvider {
  id: AIProviderName;
  name: string;
  requiresAuth: boolean;

  getModel(): LanguageModel;
  getEmbeddingModel(): EmbeddingModel;

  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
}

export interface AISettings {
  enabled: boolean;
  provider: AIProviderName;

  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaEmbeddingModel: string;

  aiGatewayApiKey?: string;
  aiGatewayModel?: string;
  aiGatewayCustomModel?: string;
  aiGatewayEmbeddingModel?: string;

  // OpenAI-compatible provider (OpenRouter, Together, Groq, vLLM, ...).
  // Default base URL is OpenRouter's, but any compatible endpoint works.
  openrouterApiKey?: string;
  openrouterBaseUrl?: string;
  openrouterModel?: string;
  openrouterEmbeddingModel?: string;

  spoilerProtection: boolean;
  maxContextChunks: number;
  indexingMode: 'on-demand' | 'background';

  /** Local model used for book indexing and query embeddings, independent of the chat provider. */
  ragEngine: string;
  /** Fall back to the built-in TF-IDF index when a semantic model cannot load. */
  ragFallback?: boolean;
  /** Retrieval breadth when no book index statistics are available. */
  topKDefault: number;
  /** Optional size-aware retrieval breadth overrides. */
  topKTiers?: { maxChunks: number; topK: number }[];
  /** Soft storage budget shown and enforced by retrieval settings. */
  ragCacheLimitMB?: number;

  /**
   * Reedy MVP retrieval (Turso vector + Tantivy FTS + CFI citations).
   * MVP is desktop-only — the runtime gate in `selectBackend()` enforces
   * isTauri() regardless of this flag. UI in M1.8 disables the toggle on web.
   */
  reedy?: {
    enabled: boolean;
    /**
     * 'mvp' (default) keeps the Phase 1B path: lookupPassage tool wired
     * through @assistant-ui/react's adapter. 'agent' switches the
     * notebook AI tab to the Phase 4 ReedyAssistant (custom AgentRuntime
     * + thread UI). Requires `reedy.enabled && isTauri() &&
     * runtime === 'agent'` to engage.
     */
    runtime?: 'mvp' | 'agent';
  };
}

export interface TextChunk {
  id: string;
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string;
  text: string;
  embedding?: number[];
  pageNumber: number; // page number using Readest's 1500 chars/page formula
}

export interface ScoredChunk extends TextChunk {
  score: number;
  searchMethod: 'bm25' | 'vector' | 'hybrid';
}

export interface BookIndexMeta {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  totalSections: number;
  totalChunks: number;
  embeddingModel: string;
  lastUpdated: number;
}

export interface IndexingState {
  bookHash: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  progress: number;
  chunksProcessed: number;
  totalChunks: number;
  error?: string;
}

export interface EmbeddingProgress {
  current: number;
  total: number;
  phase: 'loading-model' | 'preparing' | 'chunking' | 'embedding' | 'indexing';
}

// stored AI conversation for a book
export interface AIConversation {
  id: string;
  bookHash: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// single message in an AI conversation
export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export type AIAnalysisKind = 'chapter' | 'book';

export type AIAnalysisStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled';

/** A passage that grounded an analysis report. */
export interface AIAnalysisSource {
  id: string;
  chapterTitle: string | null;
  sectionIndex: number;
  text: string;
  score: number;
  cfi?: string;
  pageNumber?: number;
}

/**
 * A durable chapter/book analysis result. The report id is stable for a
 * particular book + scope, so regenerating replaces the previous output.
 */
export interface AIAnalysisReport {
  id: string;
  bookHash: string;
  bookTitle: string;
  kind: AIAnalysisKind;
  sectionIndex?: number;
  chapterTitle?: string;
  content: string;
  model: string;
  status: AIAnalysisStatus;
  error?: string;
  sources: AIAnalysisSource[];
  /** Explains what evidence the model was allowed to inspect. */
  coverage?: string;
  /** Marks reports bundled from another reader instead of generated in Readest. */
  importedFrom?: 'ai-novel-reader-v2';
  sourceChapterIds?: string[];
  sourceSummaryIds?: string[];
  createdAt: number;
  updatedAt: number;
}
