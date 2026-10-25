import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import NotebookAIRail from '@/app/reader/components/notebook/NotebookAIRail';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

afterEach(cleanup);

it('floats the collapsed rail at the right screen edge with the target size', async () => {
  await page.viewport(1024, 768);
  render(
    <NotebookAIRail expanded={false} variant='floating' onToggle={vi.fn()} style={{ right: 0 }} />,
  );

  const rail = screen.getByRole('button', { name: 'Expand AI panel', exact: true });
  const rect = rail.getBoundingClientRect();

  expect(rect.width).toBe(32);
  expect(rect.height).toBe(85);
  expect(rect.right).toBe(1024);
  expect(rect.top + rect.height / 2).toBe(384);
  expect(rail.getAttribute('aria-expanded')).toBe('false');
});

it('attaches the expanded rail to the panel edge without changing its width', async () => {
  await page.viewport(1024, 768);
  const { container } = render(
    <div style={{ position: 'relative', width: 320, height: 600 }}>
      <NotebookAIRail expanded={true} variant='attached' onToggle={vi.fn()} />
    </div>,
  );

  const panel = container.firstElementChild as HTMLDivElement;
  const rail = screen.getByRole('button', { name: 'Collapse AI panel', exact: true });
  const panelRect = panel.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();

  expect(railRect.width).toBe(32);
  expect(railRect.height).toBe(85);
  expect(railRect.right).toBe(panelRect.left);
  expect(railRect.top + railRect.height / 2).toBe(panelRect.top + panelRect.height / 2);
  expect(rail.getAttribute('aria-expanded')).toBe('true');
});
