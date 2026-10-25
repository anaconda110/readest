export { createTauriAdapter } from './TauriChatAdapter';
export type { TauriAdapterOptions } from './TauriChatAdapter';
export { getEmbeddingModelName, selectBackend } from './retrievalBackend';
export type {
  RetrievalBackend,
  RetrievalBackendKind,
  SearchBookResponse,
  SearchBookResult,
  SearchStatus,
} from './retrievalBackend';
export { LegacyIdbBackend } from './LegacyIdbBackend';
export { ReedyBackend } from './ReedyBackend';
export { ReedySourceStore } from './reedySourceStore';
export type { SourceItem } from './reedySourceStore';
