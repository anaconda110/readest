import { create } from 'zustand';

import { aggregateKnowledge } from '@/services/ai/knowledge/aggregate';
import { extractChapterKnowledge, readSectionText } from '@/services/ai/knowledge/extract';
import type {
  BookKnowledge,
  ChapterKnowledge,
  KnowledgeAnalyzeContext,
  KnowledgeRunState,
} from '@/services/ai/knowledge/types';
import { aiStore } from '@/services/ai/storage/aiStore';

interface KnowledgeState {
  knowledge: Record<string, BookKnowledge | undefined>;
  chapters: Record<string, Record<number, ChapterKnowledge>>;
  loadedBooks: Record<string, boolean>;
  loadingBooks: Record<string, boolean>;
  runs: Record<string, KnowledgeRunState>;
  loadBook: (bookHash: string, bookTitle: string) => Promise<void>;
  analyze: (context: KnowledgeAnalyzeContext) => void;
  cancel: (bookHash: string) => void;
  deleteChapter: (bookHash: string, bookTitle: string, chapterIndex: number) => Promise<void>;
  clearBook: (bookHash: string) => Promise<void>;
}

const controllers = new Map<string, AbortController>();
const runTokens = new Map<string, number>();
let nextRunToken = 0;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toChapterMap(chapters: ChapterKnowledge[]): Record<number, ChapterKnowledge> {
  const map: Record<number, ChapterKnowledge> = {};
  for (const chapter of chapters) map[chapter.chapterIndex] = chapter;
  return map;
}

function sectionTitle(context: KnowledgeAnalyzeContext, chapterIndex: number): string {
  const visit = (items = context.bookDoc.toc ?? []): string | null => {
    for (const item of items) {
      if (item.id === chapterIndex) return item.label;
      if (item.subitems?.length) {
        const nested = visit(item.subitems);
        if (nested) return nested;
      }
    }
    return null;
  };
  return visit() ?? context.bookDoc.sections[chapterIndex]?.id ?? `Section ${chapterIndex + 1}`;
}

const idleRun = (total = 0): KnowledgeRunState => ({ status: 'idle', total, completed: 0 });

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  knowledge: {},
  chapters: {},
  loadedBooks: {},
  loadingBooks: {},
  runs: {},

  loadBook: async (bookHash, bookTitle) => {
    if (get().loadedBooks[bookHash] || get().loadingBooks[bookHash]) return;
    set((state) => ({ loadingBooks: { ...state.loadingBooks, [bookHash]: true } }));
    try {
      const stored = await aiStore.getChapterKnowledge(bookHash);
      const chapterMap = toChapterMap(stored);
      set((state) => ({
        chapters: { ...state.chapters, [bookHash]: chapterMap },
        knowledge: {
          ...state.knowledge,
          [bookHash]: aggregateKnowledge(Object.values(chapterMap), bookTitle, bookHash),
        },
        loadedBooks: { ...state.loadedBooks, [bookHash]: true },
        loadingBooks: { ...state.loadingBooks, [bookHash]: false },
        runs: {
          ...state.runs,
          [bookHash]: {
            status: stored.length > 0 ? 'complete' : 'idle',
            total: stored.length,
            completed: stored.length,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        loadedBooks: { ...state.loadedBooks, [bookHash]: true },
        loadingBooks: { ...state.loadingBooks, [bookHash]: false },
        runs: {
          ...state.runs,
          [bookHash]: {
            status: 'error',
            total: 0,
            completed: 0,
            error: errorMessage(error),
          },
        },
      }));
    }
  },

  analyze: (context) => {
    const { bookHash, bookTitle } = context;
    controllers.get(bookHash)?.abort();
    const controller = new AbortController();
    const runToken = ++nextRunToken;
    controllers.set(bookHash, controller);
    runTokens.set(bookHash, runToken);

    const total = context.chapterIndices.length;
    set((state) => ({
      runs: {
        ...state.runs,
        [bookHash]: { status: 'running', total, completed: 0 },
      },
    }));

    void (async () => {
      let completed = 0;
      try {
        for (const chapterIndex of context.chapterIndices) {
          if (controller.signal.aborted || runTokens.get(bookHash) !== runToken) return;
          set((state) => ({
            runs: {
              ...state.runs,
              [bookHash]: {
                status: 'running',
                total,
                completed,
                currentChapter: chapterIndex,
              },
            },
          }));

          const text = await readSectionText(context.bookDoc, chapterIndex);
          const chapterTitle = sectionTitle(context, chapterIndex);
          const cfi = context.bookDoc.sections[chapterIndex]?.cfi;
          const knowledge = text.trim()
            ? await extractChapterKnowledge({
                settings: context.settings,
                bookHash,
                bookTitle,
                authorName: context.authorName,
                chapterIndex,
                chapterTitle,
                cfi,
                text,
                language: context.language,
                signal: controller.signal,
              })
            : {
                bookHash,
                chapterIndex,
                chapterTitle,
                cfi,
                model: 'no extractable text',
                truncated: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                people: [],
                locations: [],
                items: [],
                orgs: [],
                concepts: [],
                relations: [],
                events: [],
              };
          if (controller.signal.aborted || runTokens.get(bookHash) !== runToken) return;

          await aiStore.saveChapterKnowledge(knowledge);
          completed += 1;

          const chapterMap = {
            ...(get().chapters[bookHash] ?? {}),
            [chapterIndex]: knowledge,
          };
          set((state) => ({
            chapters: { ...state.chapters, [bookHash]: chapterMap },
            knowledge: {
              ...state.knowledge,
              [bookHash]: aggregateKnowledge(Object.values(chapterMap), bookTitle, bookHash),
            },
            runs: {
              ...state.runs,
              [bookHash]: {
                status: 'running',
                total,
                completed,
                currentChapter: chapterIndex,
              },
            },
          }));
        }

        if (runTokens.get(bookHash) !== runToken) return;
        set((state) => ({
          runs: {
            ...state.runs,
            [bookHash]: { status: 'complete', total, completed },
          },
        }));
      } catch (error) {
        if (runTokens.get(bookHash) !== runToken) return;
        const cancelled =
          controller.signal.aborted || (error as Error | undefined)?.name === 'AbortError';
        set((state) => ({
          runs: {
            ...state.runs,
            [bookHash]: {
              status: cancelled ? 'cancelled' : 'error',
              total,
              completed,
              error: cancelled ? undefined : errorMessage(error),
            },
          },
        }));
      } finally {
        if (controllers.get(bookHash) === controller) controllers.delete(bookHash);
      }
    })();
  },

  cancel: (bookHash) => {
    controllers.get(bookHash)?.abort();
    controllers.delete(bookHash);
    runTokens.delete(bookHash);
    set((state) => {
      const current = state.runs[bookHash] ?? idleRun();
      return {
        runs: {
          ...state.runs,
          [bookHash]: { ...current, status: 'cancelled' },
        },
      };
    });
  },

  deleteChapter: async (bookHash, bookTitle, chapterIndex) => {
    await aiStore.deleteChapterKnowledge(bookHash, chapterIndex);
    const current = { ...(get().chapters[bookHash] ?? {}) };
    delete current[chapterIndex];
    set((state) => ({
      chapters: { ...state.chapters, [bookHash]: current },
      knowledge: {
        ...state.knowledge,
        [bookHash]: aggregateKnowledge(Object.values(current), bookTitle, bookHash),
      },
    }));
  },

  clearBook: async (bookHash) => {
    controllers.get(bookHash)?.abort();
    controllers.delete(bookHash);
    runTokens.delete(bookHash);
    await aiStore.clearChapterKnowledge(bookHash);
    set((state) => ({
      chapters: { ...state.chapters, [bookHash]: {} },
      knowledge: { ...state.knowledge, [bookHash]: undefined },
      runs: { ...state.runs, [bookHash]: idleRun() },
    }));
  },
}));
