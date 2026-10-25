import type { StatsTrackingConfig } from '@/types/statistics';

interface PendingEvent {
  page: number;
  startTime: number; // Unix seconds
  totalPages: number;
}

export interface FlushedEvent {
  page: number;
  startTime: number;
  duration: number;
  totalPages: number;
}

/**
 * Pure page-dwell tracker. The React layer feeds it `nowSeconds` and the
 * current `(page, totalPages)`; it returns immutable events to persist.
 * Long visits are split into fixed-size segments so sync can use a simple
 * strictly-increasing start_time high-water cursor without losing time.
 */
export class TrackerCore {
  private pending: PendingEvent | null = null;

  constructor(private readonly cfg: StatsTrackingConfig) {}

  /** Notify the current page at `now`. Returns events flushed by leaving the prior page. */
  onPage(page: number, totalPages: number, now: number): FlushedEvent[] {
    if (this.pending?.page === page) return [];
    const flushed = this.flush(now);
    // No pending event means the clock was paused (idle/hidden): opening the
    // same page again must start a fresh segment rather than silently resume.
    this.pending = { page, startTime: now, totalPages };
    return flushed;
  }

  /** Persist complete segments while keeping the unfinished segment running. */
  checkpoint(now: number): FlushedEvent[] {
    return this.drain(now, false);
  }

  onIdle(now: number): FlushedEvent[] {
    return this.flush(now); // flush + pause (pending cleared)
  }

  onHide(now: number): FlushedEvent[] {
    return this.flush(now);
  }

  onClose(now: number): FlushedEvent[] {
    return this.flush(now);
  }

  private flush(now: number): FlushedEvent[] {
    return this.drain(now, true);
  }

  private drain(now: number, finish: boolean): FlushedEvent[] {
    const p = this.pending;
    if (!p) return [];

    const events: FlushedEvent[] = [];
    const segmentSeconds = this.cfg.maxEventSeconds;
    let startTime = p.startTime;
    let remaining = Math.max(0, now - startTime);

    while (remaining >= segmentSeconds) {
      events.push({
        page: p.page,
        startTime,
        duration: segmentSeconds,
        totalPages: p.totalPages,
      });
      startTime += segmentSeconds;
      remaining -= segmentSeconds;
    }

    if (finish && remaining >= this.cfg.minEventSeconds) {
      events.push({
        page: p.page,
        startTime,
        duration: remaining,
        totalPages: p.totalPages,
      });
      remaining = 0;
    }

    if (finish) {
      this.pending = null;
    } else {
      // checkpoint() never pauses the clock. This includes an exact segment
      // boundary, where a zero-duration pending event anchors the next span at
      // `now`; later checkpoints or page changes accumulate from there.
      this.pending = { ...p, startTime };
    }
    return events;
  }
}
