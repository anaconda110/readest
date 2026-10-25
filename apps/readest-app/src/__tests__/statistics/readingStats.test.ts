import { describe, it, expect } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  getDailySeconds,
  getPeriodBounds,
  getReadingBars,
  getStreaks,
  toDateKey,
} from '@/services/statistics/readingStats';

const unix = (local: string) => Math.floor(new Date(local).getTime() / 1000);
const daily = (entries: Record<string, number>) => new Map(Object.entries(entries));
const today = new Date('2026-10-21T15:00:00');

describe('StatisticsDb reading queries', () => {
  it('splits events around local midnight into their own days', async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    const book = await stats.upsertBook({ bookMd5: 'a', title: 'A', authors: '' });
    const other = await stats.upsertBook({ bookMd5: 'b', title: 'B', authors: '' });
    const event = (page: number, startTime: number, duration: number) => ({
      page,
      startTime,
      duration,
      totalPages: 100,
    });
    await stats.insertPageEvent(book, event(1, unix('2026-10-20T23:59:30'), 60));
    await stats.insertPageEvent(book, event(2, unix('2026-10-21T00:05:00'), 60));
    await stats.insertPageEvent(book, event(3, unix('2026-10-21T00:10:00'), 30));
    await stats.insertPageEvent(other, event(1, unix('2026-10-21T09:00:00'), 300));

    const days = getDailySeconds(await stats.getQuarterHourDurations());
    expect(Object.fromEntries(days)).toEqual({ '2026-10-20': 30, '2026-10-21': 420 });
    expect(await stats.getReadingTotals()).toEqual({ seconds: 450, books: 2, pages: 4 });
  });

  it('returns zero totals for an empty database', async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    expect(await stats.getQuarterHourDurations()).toEqual([]);
    expect(await stats.getReadingTotals()).toEqual({ seconds: 0, books: 0, pages: 0 });
  });
});

describe('getStreaks', () => {
  it('counts a streak that ends today', () => {
    const days = daily({ '2026-10-19': 120, '2026-10-20': 120, '2026-10-21': 120 });
    expect(getStreaks(days, today)).toEqual({ current: 3, longest: 3 });
  });

  it('keeps a streak that ended yesterday until today is over', () => {
    const days = daily({ '2026-10-19': 120, '2026-10-20': 120 });
    expect(getStreaks(days, today).current).toBe(2);
  });

  it('breaks the streak after a day without reading', () => {
    expect(getStreaks(daily({ '2026-10-19': 120 }), today).current).toBe(0);
  });

  it('counts any positive reading time toward a streak', () => {
    const days = daily({ '2026-10-20': 1, '2026-10-21': 120 });
    expect(getStreaks(days, today)).toEqual({ current: 2, longest: 2 });
  });

  it('finds the longest streak across month ends', () => {
    const days = daily({
      '2026-09-29': 60,
      '2026-09-30': 60,
      '2026-10-01': 60,
      '2026-10-02': 60,
      '2026-10-21': 60,
    });
    expect(getStreaks(days, today)).toEqual({ current: 1, longest: 4 });
  });
});

describe('getReadingBars', () => {
  it('uses the natural Monday-to-Sunday week and calendar month', () => {
    const days = daily({ '2026-10-21': 60, '2026-10-19': 30, '2026-10-18': 999 });
    const week = getReadingBars(days, 'week', today);
    expect(week).toHaveLength(7);
    expect(toDateKey(week[0]!.date)).toBe('2026-10-19');
    expect(toDateKey(week[6]!.date)).toBe('2026-10-25');
    expect(week.map((b) => b.seconds)).toEqual([30, 0, 60, 0, 0, 0, 0]);

    const month = getReadingBars(days, 'month', today);
    expect(month).toHaveLength(31);
    expect(toDateKey(month[0]!.date)).toBe('2026-10-01');
    expect(toDateKey(month[30]!.date)).toBe('2026-10-31');
  });

  it('sums the natural calendar year into January-to-December bars', () => {
    const days = daily({ '2025-12-31': 999, '2026-01-01': 60, '2026-10-01': 30, '2026-10-21': 30 });
    const year = getReadingBars(days, 'year', today);
    expect(year).toHaveLength(12);
    expect(toDateKey(year[0]!.date)).toBe('2026-01-01');
    expect(toDateKey(year[11]!.date)).toBe('2026-12-01');
    expect(year[0]!.seconds).toBe(60);
    expect(year[9]!.seconds).toBe(60);
    expect(year[11]!.seconds).toBe(0);
    expect(year.reduce((sum, b) => sum + b.seconds, 0)).toBe(120);
  });

  it('supports leap years and empty periods', () => {
    const leap = new Date('2024-02-15T12:00:00');
    const month = getReadingBars(new Map(), 'month', leap);
    expect(month).toHaveLength(29);
    expect(toDateKey(month[28]!.date)).toBe('2024-02-29');
  });
});

describe('getPeriodBounds', () => {
  it('starts weeks on Monday and handles Sunday boundaries', () => {
    const sunday = getPeriodBounds('week', new Date('2026-10-25T12:00:00'));
    expect(toDateKey(sunday.start)).toBe('2026-10-19');
    expect(toDateKey(sunday.end)).toBe('2026-10-26');

    const monday = getPeriodBounds('week', new Date('2026-10-19T00:00:00'));
    expect(toDateKey(monday.start)).toBe('2026-10-19');
    expect(toDateKey(monday.end)).toBe('2026-10-26');
  });

  it('uses exclusive end bounds for months and years', () => {
    const month = getPeriodBounds('month', new Date('2026-10-21T15:00:00'));
    expect(toDateKey(month.start)).toBe('2026-10-01');
    expect(toDateKey(month.end)).toBe('2026-11-01');

    const year = getPeriodBounds('year', new Date('2024-06-01T00:00:00'));
    expect(toDateKey(year.start)).toBe('2024-01-01');
    expect(toDateKey(year.end)).toBe('2025-01-01');
  });
});
