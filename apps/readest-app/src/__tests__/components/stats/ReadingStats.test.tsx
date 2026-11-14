import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReadingHeatmap from '@/components/stats/ReadingHeatmap';
import ReadingTimeChart from '@/components/stats/ReadingTimeChart';

const env = vi.hoisted(() => ({ appService: {}, envConfig: {} }));
const db = vi.hoisted(() => ({
  open: vi.fn(),
  getReadingPeriodStats: vi.fn(),
  getReadingTotalsAndDaily: vi.fn(),
  getBookQuarterHourDurations: vi.fn(),
  deleteBookRange: vi.fn(),
  undoDelete: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => env }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, p?: Record<string, unknown>) =>
    p ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k] ?? '')) : s,
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'de-DE',
}));
vi.mock('@/services/statistics/statisticsDb', () => ({ StatisticsDb: db }));
const sync = vi.hoisted(() => ({ user: null as object | null, pullStats: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: sync.user }) }));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => true }));
vi.mock('@/services/statistics/statsSync', () => ({ pullStats: sync.pullStats }));
vi.mock('@/libs/sync', () => ({ SyncClient: class {} }));

beforeEach(() => {
  vi.resetAllMocks();
  sync.user = null;
  db.open.mockResolvedValue(db);
  db.getReadingPeriodStats.mockResolvedValue({
    summary: { seconds: 0, days: 0, books: 0, pages: 0 },
    rankings: [],
    breakdown: [],
    daily: [],
  });
  db.getReadingTotalsAndDaily.mockResolvedValue({
    daily: [],
    totals: { seconds: 0, books: 0, pages: 0 },
  });
  db.getBookQuarterHourDurations.mockResolvedValue([]);
  db.deleteBookRange.mockResolvedValue({
    bookMd5: 'book-a',
    originalEvents: [],
    replacementEvents: [],
  });
  db.undoDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReadingHeatmap keyboard access', () => {
  it('moves the selected day with arrow keys and announces it', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(<ReadingHeatmap daily={new Map([['2026-10-22', 1800]])} />);
    const grid = screen.getByRole('group', { name: 'Reading activity' });
    const status = screen.getByRole('status');

    fireEvent.focus(grid);
    expect(status.textContent).toContain('21');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(status.textContent).toContain('22');
    expect(status.textContent).toContain('30m');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(status.textContent).toContain('15');
  });
});

describe('ReadingTimeChart keyboard access', () => {
  it('is one tab stop whose arrow keys step through the bars', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(<ReadingTimeChart daily={new Map([['2026-10-20', 1800]])} range='week' />);
    const chart = screen.getByRole('group', { name: 'Reading Time' });
    expect(chart.querySelectorAll('button')).toHaveLength(0);
    const status = screen.getByRole('status');

    fireEvent.focus(chart);
    expect(status.textContent).toContain('21');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(status.textContent).toContain('20');
    expect(screen.getByText('30m')).toBeTruthy();
  });
});

describe('pointer behavior', () => {
  it('leaves the headline and footer alone on hover, and selects on click', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    const daily = new Map([['2026-10-20', 1800]]);
    const { container } = render(
      <>
        <ReadingTimeChart daily={daily} range='week' />
        <ReadingHeatmap daily={daily} />
      </>,
    );
    const [chartStatus, heatmapStatus] = screen.getAllByRole('status');
    const chartBefore = chartStatus!.textContent;
    const heatmapBefore = heatmapStatus!.textContent;
    const bar = container.querySelector('[data-index="1"]')!;
    const day = container.querySelector('[data-date="2026-10-20"]')!;

    fireEvent.mouseOver(bar);
    fireEvent.mouseOver(day);
    expect(chartStatus!.textContent).toBe(chartBefore);
    expect(heatmapStatus!.textContent).toBe(heatmapBefore);

    fireEvent.pointerDown(bar);
    fireEvent.click(bar);
    expect(chartStatus!.textContent).toContain('20');
    fireEvent.click(bar);
    expect(chartStatus!.textContent).toBe(chartBefore);

    fireEvent.click(day);
    expect(heatmapStatus!.textContent).toContain('20');
    expect(heatmapStatus!.textContent).toContain('30m');
  });
});

describe('arrow keys inside a Dialog', () => {
  // Dialog stops every keydown at its own node, before React's root listener.
  const InDialog = ({ children }: { children: React.ReactNode }) => (
    <div ref={(el) => el?.addEventListener('keydown', (e) => e.stopPropagation())}>{children}</div>
  );

  it('still steps the chart and the heatmap', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(
      <InDialog>
        <ReadingTimeChart daily={new Map()} range='week' />
        <ReadingHeatmap daily={new Map()} />
      </InDialog>,
    );
    const [chartStatus, heatmapStatus] = screen.getAllByRole('status');
    const chart = screen.getByRole('group', { name: 'Reading Time' });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(chartStatus!.textContent).toContain('20');

    const heatmap = screen.getByRole('group', { name: 'Reading activity' });
    fireEvent.focus(heatmap);
    fireEvent.keyDown(heatmap, { key: 'ArrowDown' });
    expect(heatmapStatus!.textContent).toContain('22');
  });
});

describe('ReadingStatsDialog', () => {
  const openDialog = async () => {
    const { default: ReadingStatsDialog, setReadingStatsDialogVisible } = await import(
      '@/components/stats/ReadingStatsDialog'
    );
    render(<ReadingStatsDialog />);
    await act(async () => setReadingStatsDialogVisible(true));
  };

  it('formats all-time counts with the app locale', async () => {
    db.getReadingTotalsAndDaily.mockResolvedValue({
      daily: [],
      totals: { seconds: 0, books: 1234, pages: 56789 },
    });
    await openDialog();
    expect(await screen.findByText('56.789')).toBeTruthy();
    expect(screen.getByText('1.234')).toBeTruthy();
  });

  it("pulls the account's stats from other devices, then shows them", async () => {
    sync.user = { id: 'u' };
    let pulled = false;
    sync.pullStats.mockImplementation(async () => {
      pulled = true;
    });
    db.getReadingTotalsAndDaily
      .mockResolvedValueOnce({ daily: [], totals: { seconds: 0, books: 3, pages: 0 } })
      .mockImplementation(async () => ({
        daily: [],
        totals: { seconds: 0, books: pulled ? 40 : 3, pages: 0 },
      }));
    await openDialog();
    expect(sync.pullStats).toHaveBeenCalled();
    await waitFor(() => expect(db.getReadingTotalsAndDaily).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    expect(await screen.findByText('40', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('says so when the statistics fail to load', async () => {
    db.open.mockRejectedValue(new Error('locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openDialog();
    expect(await screen.findByText('Failed to load reading statistics')).toBeTruthy();
  });

  it('loads the current natural week and can navigate to the previous week', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    await openDialog();

    const thisWeekStart = new Date(2026, 9, 19).getTime() / 1000;
    const nextWeekStart = new Date(2026, 9, 26).getTime() / 1000;
    expect(db.getReadingPeriodStats).toHaveBeenCalledWith(thisWeekStart, nextWeekStart);

    fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
    await waitFor(() =>
      expect(db.getReadingPeriodStats).toHaveBeenCalledWith(
        new Date(2026, 9, 12).getTime() / 1000,
        thisWeekStart,
      ),
    );
  });

  it('keeps all-time data cached while navigating between periods', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    await openDialog();
    expect(await screen.findByText('No reading activity in this period')).toBeTruthy();
    expect(db.getReadingTotalsAndDaily).toHaveBeenCalledTimes(1);
    expect(db.getReadingPeriodStats).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
    await waitFor(() => expect(db.getReadingPeriodStats).toHaveBeenCalledTimes(2));
    expect(db.getReadingTotalsAndDaily).toHaveBeenCalledTimes(1);
  });

  it('does not show the previous period data while the new period loads', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    let resolvePeriod!: (period: {
      summary: { seconds: number; days: number; books: number; pages: number };
      rankings: [];
      breakdown: [];
      daily: [];
    }) => void;
    const pendingPeriod = new Promise<{
      summary: { seconds: number; days: number; books: number; pages: number };
      rankings: [];
      breakdown: [];
      daily: [];
    }>((resolve) => (resolvePeriod = resolve));
    db.getReadingPeriodStats
      .mockResolvedValueOnce({
        summary: { seconds: 3600, days: 1, books: 1, pages: 1 },
        rankings: [],
        breakdown: [],
        daily: [],
      })
      .mockImplementationOnce(() => pendingPeriod);

    await openDialog();
    expect((await screen.findAllByText('1h')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(db.getReadingPeriodStats).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('1h')).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous Period' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Loading...');

    await act(async () => {
      resolvePeriod({
        summary: { seconds: 0, days: 0, books: 0, pages: 0 },
        rankings: [],
        breakdown: [],
        daily: [],
      });
      await pendingPeriod;
    });
  });

  it('ignores a late response for a period that is no longer selected', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    let resolvePrevious!: (period: {
      summary: { seconds: number; days: number; books: number; pages: number };
      rankings: [];
      breakdown: [];
      daily: [];
    }) => void;
    const previousPeriod = new Promise<{
      summary: { seconds: number; days: number; books: number; pages: number };
      rankings: [];
      breakdown: [];
      daily: [];
    }>((resolve) => (resolvePrevious = resolve));
    db.getReadingPeriodStats
      .mockResolvedValueOnce({
        summary: { seconds: 0, days: 0, books: 0, pages: 0 },
        rankings: [],
        breakdown: [],
        daily: [],
      })
      .mockImplementationOnce(() => previousPeriod)
      .mockResolvedValueOnce({
        summary: { seconds: 1800, days: 1, books: 1, pages: 1 },
        rankings: [],
        breakdown: [],
        daily: [],
      });

    await openDialog();
    expect(await screen.findByText('No reading activity in this period')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Previous Period' }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next Period' }));
    expect((await screen.findAllByText('30m')).length).toBeGreaterThan(0);

    await act(async () => {
      resolvePrevious({
        summary: { seconds: 7200, days: 1, books: 1, pages: 1 },
        rankings: [],
        breakdown: [],
        daily: [],
      });
      await previousPeriod;
    });
    expect(screen.queryByText('2h')).toBeNull();
    expect(screen.getAllByText('30m').length).toBeGreaterThan(0);
  });

  it('shows the period summary, book ranking, and daily book breakdown', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    db.getReadingPeriodStats.mockResolvedValue({
      summary: { seconds: 5400, days: 2, books: 2, pages: 25 },
      rankings: [
        {
          bookMd5: 'book-a',
          title: 'Book A',
          authors: 'Author A',
          seconds: 3600,
        },
      ],
      breakdown: [
        {
          date: '2026-10-20',
          bookMd5: 'book-a',
          title: 'Book A',
          authors: 'Author A',
          seconds: 3600,
          pages: 20,
        },
      ],
      daily: [{ date: '2026-10-20', seconds: 3600 }],
    });
    await openDialog();

    expect(await screen.findByText('Period Summary')).toBeTruthy();
    expect(screen.getByText('Book Ranking')).toBeTruthy();
    expect(screen.getByText('Daily Details')).toBeTruthy();
    expect(screen.getAllByText('1h').length).toBeGreaterThan(0);
    expect(screen.getByText('20 pages')).toBeTruthy();
  });

  it('shows an explicit empty state for a period without reading', async () => {
    await openDialog();
    expect(await screen.findByText('No reading activity in this period')).toBeTruthy();
  });

  it('deletes a daily book entry and can undo the local deletion', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    const deleted = {
      bookMd5: 'book-a',
      originalEvents: [],
      replacementEvents: [],
    };
    db.getReadingPeriodStats
      .mockResolvedValueOnce({
        summary: { seconds: 3600, days: 1, books: 1, pages: 20 },
        rankings: [],
        breakdown: [
          {
            date: '2026-10-20',
            bookMd5: 'book-a',
            title: 'Book A',
            authors: 'Author A',
            seconds: 3600,
            pages: 20,
          },
        ],
        daily: [{ date: '2026-10-20', seconds: 3600 }],
      })
      .mockResolvedValue({
        summary: { seconds: 0, days: 0, books: 0, pages: 0 },
        rankings: [],
        breakdown: [],
        daily: [],
      });
    db.deleteBookRange.mockResolvedValue(deleted);
    await openDialog();

    fireEvent.click(await screen.findByRole('button', { name: /Delete Book A/ }));
    expect(db.deleteBookRange).toHaveBeenCalledWith(
      'book-a',
      new Date(2026, 9, 20).getTime() / 1000,
      new Date(2026, 9, 21).getTime() / 1000,
    );
    expect(
      await screen.findByText('Deleted locally. A later sync may restore this data.'),
    ).toBeTruthy();
    await waitFor(() => expect(db.getReadingTotalsAndDaily).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(db.undoDelete).toHaveBeenCalledWith(deleted);
    expect(await screen.findByText('Deletion undone')).toBeTruthy();
    await waitFor(() => expect(db.getReadingTotalsAndDaily).toHaveBeenCalledTimes(3));
  });

  it('opens the calendar from a compact entry below the heatmap and returns to statistics', async () => {
    const calendarQuery = vi.fn(async () => []);
    db.getBookQuarterHourDurations.mockImplementation(calendarQuery);
    await openDialog();
    await screen.findByText('All Time');
    expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
    const entry = screen.getByRole('button', { name: 'Reading Calendar' });
    const heatmap = screen.getByRole('group', { name: 'Reading activity' });
    expect(heatmap.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calendarQuery).not.toHaveBeenCalled();

    fireEvent.click(entry);
    expect(await screen.findByRole('group', { name: 'Reading Calendar' })).toBeTruthy();
    expect(screen.queryByText('All Time')).toBeNull();
    expect(calendarQuery).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reading Statistics' }));
    expect(await screen.findByText('All Time')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reading Calendar' }));
  });

  it('goes back to statistics, not out of the dialog, when closed from the calendar', async () => {
    await openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Reading Calendar' }));
    await screen.findByRole('group', { name: 'Reading Calendar' });

    // Escape, the Android back key and the mobile header arrow all call Dialog's onClose.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('All Time')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reading Calendar' }));

    // The mobile header arrow is named for what it does on each page.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reading Calendar' }));
    await screen.findByRole('group', { name: 'Reading Calendar' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('All Time')).toBeTruthy();

    const dialog = document.getElementById('reading_stats_window')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
