'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantRuntime,
  type ThreadMessage,
  type ThreadHistoryAdapter,
} from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { aiLogger, createTauriAdapter } from '@/services/ai';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import {
  LegacyIdbBackend,
  ReedyBackend,
  ReedySourceStore,
  selectBackend,
  type RetrievalBackend,
  type SourceItem,
} from '@/services/ai/adapters';
import type {
  AIAnalysisSource,
  EmbeddingProgress,
  AISettings,
  AIMessage,
} from '@/services/ai/types';
import { getRagEngineDisplayName } from '@/services/ai/rag/engines';
import type { RetrievedChunk } from '@/services/reedy/retrieval/BookRetriever';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { BookNote } from '@/types/book';
import { ReedyAssistant, type ReedyIndexState } from '@/services/reedy/ui/ReedyAssistant';
import type { ReadingContextSnapshot } from '@/services/reedy/tools/builtins/types';

import { Thread } from '@/components/assistant/Thread';
import NotebookEditor from './NotebookEditor';
import {
  AIAnalysisDisabledState,
  AIAnalysisIndexState,
  AIAnalysisPanel,
  AIAnalysisSearch,
} from './AIAnalysisPanel';
import { AIAnalysisWorkspace } from './AIAnalysisWorkspace';

// Helper function to convert AIMessage array to ExportedMessageRepository format
// Each message needs to be wrapped with { message, parentId } structure
function convertToExportedMessages(
  aiMessages: AIMessage[],
): { message: ThreadMessage; parentId: string | null }[] {
  return aiMessages.map((msg, idx) => {
    const baseMessage = {
      id: msg.id,
      content: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
      metadata: { custom: {} },
    };

    // Build role-specific message to satisfy ThreadMessage union type
    const threadMessage: ThreadMessage =
      msg.role === 'user'
        ? ({
            ...baseMessage,
            role: 'user' as const,
            attachments: [] as const,
          } as unknown as ThreadMessage)
        : ({
            ...baseMessage,
            role: 'assistant' as const,
            status: { type: 'complete' as const, reason: 'stop' as const },
          } as unknown as ThreadMessage);

    return {
      message: threadMessage,
      parentId: idx > 0 ? (aiMessages[idx - 1]?.id ?? null) : null,
    };
  });
}

interface AIAssistantProps {
  bookKey: string;
  excerpts: BookNote[];
  handleOpenAnnotations: () => void;
  onDeleteExcerpt: (excerpt: BookNote) => void;
}

// inner component that uses the runtime hook
const AIAssistantChat = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  currentPage,
  engineName,
  backend,
  sourceStore,
  currentTurnId,
  setCurrentTurnId,
  onSourceClick,
  onResetIndex,
  notesContent,
  searchContent,
  chapterContent,
  bookContent,
  isLoading,
  isIndexed,
  isIndexing,
  indexProgress,
  indexError,
  onIndex,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
  engineName: string;
  backend: RetrievalBackend;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  setCurrentTurnId: (id: string) => void;
  onSourceClick?: (source: SourceItem) => void;
  onResetIndex: () => void;
  notesContent: ReactNode;
  searchContent: ReactNode;
  chapterContent: ReactNode;
  bookContent: ReactNode;
  isLoading: boolean;
  isIndexed: boolean;
  isIndexing: boolean;
  indexProgress: EmbeddingProgress | null;
  indexError: string | null;
  onIndex: () => void;
}) => {
  const {
    activeConversationId,
    messages: storedMessages,
    addMessage,
    isLoadingHistory,
  } = useAIChatStore();

  // use a ref to keep up-to-date options without triggering re-renders of the runtime
  const optionsRef = useRef({
    settings: aiSettings,
    bookHash,
    bookTitle,
    authorName,
    currentPage,
    backend,
    sourceStore,
    onTurnStart: setCurrentTurnId,
  });

  // update ref on every render with latest values
  useEffect(() => {
    optionsRef.current = {
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      currentPage,
      backend,
      sourceStore,
      onTurnStart: setCurrentTurnId,
    };
  });

  // create adapter ONCE and keep it stable
  const adapter = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- intentional: we read optionsRef inside a deferred callback, not during render
    return createTauriAdapter(() => optionsRef.current);
  }, []);

  // Create history adapter to load/persist messages
  const historyAdapter = useMemo<ThreadHistoryAdapter | undefined>(() => {
    if (!activeConversationId) return undefined;

    return {
      async load() {
        // storedMessages are already loaded by aiChatStore when conversation is selected
        return {
          messages: convertToExportedMessages(storedMessages),
        };
      },
      async append(item) {
        // item is ExportedMessageRepositoryItem - access the actual message via .message
        const msg = item.message;
        // Persist new messages to our store
        if (activeConversationId && msg.role !== 'system') {
          const textContent = msg.content
            .filter(
              (part): part is { type: 'text'; text: string } =>
                'type' in part && part.type === 'text',
            )
            .map((part) => part.text)
            .join('\n');

          if (textContent) {
            await addMessage({
              conversationId: activeConversationId,
              role: msg.role as 'user' | 'assistant',
              content: textContent,
            });
          }
        }
      },
    };
  }, [activeConversationId, storedMessages, addMessage]);

  return (
    <AIAssistantWithRuntime
      adapter={adapter}
      historyAdapter={historyAdapter}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={!!activeConversationId}
      sourceStore={sourceStore}
      currentTurnId={currentTurnId}
      onSourceClick={onSourceClick}
      engineName={engineName}
      notesContent={notesContent}
      searchContent={searchContent}
      chapterContent={chapterContent}
      bookContent={bookContent}
      isLoading={isLoading}
      isIndexed={isIndexed}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      onIndex={onIndex}
    />
  );
};

const AIAssistantWithRuntime = ({
  adapter,
  historyAdapter,
  onResetIndex,
  isLoadingHistory,
  hasActiveConversation,
  sourceStore,
  currentTurnId,
  onSourceClick,
  engineName,
  notesContent,
  searchContent,
  chapterContent,
  bookContent,
  isLoading,
  isIndexed,
  isIndexing,
  indexProgress,
  indexError,
  onIndex,
}: {
  adapter: NonNullable<ReturnType<typeof createTauriAdapter>>;
  historyAdapter?: ThreadHistoryAdapter;
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  onSourceClick?: (source: SourceItem) => void;
  engineName: string;
  notesContent: ReactNode;
  searchContent: ReactNode;
  chapterContent: ReactNode;
  bookContent: ReactNode;
  isLoading: boolean;
  isIndexed: boolean;
  isIndexing: boolean;
  indexProgress: EmbeddingProgress | null;
  indexError: string | null;
  onIndex: () => void;
}) => {
  const runtime = useLocalRuntime(adapter, {
    adapters: historyAdapter ? { history: historyAdapter } : undefined,
  });

  if (!runtime) return null;

  const canAnalyze = isIndexed && !isLoading && !isIndexing;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AIAnalysisPanel
        engineName={engineName}
        qaContent={
          canAnalyze ? (
            <ThreadWrapper
              onResetIndex={onResetIndex}
              isLoadingHistory={isLoadingHistory}
              hasActiveConversation={hasActiveConversation}
              sourceStore={sourceStore}
              currentTurnId={currentTurnId}
              onSourceClick={onSourceClick}
            />
          ) : (
            <AIAnalysisIndexState
              isLoading={isLoading}
              isIndexing={isIndexing}
              progress={indexProgress}
              errorMessage={indexError}
              onIndex={onIndex}
            />
          )
        }
        chapterContent={chapterContent}
        bookContent={bookContent}
        notesContent={notesContent}
        searchContent={searchContent}
      />
    </AssistantRuntimeProvider>
  );
};

const ThreadWrapper = ({
  onResetIndex,
  isLoadingHistory,
  hasActiveConversation,
  sourceStore,
  currentTurnId,
  onSourceClick,
}: {
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  onSourceClick?: (source: SourceItem) => void;
}) => {
  const [sources, setSources] = useState<RetrievedChunk[]>(
    currentTurnId ? sourceStore.get(currentTurnId) : [],
  );
  const assistantRuntime = useAssistantRuntime();
  const { setActiveConversation } = useAIChatStore();

  // Subscribe to the active turn's slot in the source store. Replaces the
  // pre-Reedy 500ms poll over a module-global lastSources (per plan §M1.7).
  useEffect(() => {
    if (!currentTurnId) {
      setSources([]);
      return;
    }
    setSources(sourceStore.get(currentTurnId));
    return sourceStore.subscribe(currentTurnId, setSources);
  }, [currentTurnId, sourceStore]);

  const handleClear = useCallback(() => {
    sourceStore.clear();
    setSources([]);
    setActiveConversation(null);
    assistantRuntime.switchToNewThread();
  }, [assistantRuntime, setActiveConversation, sourceStore]);

  return (
    <Thread
      sources={sources}
      onSourceClick={onSourceClick}
      onClear={handleClear}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={hasActiveConversation}
    />
  );
};

/**
 * Phase 4.3 router. Switches between the legacy / Reedy-MVP path
 * (LegacyAIAssistant) and the Phase 4 agent-runtime path
 * (ReedyAgentAssistantBridge) based on aiSettings.reedy.runtime.
 *
 * The split is at component boundary rather than inside one component
 * so hooks always run in stable order on whichever path is rendered.
 */
const AIAssistant = ({
  bookKey,
  excerpts,
  handleOpenAnnotations,
  onDeleteExcerpt,
}: AIAssistantProps) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const bookData = getBookData(bookKey);

  const reedyRuntime = settings?.aiSettings?.reedy?.runtime ?? 'mvp';
  const useAgentRuntime =
    settings?.aiSettings?.enabled === true &&
    settings?.aiSettings?.reedy?.enabled === true &&
    reedyRuntime === 'agent' &&
    !!appService &&
    isTauriAppPlatform() &&
    !!bookData?.bookDoc;

  const notebookProps = { bookKey, excerpts, handleOpenAnnotations, onDeleteExcerpt };
  if (useAgentRuntime) return <ReedyAgentAssistantBridge {...notebookProps} />;
  return <LegacyAIAssistant {...notebookProps} />;
};

const LegacyAIAssistant = ({
  bookKey,
  excerpts,
  handleOpenAnnotations,
  onDeleteExcerpt,
}: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings, setSettingsDialogBookKey, setSettingsDialogOpen, setRequestedPanel } =
    useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const bookData = getBookData(bookKey);
  // Reactive: chat context follows the user's current reading position.
  const progress = useBookProgress(bookKey);

  const [isLoading, setIsLoading] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexed, setIndexed] = useState(false);
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const chapterTitle = progress?.sectionLabel ?? null;
  const aiSettings = settings?.aiSettings;

  // Per-instance source store, plus the active backend chosen via the same
  // selectBackend gate the chat adapter will hit (Reedy on Tauri when
  // enabled; legacy IDB otherwise).
  const sourceStore = useMemo(() => new ReedySourceStore(), []);
  const backend = useMemo<RetrievalBackend | null>(() => {
    if (!aiSettings?.enabled) return null;
    const legacy = new LegacyIdbBackend(aiSettings);
    const reedy: RetrievalBackend | null =
      appService && isTauriAppPlatform()
        ? new ReedyBackend(appService as AppService, aiSettings)
        : null;
    return selectBackend({ settings: aiSettings, isTauri: isTauriAppPlatform(), legacy, reedy });
  }, [aiSettings, appService]);

  // check if book is indexed on mount
  useEffect(() => {
    if (bookHash && backend) {
      setIndexError(null);
      void backend
        .isIndexed(bookHash)
        .then((result) => setIndexed(result))
        .catch((error) => {
          aiLogger.rag.indexError(bookHash, (error as Error).message);
          setIndexed(false);
          setIndexError((error as Error).message);
        })
        .finally(() => setIsLoading(false));
    } else if (!backend) {
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, [bookHash, backend]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings || !backend) return;
    setIndexError(null);
    setIsIndexing(true);
    try {
      await backend.indexBook(bookData.bookDoc, bookHash, { onProgress: setIndexProgress });
      setIndexed(true);
    } catch (e) {
      aiLogger.rag.indexError(bookHash, (e as Error).message);
      setIndexed(false);
      setIndexError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [bookData?.bookDoc, bookHash, aiSettings, backend]);

  const handleResetIndex = useCallback(async () => {
    if (!appService || !backend) return;
    if (!(await appService.ask(_('Are you sure you want to re-index this book?')))) return;
    await backend.clearBook(bookHash);
    setIndexed(false);
    setIndexError(null);
  }, [bookHash, appService, backend, _]);

  // Navigate the reader to a clicked source's CFI. Legacy backend chunks have
  // no CFI so the Thread component renders them as static rows — only Reedy
  // sources are clickable in M1.10.
  const handleSourceClick = useCallback(
    (source: SourceItem) => {
      if (!source.cfi) return;
      getView(bookKey)?.goTo(source.cfi);
    },
    [bookKey, getView],
  );

  const handleSearchResultClick = useCallback(
    (cfi?: string, pageNumber?: number) => {
      if (cfi) {
        getView(bookKey)?.goTo(cfi);
      } else if (pageNumber !== undefined) {
        getView(bookKey)?.goTo(pageNumber);
      }
    },
    [bookKey, getView],
  );

  const handleAnalysisSourceClick = useCallback(
    (source: AIAnalysisSource) => {
      if (source.cfi) getView(bookKey)?.goTo(source.cfi);
    },
    [bookKey, getView],
  );

  const handleOpenAISettings = useCallback(() => {
    setSettingsDialogBookKey(bookKey);
    setRequestedPanel('AI');
    setSettingsDialogOpen(true);
  }, [bookKey, setRequestedPanel, setSettingsDialogBookKey, setSettingsDialogOpen]);

  const engineName = getRagEngineDisplayName((aiSettings ?? DEFAULT_AI_SETTINGS).ragEngine);
  const notesContent = (
    <NotebookEditor
      bookKey={bookKey}
      handleOpenAnnotations={handleOpenAnnotations}
      excerpts={excerpts}
      onDeleteExcerpt={onDeleteExcerpt}
    />
  );
  const searchContent = aiSettings?.enabled ? (
    <AIAnalysisSearch
      backend={backend}
      aiSettings={aiSettings}
      bookHash={bookHash}
      currentPage={currentPage}
      spoilerProtection={aiSettings.spoilerProtection}
      onResultClick={handleSearchResultClick}
      onIndex={handleIndex}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      indexedOverride={indexed}
    />
  ) : (
    <AIAnalysisSearch
      backend={null}
      aiSettings={aiSettings ?? DEFAULT_AI_SETTINGS}
      bookHash={bookHash}
      currentPage={currentPage}
      spoilerProtection={aiSettings?.spoilerProtection ?? true}
      onResultClick={handleSearchResultClick}
      indexedOverride={false}
    />
  );

  const sectionIndex = progress?.section?.current ?? 0;
  const chapterContent = (
    <AIAnalysisWorkspace
      kind='chapter'
      aiSettings={aiSettings}
      backend={backend}
      bookDoc={bookData?.bookDoc ?? null}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      sectionIndex={sectionIndex}
      chapterTitle={chapterTitle}
      currentPage={currentPage}
      isIndexed={indexed}
      isLoadingIndex={isLoading}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      onIndex={handleIndex}
      onOpenSettings={handleOpenAISettings}
      onSourceClick={handleAnalysisSourceClick}
    />
  );
  const bookContent = (
    <AIAnalysisWorkspace
      kind='book'
      aiSettings={aiSettings}
      backend={backend}
      bookDoc={bookData?.bookDoc ?? null}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      sectionIndex={sectionIndex}
      chapterTitle={chapterTitle}
      currentPage={currentPage}
      isIndexed={indexed}
      isLoadingIndex={isLoading}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      onIndex={handleIndex}
      onOpenSettings={handleOpenAISettings}
      onSourceClick={handleAnalysisSourceClick}
    />
  );

  if (!aiSettings?.enabled) {
    return (
      <AIAnalysisPanel
        engineName={engineName}
        qaContent={<AIAnalysisDisabledState onOpenSettings={handleOpenAISettings} />}
        chapterContent={chapterContent}
        bookContent={bookContent}
        notesContent={notesContent}
        searchContent={searchContent}
      />
    );
  }

  if (!backend) {
    return (
      <AIAnalysisPanel
        engineName={engineName}
        qaContent={
          <AIAnalysisIndexState
            isLoading={isLoading}
            isIndexing={isIndexing}
            progress={indexProgress}
            errorMessage={indexError}
            onIndex={() => void handleIndex()}
          />
        }
        chapterContent={chapterContent}
        bookContent={bookContent}
        notesContent={notesContent}
        searchContent={searchContent}
      />
    );
  }

  return (
    <AIAssistantChat
      aiSettings={aiSettings}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      currentPage={currentPage}
      engineName={engineName}
      backend={backend}
      sourceStore={sourceStore}
      currentTurnId={currentTurnId}
      setCurrentTurnId={setCurrentTurnId}
      onSourceClick={handleSourceClick}
      onResetIndex={handleResetIndex}
      notesContent={notesContent}
      searchContent={searchContent}
      chapterContent={chapterContent}
      bookContent={bookContent}
      isLoading={isLoading}
      isIndexed={indexed}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      onIndex={() => void handleIndex()}
    />
  );
};

/**
 * Bridge from the notebook AI tab into the Phase 4 ReedyAssistant.
 *
 * Kept separate from AIAssistant so legacy props/state don't leak in
 * and we don't pay the cost of constructing the agent runtime when the
 * user is on the MVP path. The flag check in AIAssistant guarantees this
 * only renders when aiSettings.reedy.runtime === 'agent'.
 */
const ReedyAgentAssistantBridge = ({
  bookKey,
  excerpts,
  handleOpenAnnotations,
  onDeleteExcerpt,
}: AIAssistantProps) => {
  const { appService } = useEnv();
  const { settings, setSettingsDialogBookKey, setSettingsDialogOpen, setRequestedPanel } =
    useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const bookData = getBookData(bookKey);
  // Reactive: agent runtime needs the latest reading position to seed
  // tool calls.
  const progress = useBookProgress(bookKey);

  const bookHash = bookKey.split('-')[0] || '';
  const aiSettings = settings?.aiSettings;
  const [indexed, setIndexed] = useState(false);
  const [isLoadingIndex, setIsLoadingIndex] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const indexActionRef = useRef<(() => Promise<void>) | null>(null);

  const searchBackend = useMemo<RetrievalBackend | null>(() => {
    if (!aiSettings || !appService || !isTauriAppPlatform()) return null;
    return new ReedyBackend(appService as AppService, aiSettings);
  }, [aiSettings, appService]);

  const readingContext = useMemo<ReadingContextSnapshot>(
    () => ({
      cfi: progress?.location ?? null,
      sectionIndex: progress?.section?.current ?? 0,
      chapterTitle: progress?.sectionLabel ?? null,
      pageNumber: progress?.pageinfo?.current ?? 0,
    }),
    [progress],
  );

  const handleNavigate = useCallback(
    (cfi: string) => {
      getView(bookKey)?.goTo(cfi);
    },
    [bookKey, getView],
  );

  const handleIndexStateChange = useCallback((state: ReedyIndexState) => {
    setIndexed(state.indexed);
    setIsLoadingIndex(state.isLoading);
    setIsIndexing(state.isIndexing);
    setIndexProgress(state.progress);
    setIndexError(state.error);
  }, []);

  const handleOpenAISettings = useCallback(() => {
    setSettingsDialogBookKey(bookKey);
    setRequestedPanel('AI');
    setSettingsDialogOpen(true);
  }, [bookKey, setRequestedPanel, setSettingsDialogBookKey, setSettingsDialogOpen]);

  const handleIndexActionChange = useCallback((action: (() => Promise<void>) | null) => {
    indexActionRef.current = action;
  }, []);

  const handleSearchIndex = useCallback(async () => {
    const action = indexActionRef.current;
    if (!action) throw new Error('Reedy indexing is not ready');
    await action();
  }, []);

  if (!aiSettings || !appService || !bookData?.bookDoc) return null;

  const chapterTitle = readingContext.chapterTitle;
  const engineName = getRagEngineDisplayName(aiSettings.ragEngine);
  const chapterContent = (
    <AIAnalysisWorkspace
      kind='chapter'
      aiSettings={aiSettings}
      backend={searchBackend}
      bookDoc={bookData.bookDoc}
      bookHash={bookHash}
      bookTitle={bookData.book?.title || 'Unknown'}
      authorName={bookData.book?.author || ''}
      sectionIndex={readingContext.sectionIndex}
      chapterTitle={chapterTitle}
      currentPage={readingContext.pageNumber}
      isIndexed={indexed}
      isLoadingIndex={isLoadingIndex}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      onIndex={handleSearchIndex}
      onOpenSettings={handleOpenAISettings}
      onSourceClick={(source) => {
        if (source.cfi) handleNavigate(source.cfi);
      }}
    />
  );
  const bookContent = (
    <AIAnalysisWorkspace
      kind='book'
      aiSettings={aiSettings}
      backend={searchBackend}
      bookDoc={bookData.bookDoc}
      bookHash={bookHash}
      bookTitle={bookData.book?.title || 'Unknown'}
      authorName={bookData.book?.author || ''}
      sectionIndex={readingContext.sectionIndex}
      chapterTitle={chapterTitle}
      currentPage={readingContext.pageNumber}
      isIndexed={indexed}
      isLoadingIndex={isLoadingIndex}
      isIndexing={isIndexing}
      indexProgress={indexProgress}
      indexError={indexError}
      onIndex={handleSearchIndex}
      onOpenSettings={handleOpenAISettings}
      onSourceClick={(source) => {
        if (source.cfi) handleNavigate(source.cfi);
      }}
    />
  );

  return (
    <AIAnalysisPanel
      engineName={engineName}
      qaContent={
        <ReedyAssistant
          appService={appService as AppService}
          bookDoc={bookData.bookDoc}
          bookHash={bookHash}
          bookKey={bookKey}
          aiSettings={aiSettings}
          readingContext={readingContext}
          onNavigateToCfi={handleNavigate}
          onIndexStateChange={handleIndexStateChange}
          onIndexActionChange={handleIndexActionChange}
        />
      }
      chapterContent={chapterContent}
      bookContent={bookContent}
      notesContent={
        <NotebookEditor
          bookKey={bookKey}
          handleOpenAnnotations={handleOpenAnnotations}
          excerpts={excerpts}
          onDeleteExcerpt={onDeleteExcerpt}
        />
      }
      searchContent={
        <AIAnalysisSearch
          backend={searchBackend}
          aiSettings={aiSettings}
          bookHash={bookHash}
          currentPage={readingContext.pageNumber}
          spoilerProtection={aiSettings.spoilerProtection}
          onIndex={handleSearchIndex}
          indexedOverride={indexed}
          onResultClick={(cfi) => {
            if (cfi) handleNavigate(cfi);
          }}
        />
      }
    />
  );
};

export default AIAssistant;
