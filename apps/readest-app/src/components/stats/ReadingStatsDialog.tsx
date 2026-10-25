import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { MdChevronLeft, MdChevronRight, MdDeleteOutline, MdUndo } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import SegmentedControl from '@/components/SegmentedControl';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  StatisticsDb,
  type BookReadingRanking,
  type DailyBookBreakdown,
  type DeletedBookRange,
  type ReadingSummary,
} from '@/services/statistics/statisticsDb';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import {
  getPeriodBounds,
  getStreaks,
  toDateKey,
  type ReadingRange,
} from '@/services/statistics/readingStats';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import ReadingTimeChart from './ReadingTimeChart';
import ReadingHeatmap from './ReadingHeatmap';

export const setReadingStatsDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('reading_stats_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

interface ReadingStats {
  periodStart: number;
  periodEnd: number;
  daily: Map<string, number>;
  totals: { seconds: number; books: number; pages: number };
  summary: ReadingSummary;
  rankings: BookReadingRanking[];
  breakdown: DailyBookBreakdown[];
  periodDaily: Map<string, number>;
}

interface UndoState {
  deleted: DeletedBookRange;
  title: string;
}

const toDailyMap = (rows: { date: string; seconds: number }[]) =>
  new Map(rows.map(({ date, seconds }) => [date, seconds]));

const shiftPeriod = (range: ReadingRange, date: Date, delta: number) => {
  if (range === 'week')
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta * 7);
  if (range === 'month') return new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return new Date(date.getFullYear() + delta, 0, 1);
};

const titleOf = (book: Pick<BookReadingRanking, 'title' | 'bookMd5'>) => book.title || book.bookMd5;

const ReadingStatsContent: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const [range, setRange] = useState<ReadingRange>('week');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [actionNotice, setActionNotice] = useState<'deleted' | 'undone' | 'error' | null>(null);
  const dbRef = useRef<StatisticsDb | null>(null);
  const pulledRef = useRef(false);

  const bounds = getPeriodBounds(range, anchorDate);
  const periodStart = bounds.start.getTime() / 1000;
  const periodEnd = bounds.end.getTime() / 1000;
  const locale = getLocale();
  const endInclusive = new Date(bounds.end);
  endInclusive.setDate(endInclusive.getDate() - 1);
  const periodLabel =
    range === 'year'
      ? String(bounds.start.getFullYear())
      : range === 'month'
        ? bounds.start.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
        : `${bounds.start.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          })} – ${endInclusive.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}`;
  const currentPeriodStart = getPeriodBounds(range, new Date()).start.getTime();
  const canGoNext = bounds.start.getTime() < currentPeriodStart;

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    setFailed(false);

    const load = async (db: StatisticsDb, start: number, end: number): Promise<ReadingStats> => {
      const allTimeEnd = Math.floor(Date.now() / 1000) + 86400;
      const [dailyRows, totals, periodRows, summary, rankings, breakdown] = await Promise.all([
        db.getDailyReadingSeconds(0, allTimeEnd),
        db.getReadingTotals(),
        db.getDailyReadingSeconds(start, end),
        db.getReadingSummary(start, end),
        db.getBookReadingRankings(start, end),
        db.getDailyBookBreakdown(start, end),
      ]);
      return {
        periodStart: start,
        periodEnd: end,
        daily: toDailyMap(dailyRows),
        totals,
        summary,
        rankings,
        breakdown,
        periodDaily: toDailyMap(periodRows),
      };
    };

    StatisticsDb.open(appService)
      .then(async (db) => {
        dbRef.current = db;
        const localStats = await load(db, periodStart, periodEnd);
        if (!cancelled) setStats(localStats);

        // Only an open book pulls stats, so from the library this device may
        // not have the account's other devices yet: show what's here, then pull.
        if (user && isSyncCategoryEnabled('stats') && !pulledRef.current) {
          // Loaded here so the menus that import this dialog don't pull the
          // sync client (and its API base URL) into their module graph.
          const [{ SyncClient }, { pullStats }] = await Promise.all([
            import('@/libs/sync'),
            import('@/services/statistics/statsSync'),
          ]);
          await pullStats(db, new SyncClient()).catch((err) =>
            console.warn('Failed to pull reading stats:', err),
          );
          pulledRef.current = true;
          const pulledStats = await load(db, periodStart, periodEnd);
          if (!cancelled) setStats(pulledStats);
        }
      })
      .catch((err) => {
        console.error('Failed to load reading stats:', err);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [appService, user, periodStart, periodEnd, reloadToken]);

  useEffect(() => {
    if (!user) pulledRef.current = false;
  }, [user]);

  const changeRange = (nextRange: ReadingRange) => {
    setRange(nextRange);
    setAnchorDate(new Date());
  };

  const changePeriod = (delta: number) => {
    setAnchorDate((date) => shiftPeriod(range, date, delta));
  };

  const periodHeader = (
    <div className='flex flex-col gap-3'>
      <SegmentedControl<ReadingRange>
        fullWidth
        ariaLabel={_('Time Range')}
        options={[
          { value: 'week', label: _('Week') },
          { value: 'month', label: _('Month') },
          { value: 'year', label: _('Year') },
        ]}
        value={range}
        onChange={changeRange}
      />
      <div className='flex items-center justify-between gap-2'>
        <button
          type='button'
          aria-label={_('Previous Period')}
          onClick={() => changePeriod(-1)}
          className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0'
        >
          <MdChevronLeft className='h-5 w-5 rtl:rotate-180' />
        </button>
        <span className='min-w-0 truncate text-center text-sm font-medium tabular-nums'>
          {periodLabel}
        </span>
        <button
          type='button'
          aria-label={_('Next Period')}
          disabled={!canGoNext}
          onClick={() => changePeriod(1)}
          className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0 disabled:bg-transparent'
        >
          <MdChevronRight className='h-5 w-5 rtl:rotate-180' />
        </button>
      </div>
    </div>
  );

  if (failed) {
    return (
      <p className='text-base-content/70 py-10 text-center'>
        {_('Failed to load reading statistics')}
      </p>
    );
  }
  // Never pair a newly selected period with data loaded for the previous one,
  // but keep the period controls in place and make the reload explicit.
  if (!stats || stats.periodStart !== periodStart || stats.periodEnd !== periodEnd) {
    return (
      <div className='flex flex-col gap-6 pb-6'>
        {periodHeader}
        <div
          role='status'
          className='text-base-content/70 flex min-h-40 items-center justify-center gap-3'
        >
          <span className='loading loading-spinner loading-sm' aria-hidden='true' />
          <span>{_('Loading...')}</span>
        </div>
      </div>
    );
  }

  const { daily, totals, summary, rankings, breakdown, periodDaily } = stats;
  const streaks = getStreaks(daily);
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);
  const days = (count: number) => _('{{count}} days', { count });
  const pages = (count: number) => _('{{count}} pages', { count });
  const isEmpty = summary.seconds === 0 && rankings.length === 0;

  const groupedBreakdown = new Map<string, DailyBookBreakdown[]>();
  for (const row of breakdown) {
    const rows = groupedBreakdown.get(row.date) ?? [];
    rows.push(row);
    groupedBreakdown.set(row.date, rows);
  }

  const handleDelete = async (row: DailyBookBreakdown) => {
    const db = dbRef.current;
    if (!db) return;
    const key = `${row.date}\u0000${row.bookMd5}`;
    const dayStart = new Date(`${row.date}T00:00:00`);
    const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
    setDeletingKey(key);
    setActionNotice(null);
    try {
      const deleted = await db.deleteBookRange(
        row.bookMd5,
        dayStart.getTime() / 1000,
        dayEnd.getTime() / 1000,
      );
      setUndoState({ deleted, title: titleOf(row) });
      setActionNotice('deleted');
      setReloadToken((token) => token + 1);
    } catch (err) {
      console.error('Failed to delete reading data:', err);
      setActionNotice('error');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleUndo = async () => {
    const db = dbRef.current;
    if (!db || !undoState) return;
    try {
      await db.undoDelete(undoState.deleted);
      setUndoState(null);
      setActionNotice('undone');
      setReloadToken((token) => token + 1);
    } catch (err) {
      console.error('Failed to restore reading data:', err);
      setActionNotice('error');
    }
  };

  return (
    <div className='flex flex-col gap-6 pb-6'>
      {periodHeader}

      <BoxedList title={_('Reading Time')} innerClassName='pe-4 py-4'>
        <ReadingTimeChart
          key={`${range}-${bounds.start.getTime()}`}
          daily={periodDaily}
          range={range}
          anchorDate={bounds.start}
        />
      </BoxedList>

      <BoxedList title={_('Period Summary')}>
        <SettingsRow label={_('Reading Time')}>
          <span className='tabular-nums'>{time(summary.seconds)}</span>
        </SettingsRow>
        <SettingsRow label={_('Reading Days')}>
          <span className='tabular-nums'>{days(summary.days)}</span>
        </SettingsRow>
        <SettingsRow label={_('Books')}>
          <span className='tabular-nums'>{summary.books.toLocaleString(getLocale())}</span>
        </SettingsRow>
        <SettingsRow label={_('Pages')}>
          <span className='tabular-nums'>{summary.pages.toLocaleString(getLocale())}</span>
        </SettingsRow>
      </BoxedList>

      {isEmpty ? (
        <p className='text-base-content/70 py-4 text-center'>
          {_('No reading activity in this period')}
        </p>
      ) : (
        <>
          {rankings.length > 0 && (
            <BoxedList title={_('Book Ranking')}>
              {rankings.map((book, index) => (
                <SettingsRow
                  key={book.bookMd5}
                  label={
                    <span className='line-clamp-1'>
                      {index + 1}. {titleOf(book)}
                    </span>
                  }
                  description={book.authors}
                >
                  <span className='shrink-0 tabular-nums'>{time(book.seconds)}</span>
                </SettingsRow>
              ))}
            </BoxedList>
          )}

          {breakdown.length > 0 && (
            <BoxedList title={_('Daily Details')} innerClassName='py-2'>
              {[...groupedBreakdown].map(([date, rows]) => (
                <div key={date} className='py-2'>
                  <div className='px-4 pb-1 text-[0.8em] font-medium'>
                    {new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  {rows.map((row) => {
                    const key = `${row.date}\u0000${row.bookMd5}`;
                    return (
                      <SettingsRow
                        key={key}
                        label={<span className='line-clamp-1'>{titleOf(row)}</span>}
                        description={
                          <span className='flex min-w-0 items-center gap-1.5'>
                            {row.authors && <span className='truncate'>{row.authors}</span>}
                            {row.authors && <span aria-hidden='true'>·</span>}
                            <span className='shrink-0'>{pages(row.pages)}</span>
                          </span>
                        }
                        className='min-h-12'
                      >
                        <div className='flex shrink-0 items-center gap-1'>
                          <span className='tabular-nums'>{time(row.seconds)}</span>
                          <button
                            type='button'
                            aria-label={_('Delete {{title}} on {{date}}', {
                              title: titleOf(row),
                              date: new Date(`${date}T00:00:00`).toLocaleDateString(locale),
                            })}
                            disabled={deletingKey !== null}
                            onClick={() => void handleDelete(row)}
                            className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0 text-base-content/65 hover:text-error'
                          >
                            <MdDeleteOutline className='h-4 w-4' />
                          </button>
                        </div>
                      </SettingsRow>
                    );
                  })}
                </div>
              ))}
            </BoxedList>
          )}
        </>
      )}

      {actionNotice && (
        <div
          role='status'
          className={clsx(
            'eink-bordered flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
            actionNotice === 'error'
              ? 'not-eink:border-error/40 not-eink:bg-error/10'
              : 'border-base-200 bg-base-100',
          )}
        >
          <span className='min-w-0'>
            {actionNotice === 'deleted' &&
              _('Deleted locally. A later sync may restore this data.', {
                title: undoState?.title,
              })}
            {actionNotice === 'undone' && _('Deletion undone')}
            {actionNotice === 'error' && _('Failed to update reading data')}
          </span>
          {actionNotice === 'deleted' && undoState && (
            <button
              type='button'
              onClick={() => void handleUndo()}
              className='btn btn-ghost btn-sm shrink-0 gap-1'
            >
              <MdUndo className='h-4 w-4 rtl:rotate-180' />
              {_('Undo')}
            </button>
          )}
        </div>
      )}

      <BoxedList title={_('Activity')} innerClassName='pe-4 py-4'>
        <ReadingHeatmap daily={daily} />
      </BoxedList>
      <BoxedList title={_('Overview')}>
        <SettingsRow label={_('Today')}>
          <span className='tabular-nums'>{time(daily.get(toDateKey(new Date())) ?? 0)}</span>
        </SettingsRow>
        <SettingsRow label={_('Current Streak')}>
          <span className='tabular-nums'>{days(streaks.current)}</span>
        </SettingsRow>
        <SettingsRow label={_('Longest Streak')}>
          <span className='tabular-nums'>{days(streaks.longest)}</span>
        </SettingsRow>
      </BoxedList>
      <BoxedList title={_('All Time')}>
        <SettingsRow label={_('Reading Time')}>
          <span className='tabular-nums'>{time(totals.seconds)}</span>
        </SettingsRow>
        <SettingsRow label={_('Books')}>
          <span className='tabular-nums'>{totals.books.toLocaleString(getLocale())}</span>
        </SettingsRow>
        <SettingsRow label={_('Pages')}>
          <span className='tabular-nums'>{totals.pages.toLocaleString(getLocale())}</span>
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export const ReadingStatsDialog: React.FC = () => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('reading_stats_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='reading_stats_window'
      isOpen={isOpen}
      title={_('Reading Statistics')}
      onClose={() => setIsOpen(false)}
      useOverlayScroll
      boxClassName='sm:h-[85%]! sm:w-[560px]! sm:max-w-(--breakpoint-sm)!'
      contentClassName='px-4! sm:px-6!'
    >
      {isOpen && <ReadingStatsContent />}
    </Dialog>
  );
};

export default ReadingStatsDialog;
