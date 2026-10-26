import { create } from 'zustand';

import {
  generateAnalysis,
  getAnalysisChatModelName,
  getAnalysisReportId,
  type AnalysisRunContext,
} from '@/services/ai/analysisService';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { AIAnalysisReport } from '@/services/ai/types';

interface AIAnalysisState {
  reports: Record<string, AIAnalysisReport>;
  loadedBooks: Record<string, boolean>;
  loadingBooks: Record<string, boolean>;
  loadReports: (bookHash: string) => Promise<void>;
  startAnalysis: (context: Omit<AnalysisRunContext, 'signal'>) => string;
  cancelAnalysis: (reportId: string) => void;
  deleteReport: (reportId: string) => Promise<void>;
}

// Scheduler state deliberately lives outside React. Closing the right-side
// panel must not cancel an analysis, and two books may analyze in parallel.
const bookQueueTails = new Map<string, Promise<void>>();
const taskControllers = new Map<string, AbortController>();
const activeRunTokens = new Map<string, number>();
let nextRunToken = 0;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function persistReport(report: AIAnalysisReport): Promise<void> {
  try {
    await aiStore.saveAnalysisReport(report);
  } catch {
    // The in-memory run remains usable even if persistence is temporarily
    // unavailable (for example while IndexedDB is recovering).
  }
}

export const useAIAnalysisStore = create<AIAnalysisState>((set, get) => ({
  reports: {},
  loadedBooks: {},
  loadingBooks: {},

  loadReports: async (bookHash) => {
    if (get().loadedBooks[bookHash] || get().loadingBooks[bookHash]) return;
    set((state) => ({ loadingBooks: { ...state.loadingBooks, [bookHash]: true } }));
    try {
      const stored = await aiStore.getAnalysisReports(bookHash);
      const current = get().reports;
      const reports = { ...current };
      for (const storedReport of stored) {
        const existing = current[storedReport.id];
        if (existing && (existing.status === 'queued' || existing.status === 'running')) continue;
        if (storedReport.status === 'queued' || storedReport.status === 'running') {
          const interrupted: AIAnalysisReport = {
            ...storedReport,
            status: 'cancelled',
            error: 'Analysis was interrupted before it finished. You can retry it.',
            updatedAt: Date.now(),
          };
          reports[storedReport.id] = interrupted;
          void persistReport(interrupted);
        } else {
          reports[storedReport.id] = storedReport;
        }
      }
      set((state) => ({
        reports,
        loadedBooks: { ...state.loadedBooks, [bookHash]: true },
        loadingBooks: { ...state.loadingBooks, [bookHash]: false },
      }));
    } catch {
      set((state) => ({
        loadedBooks: { ...state.loadedBooks, [bookHash]: true },
        loadingBooks: { ...state.loadingBooks, [bookHash]: false },
      }));
    }
  },

  startAnalysis: (context) => {
    const reportId = getAnalysisReportId(
      context.bookHash,
      context.kind,
      context.kind === 'chapter' ? context.sectionIndex : undefined,
    );
    const existing = get().reports[reportId];
    if (existing?.status === 'queued' || existing?.status === 'running') return reportId;

    const now = Date.now();
    const report: AIAnalysisReport = {
      id: reportId,
      bookHash: context.bookHash,
      bookTitle: context.bookTitle,
      kind: context.kind,
      sectionIndex: context.kind === 'chapter' ? context.sectionIndex : undefined,
      chapterTitle: context.kind === 'chapter' ? (context.chapterTitle ?? undefined) : undefined,
      content: '',
      model: getAnalysisChatModelName(context.settings),
      status: 'queued',
      sources: [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const controller = new AbortController();
    const runToken = ++nextRunToken;
    taskControllers.set(reportId, controller);
    activeRunTokens.set(reportId, runToken);
    set((state) => ({ reports: { ...state.reports, [reportId]: report } }));
    void persistReport(report);

    const previous = bookQueueTails.get(context.bookHash) ?? Promise.resolve();
    const tail = previous
      .catch(() => undefined)
      .then(async () => {
        if (controller.signal.aborted || activeRunTokens.get(reportId) !== runToken) return;

        const running: AIAnalysisReport = {
          ...(get().reports[reportId] ?? report),
          status: 'running',
          error: undefined,
          updatedAt: Date.now(),
        };
        set((state) => ({ reports: { ...state.reports, [reportId]: running } }));
        await persistReport(running);

        try {
          const result = await generateAnalysis({ ...context, signal: controller.signal });
          if (controller.signal.aborted || activeRunTokens.get(reportId) !== runToken) return;
          const complete: AIAnalysisReport = {
            ...running,
            content: result.content,
            model: result.model,
            sources: result.sources,
            coverage: result.coverage,
            status: 'complete',
            error: undefined,
            updatedAt: Date.now(),
          };
          set((state) => ({ reports: { ...state.reports, [reportId]: complete } }));
          await persistReport(complete);
        } catch (error) {
          if (activeRunTokens.get(reportId) !== runToken) return;
          const cancelled = controller.signal.aborted || (error as Error)?.name === 'AbortError';
          const failed: AIAnalysisReport = {
            ...(get().reports[reportId] ?? running),
            status: cancelled ? 'cancelled' : 'error',
            error: cancelled ? 'Analysis was cancelled. You can retry it.' : errorMessage(error),
            updatedAt: Date.now(),
          };
          set((state) => ({ reports: { ...state.reports, [reportId]: failed } }));
          await persistReport(failed);
        } finally {
          if (taskControllers.get(reportId) === controller) taskControllers.delete(reportId);
        }
      });

    bookQueueTails.set(context.bookHash, tail);
    void tail.finally(() => {
      if (bookQueueTails.get(context.bookHash) === tail) {
        bookQueueTails.delete(context.bookHash);
      }
      if (activeRunTokens.get(reportId) === runToken) activeRunTokens.delete(reportId);
    });

    return reportId;
  },

  cancelAnalysis: (reportId) => {
    const controller = taskControllers.get(reportId);
    controller?.abort();
    taskControllers.delete(reportId);
    activeRunTokens.delete(reportId);
    const report = get().reports[reportId];
    if (!report || (report.status !== 'queued' && report.status !== 'running')) return;
    const cancelled: AIAnalysisReport = {
      ...report,
      status: 'cancelled',
      error: 'Analysis was cancelled. You can retry it.',
      updatedAt: Date.now(),
    };
    set((state) => ({ reports: { ...state.reports, [reportId]: cancelled } }));
    void persistReport(cancelled);
  },

  deleteReport: async (reportId) => {
    taskControllers.get(reportId)?.abort();
    taskControllers.delete(reportId);
    activeRunTokens.delete(reportId);
    set((state) => {
      const reports = { ...state.reports };
      delete reports[reportId];
      return { reports };
    });
    await aiStore.deleteAnalysisReport(reportId);
  },
}));
