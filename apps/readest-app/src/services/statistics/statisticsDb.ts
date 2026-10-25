import type { AppService } from '@/types/system';
import type { DatabaseService, DatabaseRow } from '@/types/database';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';
import type { PageStatEvent, StatBook } from '@/types/statistics';
import { toDateKey } from './readingStats';

interface BookRow extends DatabaseRow {
  id: number;
  title: string;
  authors: string;
  md5: string;
  total_read_time: number;
  total_read_pages: number;
  last_open: number;
  pages: number;
}

type CursorKey = 'push' | 'pull' | 'bookorbit-push';

interface ReadingEventRow extends DatabaseRow {
  id_book: number;
  page: number;
  start_time: number;
  duration: number;
  total_pages: number;
  md5: string;
  title: string;
  authors: string;
}

interface QuarterRow extends DatabaseRow {
  start_time: number;
  duration: number;
}

export interface DailyReadingSeconds {
  date: string;
  seconds: number;
}

export interface ReadingSummary {
  seconds: number;
  days: number;
  books: number;
  pages: number;
}

export interface BookReadingRanking {
  bookMd5: string;
  title: string;
  authors: string;
  seconds: number;
}

export interface DailyBookBreakdown {
  date: string;
  bookMd5: string;
  title: string;
  authors: string;
  seconds: number;
  pages: number;
}

export interface ReadingPeriodStats {
  summary: ReadingSummary;
  rankings: BookReadingRanking[];
  breakdown: DailyBookBreakdown[];
  daily: DailyReadingSeconds[];
}

interface PageEventSnapshot extends DatabaseRow {
  id_book: number;
  page: number;
  start_time: number;
  duration: number;
  total_pages: number;
}

export interface DeletedBookRange {
  bookMd5: string;
  originalEvents: PageEventSnapshot[];
  replacementEvents: PageEventSnapshot[];
}

/** Split a clipped interval at local midnight without relying on SQLite's timezone. */
const splitIntervalByLocalDay = (startTime: number, endTime: number) => {
  const segments: { date: string; seconds: number }[] = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const day = new Date(cursor * 1000);
    const nextMidnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const segmentEnd = Math.min(endTime, nextMidnight.getTime() / 1000);
    if (segmentEnd <= cursor) break;
    segments.push({ date: toDateKey(day), seconds: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return segments;
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Readest caps one page visit at this, so a longer event spans several pages
// (a CrossPoint session recorded in whole percents) and says nothing about pace.
const MAX_PAGE_SECONDS = DEFAULT_STATS_TRACKING_CONFIG.maxEventSeconds;

/**
 * Per-tab singleton open promise. OPFS permits only ONE access handle per file
 * across the whole origin, so a second `connect()` to statistics.db throws
 * `NoModificationAllowedError`. Every ReadingStatsTracker instance (and split-
 * view books) must therefore share a single connection — we memoise the open
 * and never thrash it.
 */
let sharedDb: Promise<StatisticsDb> | null = null;
let lifecycleBound = false;

function bindLifecycle(): void {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  // Fold the WAL into the main db when the tab is backgrounded/closed — the
  // most reliable point for best-effort async OPFS work before teardown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sharedDb) {
      void sharedDb.then((s) => s.checkpoint()).catch(() => {});
    }
  });
}

/**
 * Typed wrapper over the KOReader-compatible `statistics.db`. All identity is
 * keyed on `book_hash` (= Book.hash); the local autoincrement `id_book` never
 * leaves this class.
 */
export class StatisticsDb {
  // Serializes applyRemoteEvents so two concurrent pulls can't nest BEGINs.
  private applyRemoteLock: Promise<void> = Promise.resolve();

  private constructor(private readonly db: DatabaseService) {}

  /** Production entry point — opens + migrates statistics.db (per-tab singleton). */
  static async open(appService: AppService): Promise<StatisticsDb> {
    bindLifecycle();
    if (!sharedDb) {
      const opening = (async () => {
        const db = await appService.openDatabase('statistics', 'statistics.db', 'Data');
        return new StatisticsDb(db);
      })();
      sharedDb = opening;
      void opening.catch(() => {
        if (sharedDb === opening) sharedDb = null;
      });
    }
    return sharedDb;
  }

  /** Test/advanced entry point — wrap an already-migrated DatabaseService. */
  static from(db: DatabaseService): StatisticsDb {
    return new StatisticsDb(db);
  }

  /**
   * Fold the WAL into the main db file and truncate it. The Turso engine does
   * NOT implement `PRAGMA wal_autocheckpoint` (so there's no auto threshold to
   * rely on), but `wal_checkpoint(TRUNCATE)` works — verified folding a 688 KB
   * WAL back to 0 B. We call this when the tab is hidden so the WAL stays bounded.
   */
  async checkpoint(): Promise<void> {
    await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** Checkpoint, close the underlying connection, and reset the singleton. */
  async close(): Promise<void> {
    try {
      await this.checkpoint();
    } catch {
      // best-effort — a checkpoint failure must not block close
    }
    await this.db.close();
    sharedDb = null;
  }

  async upsertBook(book: StatBook): Promise<number> {
    const existing = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      book.bookMd5,
    ]);
    if (existing[0]) {
      // md5 is the identity; keep the latest title/authors (LWW, matches server stat_books).
      await this.db.execute(`UPDATE book SET title = ?, authors = ? WHERE id = ?`, [
        book.title,
        book.authors,
        existing[0].id,
      ]);
      return existing[0].id;
    }
    await this.db.execute(
      `INSERT INTO book (title, authors, md5, notes, last_open, highlights, pages, total_read_time, total_read_pages)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
       ON CONFLICT(title, authors, md5) DO NOTHING`,
      [book.title, book.authors, book.bookMd5],
    );
    const rows = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      book.bookMd5,
    ]);
    return rows[0]!.id;
  }

  async insertPageEvent(
    idBook: number,
    e: { page: number; startTime: number; duration: number; totalPages: number },
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id_book, page, start_time)
       DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages`,
      [idBook, e.page, e.startTime, e.duration, e.totalPages],
    );
  }

  async recomputeBookTotals(idBook: number): Promise<void> {
    await this.db.execute(
      `UPDATE book SET
         total_read_time  = COALESCE((SELECT SUM(duration) FROM page_stat_data WHERE id_book = ?), 0),
         total_read_pages = COALESCE((SELECT COUNT(DISTINCT page) FROM page_stat_data WHERE id_book = ?), 0),
         last_open        = COALESCE((SELECT MAX(start_time + duration) FROM page_stat_data WHERE id_book = ?), last_open),
         pages            = COALESCE((SELECT total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time DESC LIMIT 1), pages)
       WHERE id = ?`,
      [idBook, idBook, idBook, idBook, idBook],
    );
  }

  /**
   * Returns the median duration of time spent on each page in seconds. Returns
   * `null` if sufficient data is not available.
   *
   * Use the median since reading times are skewed; thus the median must be
   * used to get the middle value.
   */
  async getMedianPageDurationSecs(idBook: number): Promise<number | null> {
    const PAGE_THRESHOLD = 5;
    const rows = await this.db.select<{ duration: number }>(
      `SELECT duration
         FROM page_stat_data
         WHERE id_book = ? AND duration <= ?
         ORDER BY start_time DESC, page DESC
         LIMIT 50`,
      [idBook, MAX_PAGE_SECONDS],
    );
    if (rows.length < PAGE_THRESHOLD) return null;
    // The query orders by recency; sort by value so the middle is the true median.
    const pageDurations = rows.map((d) => d['duration']).sort((a, b) => a - b);
    const mid = Math.floor(pageDurations.length / 2);
    return pageDurations.length % 2 !== 0
      ? (pageDurations[mid] ?? 0)
      : ((pageDurations[mid - 1] ?? 0) + (pageDurations[mid] ?? 0)) / 2;
  }

  /** Load shelf paces in one query, using the same last-50 sample as book labels. */
  async getMedianPageDurationsSecs(): Promise<Record<string, number>> {
    const rows = await this.db.select<{ md5: string; duration: number }>(
      `SELECT md5, duration FROM (
         SELECT b.md5, p.duration,
           ROW_NUMBER() OVER (PARTITION BY p.id_book ORDER BY p.start_time DESC, p.page DESC) AS recency
         FROM page_stat_data p JOIN book b ON b.id = p.id_book
         WHERE p.duration <= ?
       ) WHERE recency <= 50 ORDER BY md5, duration`,
      [MAX_PAGE_SECONDS],
    );
    const samples = new Map<string, number[]>();
    for (const { md5, duration } of rows) {
      const durations = samples.get(md5) ?? [];
      durations.push(duration);
      samples.set(md5, durations);
    }
    const medians: Record<string, number> = {};
    for (const [md5, durations] of samples) {
      if (durations.length < 5) continue;
      const mid = Math.floor(durations.length / 2);
      medians[md5] =
        durations.length % 2 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2;
    }
    return medians;
  }

  /**
   * Seconds read in each quarter hour (`start_time / 900`). Every UTC offset is
   * a multiple of 15 minutes, so callers can fold these into local days in JS
   * instead of trusting SQL `localtime` to know the host's time zone.
   */
  async getQuarterHourDurations(): Promise<{ quarter: number; seconds: number }[]> {
    const rows = await this.db.select<QuarterRow>(
      `SELECT start_time, duration FROM page_stat_data WHERE duration > 0 ORDER BY start_time`,
    );
    const totals = new Map<number, number>();
    for (const row of rows) {
      let cursor = Number(row.start_time);
      const end = cursor + Number(row.duration);
      while (cursor < end) {
        const quarter = Math.floor(cursor / 900);
        const segmentEnd = Math.min(end, (quarter + 1) * 900);
        totals.set(quarter, (totals.get(quarter) ?? 0) + segmentEnd - cursor);
        cursor = segmentEnd;
      }
    }
    return [...totals]
      .sort(([a], [b]) => a - b)
      .map(([quarter, seconds]) => ({ quarter, seconds }));
  }

  async getReadingTotals(): Promise<{ seconds: number; books: number; pages: number }> {
    const rows = await this.db.select<{ seconds: number; books: number; pages: number }>(
      `SELECT COALESCE(SUM(duration), 0) AS seconds,
              COUNT(DISTINCT id_book) AS books,
              COUNT(DISTINCT id_book || '-' || page) AS pages
       FROM page_stat_data`,
    );
    return rows[0] ?? { seconds: 0, books: 0, pages: 0 };
  }

  private async getOverlappingEvents(start: number, end: number): Promise<ReadingEventRow[]> {
    if (end <= start) return [];
    const rows = await this.db.select<ReadingEventRow>(
      `SELECT p.id_book, p.page, p.start_time, p.duration, p.total_pages,
              b.md5, b.title, b.authors
       FROM page_stat_data p JOIN book b ON b.id = p.id_book
       WHERE p.start_time < ? AND p.start_time + p.duration > ?
       ORDER BY p.start_time, b.md5, p.page`,
      [end, start],
    );
    return rows.map((row) => ({
      ...row,
      id_book: Number(row.id_book),
      page: Number(row.page),
      start_time: Number(row.start_time),
      duration: Number(row.duration),
      total_pages: Number(row.total_pages),
      md5: String(row.md5),
      title: String(row.title),
      authors: String(row.authors),
    }));
  }

  /** All dashboard aggregates for [start, end), using one event query and one event pass. */
  async getReadingPeriodStats(start: number, end: number): Promise<ReadingPeriodStats> {
    const events = await this.getOverlappingEvents(start, end);
    const dailySeconds = new Map<string, number>();
    const days = new Set<string>();
    const summaryBooks = new Set<string>();
    const summaryPages = new Set<string>();
    const byBook = new Map<string, BookReadingRanking>();
    const byDayAndBook = new Map<string, DailyBookBreakdown & { pageKeys: Set<string> }>();

    for (const event of events) {
      const clippedStart = Math.max(start, event.start_time);
      const clippedEnd = Math.min(end, event.start_time + event.duration);
      if (clippedEnd <= clippedStart) continue;

      summaryBooks.add(event.md5);
      summaryPages.add(`${event.id_book}:${event.page}`);

      const book = byBook.get(event.md5) ?? {
        bookMd5: event.md5,
        title: event.title,
        authors: event.authors,
        seconds: 0,
      };
      book.seconds += clippedEnd - clippedStart;
      byBook.set(event.md5, book);

      for (const segment of splitIntervalByLocalDay(clippedStart, clippedEnd)) {
        dailySeconds.set(segment.date, (dailySeconds.get(segment.date) ?? 0) + segment.seconds);
        days.add(segment.date);

        const key = `${segment.date}\u0000${event.md5}`;
        const detail = byDayAndBook.get(key) ?? {
          date: segment.date,
          bookMd5: event.md5,
          title: event.title,
          authors: event.authors,
          seconds: 0,
          pages: 0,
          pageKeys: new Set<string>(),
        };
        detail.seconds += segment.seconds;
        detail.pageKeys.add(`${event.id_book}:${event.page}`);
        detail.pages = detail.pageKeys.size;
        byDayAndBook.set(key, detail);
      }
    }

    const daily = [...dailySeconds]
      .filter(([, seconds]) => seconds > 0)
      .sort(([a], [b]) => compareText(a, b))
      .map(([date, seconds]) => ({ date, seconds }));
    const rankings = [...byBook.values()].sort(
      (a, b) =>
        b.seconds - a.seconds || compareText(a.title, b.title) || compareText(a.bookMd5, b.bookMd5),
    );
    const breakdown = [...byDayAndBook.values()]
      .map(({ pageKeys: _pageKeys, ...row }) => row)
      .sort(
        (a, b) =>
          compareText(a.date, b.date) ||
          b.seconds - a.seconds ||
          compareText(a.title, b.title) ||
          compareText(a.bookMd5, b.bookMd5),
      );
    const summary = {
      seconds: daily.reduce((total, row) => total + row.seconds, 0),
      days: days.size,
      books: summaryBooks.size,
      pages: summaryPages.size,
    };
    return { summary, rankings, breakdown, daily };
  }

  /** Seconds read on each local natural day within [start, end), clipped at both ends. */
  async getDailyReadingSeconds(start: number, end: number): Promise<DailyReadingSeconds[]> {
    const events = await this.getOverlappingEvents(start, end);
    const totals = new Map<string, number>();
    for (const event of events) {
      const clippedStart = Math.max(start, event.start_time);
      const clippedEnd = Math.min(end, event.start_time + event.duration);
      for (const segment of splitIntervalByLocalDay(clippedStart, clippedEnd)) {
        totals.set(segment.date, (totals.get(segment.date) ?? 0) + segment.seconds);
      }
    }
    return [...totals]
      .filter(([, seconds]) => seconds > 0)
      .sort(([a], [b]) => compareText(a, b))
      .map(([date, seconds]) => ({ date, seconds }));
  }

  async getReadingSummary(start: number, end: number): Promise<ReadingSummary> {
    return (await this.getReadingPeriodStats(start, end)).summary;
  }

  async getBookReadingRankings(start: number, end: number): Promise<BookReadingRanking[]> {
    return (await this.getReadingPeriodStats(start, end)).rankings;
  }

  async getDailyBookBreakdown(start: number, end: number): Promise<DailyBookBreakdown[]> {
    return (await this.getReadingPeriodStats(start, end)).breakdown;
  }

  /**
   * Delete one book's events inside [start, end), clipping events that cross a
   * boundary. The original rows are returned for a local-only undo.
   */
  async deleteBookRange(bookMd5: string, start: number, end: number): Promise<DeletedBookRange> {
    const deleted: DeletedBookRange = {
      bookMd5,
      originalEvents: [],
      replacementEvents: [],
    };
    if (end <= start) return deleted;
    const book = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      bookMd5,
    ]);
    const idBook = book[0]?.id;
    if (idBook === undefined) return deleted;

    await this.db.execute('BEGIN');
    try {
      const rows = await this.db.select<PageEventSnapshot>(
        `SELECT id_book, page, start_time, duration, total_pages
         FROM page_stat_data
         WHERE id_book = ? AND start_time < ? AND start_time + duration > ?
         ORDER BY start_time, page`,
        [idBook, end, start],
      );
      deleted.originalEvents = rows.map((row) => ({
        id_book: Number(row.id_book),
        page: Number(row.page),
        start_time: Number(row.start_time),
        duration: Number(row.duration),
        total_pages: Number(row.total_pages),
      }));
      await this.db.execute(
        `DELETE FROM page_stat_data
         WHERE id_book = ? AND start_time < ? AND start_time + duration > ?`,
        [idBook, end, start],
      );
      for (const event of deleted.originalEvents) {
        const eventEnd = event.start_time + event.duration;
        if (event.start_time < start) {
          const left: PageEventSnapshot = {
            ...event,
            duration: start - event.start_time,
          };
          await this.insertPageEvent(idBook, {
            page: left.page,
            startTime: left.start_time,
            duration: left.duration,
            totalPages: left.total_pages,
          });
          deleted.replacementEvents.push(left);
        }
        if (eventEnd > end) {
          const right: PageEventSnapshot = {
            ...event,
            start_time: end,
            duration: eventEnd - end,
          };
          await this.insertPageEvent(idBook, {
            page: right.page,
            startTime: right.start_time,
            duration: right.duration,
            totalPages: right.total_pages,
          });
          deleted.replacementEvents.push(right);
        }
      }
      await this.recomputeBookTotals(idBook);
      await this.db.execute('COMMIT');
      return deleted;
    } catch (err) {
      await this.db.execute('ROLLBACK');
      throw err;
    }
  }

  /** Restore rows captured by deleteBookRange. Local-only; sync tombstones are not created. */
  async undoDelete(deleted: DeletedBookRange): Promise<void> {
    if (deleted.originalEvents.length === 0) return;
    const book = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      deleted.bookMd5,
    ]);
    const idBook = book[0]?.id;
    if (idBook === undefined) return;

    await this.db.execute('BEGIN');
    try {
      for (const event of deleted.replacementEvents) {
        await this.db.execute(
          `DELETE FROM page_stat_data WHERE id_book = ? AND page = ? AND start_time = ?`,
          [event.id_book, event.page, event.start_time],
        );
      }
      for (const event of deleted.originalEvents) {
        await this.insertPageEvent(idBook, {
          page: event.page,
          startTime: event.start_time,
          duration: event.duration,
          totalPages: event.total_pages,
        });
      }
      await this.recomputeBookTotals(idBook);
      await this.db.execute('COMMIT');
    } catch (err) {
      await this.db.execute('ROLLBACK');
      throw err;
    }
  }

  async getBookByMd5(md5: string): Promise<BookRow | null> {
    const rows = await this.db.select<BookRow>(`SELECT * FROM book WHERE md5 = ? LIMIT 1`, [md5]);
    return rows[0] ?? null;
  }

  /**
   * Ensure a book row exists for an event whose metadata record isn't in the
   * current batch (paged pull can deliver an event before its `stat_books`
   * record). Unlike `upsertBook`, this NEVER overwrites an existing real title
   * with the hash placeholder — the real record, arriving in any page, wins.
   */
  private async ensureBookId(bookMd5: string): Promise<number> {
    const existing = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      bookMd5,
    ]);
    if (existing[0]) return existing[0].id;
    return this.upsertBook({ bookMd5, title: bookMd5, authors: '' });
  }

  /** Events with start_time > cursor, joined to their md5, for pushing. */
  async getEventsForPush(
    sinceStartTime: number,
  ): Promise<{ events: PageStatEvent[]; books: StatBook[] }> {
    const rows = await this.db.select<DatabaseRow>(
      `SELECT b.md5 AS bookMd5, b.title AS title, b.authors AS authors,
              p.page AS page, p.start_time AS startTime, p.duration AS duration, p.total_pages AS totalPages
       FROM page_stat_data p JOIN book b ON b.id = p.id_book
       WHERE p.start_time > ?
       ORDER BY p.start_time ASC`,
      [sinceStartTime],
    );
    const events: PageStatEvent[] = rows.map((r) => ({
      bookMd5: String(r['bookMd5']),
      page: Number(r['page']),
      startTime: Number(r['startTime']),
      duration: Number(r['duration']),
      totalPages: Number(r['totalPages']),
    }));
    const bookMap = new Map<string, StatBook>();
    for (const r of rows) {
      const md5 = String(r['bookMd5']);
      if (!bookMap.has(md5)) {
        bookMap.set(md5, {
          bookMd5: md5,
          title: String(r['title']),
          authors: String(r['authors']),
        });
      }
    }
    return { events, books: [...bookMap.values()] };
  }

  async applyRemoteEvents(books: StatBook[], events: PageStatEvent[]): Promise<void> {
    if (books.length === 0 && events.length === 0) return;
    // Serialize against other pulls: the statistics connection is shared across
    // ReadingStatsTracker instances (split view), and a second concurrent pull
    // would open a BEGIN inside this one's still-open BEGIN ("cannot start a
    // transaction within a transaction", Sentry READEST-N). The per-op native
    // lock can't make this multi-statement transaction atomic on its own.
    const prev = this.applyRemoteLock;
    let release!: () => void;
    this.applyRemoteLock = new Promise<void>((resolve) => (release = resolve));
    await prev;
    try {
      // One transaction for the whole pulled batch: a single commit instead of
      // O(rows) fsyncs, and the apply is atomic (a failed pull leaves no partial
      // state). Critical when a fresh device backfills tens of thousands of rows.
      await this.db.execute('BEGIN');
      try {
        const idByMd5 = new Map<string, number>();
        for (const b of books) idByMd5.set(b.bookMd5, await this.upsertBook(b));
        // Books referenced only by events (no metadata record) get a placeholder row.
        const touched = new Set<number>();
        for (const e of events) {
          let id = idByMd5.get(e.bookMd5);
          if (id === undefined) {
            id = await this.ensureBookId(e.bookMd5);
            idByMd5.set(e.bookMd5, id);
          }
          await this.insertPageEvent(id, e);
          touched.add(id);
        }
        for (const id of touched) await this.recomputeBookTotals(id);
        await this.db.execute('COMMIT');
      } catch (err) {
        await this.db.execute('ROLLBACK');
        throw err;
      }
    } finally {
      release();
    }
  }

  async getCursor(key: CursorKey): Promise<number> {
    const rows = await this.db.select<{ value: number }>(
      `SELECT value FROM readest_stat_sync_state WHERE key = ?`,
      [key],
    );
    return rows[0]?.value ?? 0;
  }

  async setCursor(key: CursorKey, value: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO readest_stat_sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}
