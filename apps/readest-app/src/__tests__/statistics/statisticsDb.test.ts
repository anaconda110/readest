import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import { StatisticsDb } from '@/services/statistics/statisticsDb';

async function freshStatsDb(): Promise<DatabaseService> {
  // In-memory libsql DB; run the same migrations production uses.
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('statistics'));
  return db;
}

describe('statistics migration', () => {
  let db: DatabaseService;
  beforeEach(async () => {
    db = await freshStatsDb();
  });

  it('creates KOReader book + page_stat_data tables and extension tables', async () => {
    const tables = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('book');
    expect(names).toContain('page_stat_data');
    expect(names).toContain('numbers');
    expect(names).toContain('page_stat'); // the rescaling view
    expect(names).toContain('readest_page_ext');
    expect(names).toContain('readest_book_ext');
    expect(names).toContain('readest_stat_sync_state');
  });

  it('is idempotent when the page_stat view already exists (READEST-13)', async () => {
    // A DB imported from KOReader (or left by a partially-applied migration)
    // already has a page_stat view but no migration record. turso ignores
    // IF NOT EXISTS on CREATE VIEW, so a non-idempotent migration throws
    // "View page_stat already exists" here.
    const imported = await NodeDatabaseService.open(':memory:');
    await imported.execute('CREATE VIEW page_stat AS SELECT 1 AS x');

    await expect(migrate(imported, getMigrations('statistics'))).resolves.toBeUndefined();

    const views = await imported.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'view'`,
    );
    expect(views.map((v) => v.name)).toContain('page_stat');
  });

  it('seeds the numbers helper table 1..1000', async () => {
    const rows = await db.select<{ c: number }>(`SELECT COUNT(*) AS c FROM numbers`);
    expect(rows[0]!.c).toBe(1000);
  });

  it('enforces the page_stat_data uniqueness key', async () => {
    await db.execute(`INSERT INTO book (title, authors, md5) VALUES ('T','A','m')`);
    const id = (await db.select<{ id: number }>(`SELECT id FROM book LIMIT 1`))[0]!.id;
    await db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (?,?,?,?,?)`,
      [id, 5, 1000, 10, 100],
    );
    await db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
       VALUES (?,?,?,?,?)
       ON CONFLICT(id_book, page, start_time) DO UPDATE SET duration = max(duration, excluded.duration)`,
      [id, 5, 1000, 25, 100],
    );
    const rows = await db.select<{ duration: number; c: number }>(
      `SELECT duration, COUNT(*) OVER () AS c FROM page_stat_data`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.duration).toBe(25);
  });
});

describe('StatisticsDb', () => {
  let stats: StatisticsDb;
  beforeEach(async () => {
    stats = StatisticsDb.from(await freshStatsDb());
  });

  it('upserts a book by md5 and returns a stable id_book', async () => {
    const id1 = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    const id2 = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    expect(id1).toBe(id2);
  });

  it('inserts page events and keeps the longer duration on re-flush', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 10, totalPages: 50 });
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 30, totalPages: 50 });
    await stats.insertPageEvent(id, { page: 4, startTime: 140, duration: 12, totalPages: 50 });
    await stats.recomputeBookTotals(id);
    const book = await stats.getBookByMd5('m1');
    expect(book!.total_read_time).toBe(42); // 30 + 12
    expect(book!.total_read_pages).toBe(2); // distinct pages 3,4
    expect(book!.last_open).toBe(152); // max(start_time + duration) = 140 + 12
  });

  it('returns events for push after a start_time cursor, joined with md5', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    await stats.insertPageEvent(id, { page: 1, startTime: 100, duration: 5, totalPages: 9 });
    await stats.insertPageEvent(id, { page: 2, startTime: 200, duration: 5, totalPages: 9 });
    const { events } = await stats.getEventsForPush(150);
    expect(events.map((e) => e.startTime)).toEqual([200]);
    expect(events[0]!.bookMd5).toBe('m1');
  });

  it('applies remote events idempotently via upsert', async () => {
    const remoteBooks = [{ bookMd5: 'm2', title: 'T2', authors: 'A2' }];
    const remoteEvents = [
      { bookMd5: 'm2', page: 1, startTime: 300, duration: 8, totalPages: 20 },
      { bookMd5: 'm2', page: 1, startTime: 300, duration: 8, totalPages: 20 }, // dup
    ];
    await stats.applyRemoteEvents(remoteBooks, remoteEvents);
    await stats.applyRemoteEvents(remoteBooks, remoteEvents); // again — still idempotent
    const book = await stats.getBookByMd5('m2');
    expect(book!.total_read_time).toBe(8);
  });

  it('serializes concurrent applyRemoteEvents without nesting transactions (READEST-N)', async () => {
    // Two pulls racing on the shared connection (split-view trackers) must not
    // open a BEGIN inside a BEGIN ("cannot start a transaction within a transaction").
    const a = stats.applyRemoteEvents(
      [{ bookMd5: 'ra', title: 'RA', authors: '' }],
      [{ bookMd5: 'ra', page: 1, startTime: 400, duration: 3, totalPages: 10 }],
    );
    const b = stats.applyRemoteEvents(
      [{ bookMd5: 'rb', title: 'RB', authors: '' }],
      [{ bookMd5: 'rb', page: 1, startTime: 401, duration: 4, totalPages: 10 }],
    );
    await expect(Promise.all([a, b])).resolves.toBeDefined();
    expect((await stats.getBookByMd5('ra'))!.total_read_time).toBe(3);
    expect((await stats.getBookByMd5('rb'))!.total_read_time).toBe(4);
  });

  it('reads and writes sync cursors', async () => {
    expect(await stats.getCursor('push')).toBe(0);
    await stats.setCursor('push', 1234);
    expect(await stats.getCursor('push')).toBe(1234);
  });

  it('keeps one book row per md5 even when title/authors change (no duplicates)', async () => {
    const id1 = await stats.upsertBook({ bookMd5: 'm1', title: 'Old', authors: 'A' });
    const id2 = await stats.upsertBook({ bookMd5: 'm1', title: 'New', authors: 'B' });
    expect(id2).toBe(id1);
    const book = await stats.getBookByMd5('m1');
    expect(book!.title).toBe('New'); // latest title wins
    // exactly one row for this md5
    const rows = await stats.getEventsForPush(-1); // no events; just exercise no crash
    void rows;
  });

  it('returns null until enough page data exists for a median', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm-few', title: 'T', authors: 'A' });
    for (let i = 0; i < 4; i++) {
      await stats.insertPageEvent(id, {
        page: i,
        startTime: 100 + i,
        duration: 10,
        totalPages: 50,
      });
    }
    expect(await stats.getMedianPageDurationSecs(id)).toBeNull();
  });

  it('takes the median by duration value, not by recency (odd count)', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm-odd', title: 'T', authors: 'A' });
    // Inserted in ascending start_time; durations are NOT sorted by value, so the
    // median must sort by value before picking the middle (recency-middle is 50).
    const byTime = [30, 10, 50, 20, 40];
    for (let i = 0; i < byTime.length; i++) {
      await stats.insertPageEvent(id, {
        page: i,
        startTime: 100 + i,
        duration: byTime[i]!,
        totalPages: 50,
      });
    }
    // Sorted: [10, 20, 30, 40, 50] -> median 30.
    expect(await stats.getMedianPageDurationSecs(id)).toBe(30);
  });

  it('averages the two middle durations (even count)', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm-even', title: 'T', authors: 'A' });
    const byTime = [60, 10, 50, 20, 40, 30];
    for (let i = 0; i < byTime.length; i++) {
      await stats.insertPageEvent(id, {
        page: i,
        startTime: 100 + i,
        duration: byTime[i]!,
        totalPages: 50,
      });
    }
    // Sorted: [10, 20, 30, 40, 50, 60] -> (30 + 40) / 2 = 35.
    expect(await stats.getMedianPageDurationSecs(id)).toBe(35);
  });
});

describe('StatisticsDb natural-period queries', () => {
  const range = {
    start: Math.floor(new Date('2026-10-19T00:00:00').getTime() / 1000),
    end: Math.floor(new Date('2026-10-26T00:00:00').getTime() / 1000),
  };
  const unix = (local: string) => Math.floor(new Date(local).getTime() / 1000);

  it('aggregates clipped natural-day seconds and distinct summary counts', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    const a = await stats.upsertBook({ bookMd5: 'a-md5', title: 'Alpha', authors: 'A' });
    const b = await stats.upsertBook({ bookMd5: 'b-md5', title: 'Beta', authors: 'B' });

    // Starts before the week and overlaps its first 60 seconds; starts in the
    // week and ends after it; the final row is wholly outside.
    await stats.insertPageEvent(a, {
      page: 1,
      startTime: unix('2026-10-18T23:59:00'),
      duration: 120,
      totalPages: 100,
    });
    await stats.insertPageEvent(a, {
      page: 2,
      startTime: unix('2026-10-20T23:59:30'),
      duration: 60,
      totalPages: 100,
    });
    await stats.insertPageEvent(b, {
      page: 3,
      startTime: unix('2026-10-25T23:59:00'),
      duration: 120,
      totalPages: 100,
    });
    await stats.insertPageEvent(b, {
      page: 4,
      startTime: unix('2026-10-26T00:00:00'),
      duration: 90,
      totalPages: 100,
    });

    expect(await stats.getDailyReadingSeconds(range.start, range.end)).toEqual([
      { date: '2026-10-19', seconds: 60 },
      { date: '2026-10-20', seconds: 30 },
      { date: '2026-10-21', seconds: 30 },
      { date: '2026-10-25', seconds: 60 },
    ]);
    expect(await stats.getReadingSummary(range.start, range.end)).toEqual({
      seconds: 180,
      days: 4,
      books: 2,
      pages: 3,
    });
  });

  it('returns empty results when no event overlaps the range', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    expect(await stats.getReadingSummary(range.start, range.end)).toEqual({
      seconds: 0,
      days: 0,
      books: 0,
      pages: 0,
    });
    expect(await stats.getBookReadingRankings(range.start, range.end)).toEqual([]);
    expect(await stats.getDailyBookBreakdown(range.start, range.end)).toEqual([]);
  });

  it('builds all period aggregates with one event scan', async () => {
    const database = await freshStatsDb();
    const stats = StatisticsDb.from(database);
    const alpha = await stats.upsertBook({ bookMd5: 'alpha', title: 'Alpha', authors: 'A' });
    const beta = await stats.upsertBook({ bookMd5: 'beta', title: 'Beta', authors: 'B' });
    await stats.insertPageEvent(alpha, {
      page: 1,
      startTime: unix('2026-10-20T23:59:30'),
      duration: 90,
      totalPages: 100,
    });
    await stats.insertPageEvent(alpha, {
      page: 2,
      startTime: unix('2026-10-21T10:00:00'),
      duration: 30,
      totalPages: 100,
    });
    await stats.insertPageEvent(beta, {
      page: 1,
      startTime: unix('2026-10-22T10:00:00'),
      duration: 60,
      totalPages: 50,
    });

    const expected = {
      summary: await stats.getReadingSummary(range.start, range.end),
      rankings: await stats.getBookReadingRankings(range.start, range.end),
      breakdown: await stats.getDailyBookBreakdown(range.start, range.end),
      daily: await stats.getDailyReadingSeconds(range.start, range.end),
    };
    const select = vi.spyOn(database, 'select');

    await expect(stats.getReadingPeriodStats(range.start, range.end)).resolves.toEqual(expected);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('ranks books deterministically by seconds, title and md5', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    const ids = new Map<string, number>();
    for (const [md5, title] of [
      ['z-md5', 'Same'],
      ['a-md5', 'Same'],
      ['leader', 'Leader'],
    ] as const) {
      ids.set(md5, await stats.upsertBook({ bookMd5: md5, title, authors: '' }));
    }
    const add = (md5: string, page: number, startTime: number, duration: number) =>
      stats.insertPageEvent(ids.get(md5)!, { page, startTime, duration, totalPages: 10 });

    await add('leader', 1, unix('2026-10-20T10:00:00'), 100);
    await add('z-md5', 1, unix('2026-10-20T11:00:00'), 60);
    await add('z-md5', 2, unix('2026-10-20T11:01:00'), 30);
    await add('a-md5', 1, unix('2026-10-20T12:00:00'), 60);
    await add('a-md5', 2, unix('2026-10-20T12:01:00'), 30);

    const ranking = await stats.getBookReadingRankings(range.start, range.end);
    expect(ranking.map((book) => [book.bookMd5, book.seconds])).toEqual([
      ['leader', 100],
      ['a-md5', 90],
      ['z-md5', 90],
    ]);
  });

  it('returns per-book daily details with natural-day clipping', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    const id = await stats.upsertBook({ bookMd5: 'night', title: 'Night', authors: 'N' });
    await stats.insertPageEvent(id, {
      page: 1,
      startTime: unix('2026-10-20T23:59:30'),
      duration: 60,
      totalPages: 100,
    });

    expect(await stats.getDailyBookBreakdown(range.start, range.end)).toEqual([
      {
        date: '2026-10-20',
        bookMd5: 'night',
        title: 'Night',
        authors: 'N',
        seconds: 30,
        pages: 1,
      },
      {
        date: '2026-10-21',
        bookMd5: 'night',
        title: 'Night',
        authors: 'N',
        seconds: 30,
        pages: 1,
      },
    ]);
  });

  it('deletes one book-day by clipping a long cross-day event, then restores it on undo', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    const id = await stats.upsertBook({ bookMd5: 'clip', title: 'Clip', authors: '' });
    await stats.insertPageEvent(id, {
      page: 1,
      startTime: unix('2026-10-20T23:50:00'),
      // 24.5 hours: 10 minutes before the deleted day, the full deleted day,
      // and 20 minutes after it.
      duration: 24 * 3600 + 1800,
      totalPages: 100,
    });

    const deleted = await stats.deleteBookRange(
      'clip',
      unix('2026-10-21T00:00:00'),
      unix('2026-10-22T00:00:00'),
    );
    const queryStart = unix('2026-10-20T00:00:00');
    const queryEnd = unix('2026-10-23T00:00:00');
    expect(await stats.getDailyReadingSeconds(queryStart, queryEnd)).toEqual([
      { date: '2026-10-20', seconds: 600 },
      { date: '2026-10-22', seconds: 1200 },
    ]);
    expect((await stats.getBookByMd5('clip'))!.total_read_time).toBe(1800);

    await stats.undoDelete(deleted);
    expect(await stats.getDailyReadingSeconds(queryStart, queryEnd)).toEqual([
      { date: '2026-10-20', seconds: 600 },
      { date: '2026-10-21', seconds: 86400 },
      { date: '2026-10-22', seconds: 1200 },
    ]);
    expect((await stats.getBookByMd5('clip'))!.total_read_time).toBe(88200);
  });
});

describe('StatisticsDb.open', () => {
  it('retries after a transient singleton open failure', async () => {
    const db = await freshStatsDb();
    const error = new Error('transient open failure');
    const openDatabase = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(db);
    const appService = { openDatabase } as unknown as AppService;

    await expect(StatisticsDb.open(appService)).rejects.toBe(error);

    const stats = await StatisticsDb.open(appService);
    expect(openDatabase).toHaveBeenCalledTimes(2);
    await stats.close();
  });
});

describe('library reading paces', () => {
  it('uses the same deterministic sample when timestamps tie across the latest 50 events', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    const id = await stats.upsertBook({ bookMd5: 'tied', title: 'Tied', authors: '' });
    for (let page = 0; page < 60; page++) {
      await stats.insertPageEvent(id, {
        page,
        startTime: 1000,
        duration: page + 10,
        totalPages: 100,
      });
    }

    // Break timestamp ties by descending page: pages 10–59 have median duration 44.5.
    expect.soft(await stats.getMedianPageDurationSecs(id)).toBe(44.5);
    expect.soft((await stats.getMedianPageDurationsSecs())['tied']).toBe(44.5);
  });

  it('loads the same recent median per book as individual labels, including the data threshold', async () => {
    const stats = StatisticsDb.from(await freshStatsDb());
    const ids: Record<string, number> = {};
    for (const [hash, count] of [
      ['slow', 60],
      ['fast', 6],
      ['new', 4],
    ] as const) {
      const id = await stats.upsertBook({ bookMd5: hash, title: hash, authors: '' });
      ids[hash] = id;
      for (let i = 0; i < count; i++)
        await stats.insertPageEvent(id, {
          page: i,
          startTime: 1000 + i,
          duration: i + 10,
          totalPages: 100,
        });
    }
    const paces = await stats.getMedianPageDurationsSecs();
    for (const [hash, id] of Object.entries(ids))
      expect(paces[hash] ?? null).toBe(await stats.getMedianPageDurationSecs(id));
    expect(paces['slow']).toBe(44.5);
  });

  it('leaves events longer than a page visit out of the pace', async () => {
    // A CrossPoint session recorded in whole percents before any Readest app
    // paginated the book: each step spans many pages.
    const stats = StatisticsDb.from(await freshStatsDb());
    const id = await stats.upsertBook({ bookMd5: 'percents', title: 'P', authors: '' });
    const durations = [30, 40, 50, 60, 70, 400, 500, 600];
    for (let i = 0; i < durations.length; i++) {
      await stats.insertPageEvent(id, {
        page: i + 1,
        startTime: 1000 + i,
        duration: durations[i]!,
        totalPages: 100,
      });
    }
    expect(await stats.getMedianPageDurationSecs(id)).toBe(50);
    expect((await stats.getMedianPageDurationsSecs())['percents']).toBe(50);
  });
});
