import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IndexingStatus,
  createIndexingProgress,
  type IndexingProgress,
} from '@/services/reedy/ui/IndexingStatus';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, number | string>) => {
    if (!options) return value;
    return Object.entries(options).reduce(
      (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, String(replacement)),
      value,
    );
  },
}));

afterEach(cleanup);

describe('IndexingStatus', () => {
  it('shows chapter progress while the book is being chunked', () => {
    const progress: IndexingProgress = {
      phase: 'chunking',
      current: 3,
      total: 10,
      percent: 30,
    };

    render(<IndexingStatus status='indexing' progress={progress} />);

    expect(screen.getByText('Analyzing chapters...')).toBeTruthy();
    expect(screen.getByText('3 / 10 sections')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
  });

  it('shows embedding progress with the processed chunk count', () => {
    const progress: IndexingProgress = {
      phase: 'embedding',
      current: 8,
      total: 16,
      percent: 50,
    };

    render(<IndexingStatus status='indexing' progress={progress} />);

    expect(screen.getByText('Generating embeddings...')).toBeTruthy();
    expect(screen.getByText('8 / 16 chunks')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('shows the original indexing error and a retry action', () => {
    render(
      <IndexingStatus
        status='failed'
        errorMessage='The embedding model timed out.'
        onReindex={vi.fn()}
      />,
    );

    expect(screen.getByText('The embedding model timed out.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry indexing' })).toBeTruthy();
  });
});

describe('createIndexingProgress', () => {
  it('keeps the chunking phase visible and calculates its percentage', () => {
    expect(createIndexingProgress({ phase: 'chunking', current: 2, total: 8 })).toEqual({
      phase: 'chunking',
      current: 2,
      total: 8,
      percent: 25,
    });
  });

  it('clamps invalid progress values to a safe percentage', () => {
    expect(createIndexingProgress({ phase: 'embedding', current: 12, total: 10 })).toEqual({
      phase: 'embedding',
      current: 12,
      total: 10,
      percent: 100,
    });
    expect(createIndexingProgress({ phase: 'embedding', current: 0, total: 0 })).toEqual({
      phase: 'embedding',
      current: 0,
      total: 0,
      percent: 0,
    });
  });
});
