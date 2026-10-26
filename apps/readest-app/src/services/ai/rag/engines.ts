export const TFIDF_ENGINE_ID = 'tfidf';
export const TFIDF_DIM = 128;
export const DEFAULT_RAG_ENGINE = 'Xenova/bge-small-zh-v1.5';

export interface RagEngineInfo {
  id: string;
  modelKey: string;
  name: string;
  description: string;
  sizeMB: number;
  dim: number;
  batchSize: number;
  /** Whether this engine performs semantic embedding or local lexical hashing. */
  semantic: boolean;
}

const ENGINE_LIST: RagEngineInfo[] = [
  {
    id: TFIDF_ENGINE_ID,
    modelKey: '',
    name: 'TF-IDF (Built-in)',
    description: 'Fast local lexical retrieval with no model download.',
    sizeMB: 0,
    dim: TFIDF_DIM,
    batchSize: 32,
    semantic: false,
  },
  {
    id: 'Xenova/bge-small-zh-v1.5',
    modelKey: 'Xenova/bge-small-zh-v1.5',
    name: 'BGE Small ZH',
    description: 'Chinese-first semantic retrieval. Recommended for Chinese books.',
    sizeMB: 26,
    dim: 512,
    batchSize: 8,
    semantic: true,
  },
  {
    id: 'Xenova/gte-small',
    modelKey: 'Xenova/gte-small',
    name: 'GTE Small',
    description: 'Balanced Chinese and English semantic retrieval.',
    sizeMB: 34,
    dim: 384,
    batchSize: 8,
    semantic: true,
  },
  {
    id: 'Xenova/multilingual-e5-small',
    modelKey: 'Xenova/multilingual-e5-small',
    name: 'Multilingual E5 Small',
    description: 'Multilingual semantic retrieval across more than 100 languages.',
    sizeMB: 120,
    dim: 384,
    batchSize: 8,
    semantic: true,
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    modelKey: 'Xenova/all-MiniLM-L6-v2',
    name: 'All-MiniLM-L6-v2',
    description: 'Compact English-first semantic retrieval model.',
    sizeMB: 23,
    dim: 384,
    batchSize: 16,
    semantic: true,
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    modelKey: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    name: 'Multilingual MiniLM L12',
    description: 'Deeper multilingual semantic retrieval for mixed-language books.',
    sizeMB: 120,
    dim: 384,
    batchSize: 8,
    semantic: true,
  },
];

export const RAG_ENGINES = ENGINE_LIST;

const ENGINE_BY_ID = new Map(ENGINE_LIST.map((engine) => [engine.id, engine]));

export function getRagEngineInfo(engineId?: string | null): RagEngineInfo {
  return ENGINE_BY_ID.get(engineId || '') ?? ENGINE_BY_ID.get(DEFAULT_RAG_ENGINE)!;
}

export function getRagEngineDisplayName(engineId?: string | null): string {
  return getRagEngineInfo(engineId).name;
}

export function isSemanticRagEngine(engineId?: string | null): boolean {
  return getRagEngineInfo(engineId).semantic;
}
