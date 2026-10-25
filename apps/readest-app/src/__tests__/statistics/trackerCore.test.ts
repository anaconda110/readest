import { describe, it, expect } from 'vitest';
import { TrackerCore } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';

const cfg = DEFAULT_STATS_TRACKING_CONFIG;

describe('TrackerCore', () => {
  it('emits an event when the page changes', () => {
    const t = new TrackerCore(cfg);
    expect(t.onPage(5, 100, 1000)).toEqual([]);
    const out = t.onPage(6, 100, 1030);
    expect(out).toEqual([{ page: 5, startTime: 1000, duration: 30, totalPages: 100 }]);
  });

  it('splits a 250-second visit without losing time', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 100);
    expect(t.onPage(2, 10, 350)).toEqual([
      { page: 1, startTime: 100, duration: 120, totalPages: 10 },
      { page: 1, startTime: 220, duration: 120, totalPages: 10 },
      { page: 1, startTime: 340, duration: 10, totalPages: 10 },
    ]);
  });

  it('emits only complete segments for an exact segment boundary', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onPage(2, 10, 240)).toEqual([
      { page: 1, startTime: 0, duration: 120, totalPages: 10 },
      { page: 1, startTime: 120, duration: 120, totalPages: 10 },
    ]);
  });

  it('checkpoints complete segments while preserving the unfinished tail', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 100);
    expect(t.checkpoint(280)).toEqual([{ page: 1, startTime: 100, duration: 120, totalPages: 10 }]);
    expect(t.onPage(2, 10, 310)).toEqual([
      { page: 1, startTime: 220, duration: 90, totalPages: 10 },
    ]);
  });

  it('drops sub-minimum events', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onPage(2, 10, 1)).toEqual([]);
  });

  it('flushes and pauses on idle, then resumes with a new start_time', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onIdle(50)).toEqual([{ page: 1, startTime: 0, duration: 50, totalPages: 10 }]);
    expect(t.onPage(1, 10, 200)).toEqual([]);
    expect(t.onPage(2, 10, 230)).toEqual([
      { page: 1, startTime: 200, duration: 30, totalPages: 10 },
    ]);
  });

  it('flushes on hide and on close without double-counting', () => {
    const t = new TrackerCore(cfg);
    t.onPage(7, 10, 0);
    expect(t.onHide(40)).toEqual([{ page: 7, startTime: 0, duration: 40, totalPages: 10 }]);
    expect(t.onClose(99)).toEqual([]);
  });

  it('keeps timing after a checkpoint lands on an exact segment boundary', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.checkpoint(240)).toEqual([
      { page: 1, startTime: 0, duration: 120, totalPages: 10 },
      { page: 1, startTime: 120, duration: 120, totalPages: 10 },
    ]);
    expect(t.checkpoint(240)).toEqual([]);
    expect(t.checkpoint(270)).toEqual([]);
    expect(t.onPage(2, 10, 310)).toEqual([
      { page: 1, startTime: 240, duration: 70, totalPages: 10 },
    ]);
  });
});
