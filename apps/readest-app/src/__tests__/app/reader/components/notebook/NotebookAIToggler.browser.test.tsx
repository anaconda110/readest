import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import NotebookAIToggler from '@/app/reader/components/notebook/NotebookAIToggler';
import SidebarToggler from '@/app/reader/components/SidebarToggler';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import '@/styles/globals.css';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

beforeEach(() => {
  useSidebarStore.setState({ sideBarBookKey: 'book-1', isSideBarVisible: false });
  useNotebookStore.setState({ isNotebookVisible: false, notebookActiveTab: 'notes' });
});

afterEach(cleanup);

it('uses the same square ghost-button format as the table of contents toggle', async () => {
  await page.viewport(1024, 768);
  render(
    <div className='flex items-center gap-4'>
      <SidebarToggler bookKey='book-1' />
      <NotebookAIToggler bookKey='book-1' />
    </div>,
  );

  const sidebar = screen.getByRole('button', { name: 'Toggle Sidebar' });
  const ai = screen.getByRole('button', { name: 'Expand AI panel' });
  const sidebarRect = sidebar.getBoundingClientRect();
  const aiRect = ai.getBoundingClientRect();

  expect(ai.className).toBe(sidebar.className);
  expect(aiRect.width).toBe(sidebarRect.width);
  expect(aiRect.height).toBe(sidebarRect.height);
  expect(aiRect.width).toBe(32);
  expect(aiRect.height).toBe(32);
});

it('opens the AI tab and becomes the matching collapse toggle', async () => {
  await page.viewport(1024, 768);
  render(<NotebookAIToggler bookKey='book-1' />);

  fireEvent.click(screen.getByRole('button', { name: 'Expand AI panel' }));

  expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
  expect(useNotebookStore.getState().notebookActiveTab).toBe('ai');
  expect(screen.getByRole('button', { name: 'Collapse AI panel' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Collapse AI panel' }));

  expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
  expect(screen.getByRole('button', { name: 'Expand AI panel' })).toBeTruthy();
});
