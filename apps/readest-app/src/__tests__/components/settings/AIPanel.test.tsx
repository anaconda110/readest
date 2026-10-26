import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AIPanel from '@/components/settings/AIPanel';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

const mocks = vi.hoisted(() => ({
  settings: undefined as
    | { aiSettings: typeof DEFAULT_AI_SETTINGS; [key: string]: unknown }
    | undefined,
  setSettings: vi.fn(),
  saveSettings: vi.fn(async (_envConfig: unknown, _settings: unknown) => {}),
  getRagEngineRuntimeStatus: vi.fn(),
  clearRagModelCache: vi.fn(async () => {}),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, options?: Record<string, number | string>) => {
    if (!options) return text;
    return Object.entries(options).reduce(
      (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, String(replacement)),
      text,
    );
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: mocks.settings,
    setSettings: mocks.setSettings,
    saveSettings: mocks.saveSettings,
  }),
}));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: vi.fn(),
}));
vi.mock('@/services/ai/providers/OpenRouterProvider', () => ({
  fetchOpenRouterModels: vi.fn(async () => []),
}));
vi.mock('@/services/ai/rag/LocalEmbeddingModel', () => ({
  getRagEngineRuntimeStatus: mocks.getRagEngineRuntimeStatus,
  clearRagModelCache: mocks.clearRagModelCache,
}));
vi.mock('@/services/reedy/instrumentation', () => ({
  exportReedyMetricsBundle: vi.fn(async () => new Blob()),
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

const MB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = {
    aiSettings: {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
    },
  };
  mocks.getRagEngineRuntimeStatus.mockResolvedValue({
    engineId: DEFAULT_AI_SETTINGS.ragEngine,
    loaded: false,
    cached: true,
    fileCount: 3,
    bytes: 26 * MB,
    usedFallback: false,
  });
});

afterEach(cleanup);

function savedAiSettings() {
  const calls = mocks.saveSettings.mock.calls;
  const latest = calls[calls.length - 1];
  if (!latest) throw new Error('Expected AI settings to be saved');
  return (latest[1] as { aiSettings: typeof DEFAULT_AI_SETTINGS }).aiSettings;
}

describe('AIPanel local retrieval settings', () => {
  it('shows model cache runtime status', async () => {
    render(<AIPanel />);

    expect(await screen.findByText('Downloaded and cached: 26.0 MB (3 files).')).toBeTruthy();
    expect(mocks.getRagEngineRuntimeStatus).toHaveBeenCalledWith(DEFAULT_AI_SETTINGS.ragEngine);
  });

  it('persists the selected retrieval engine', async () => {
    render(<AIPanel />);
    const select = screen.getByRole('combobox', { name: 'Retrieval Engine' });

    fireEvent.change(select, { target: { value: 'tfidf' } });

    await waitFor(() => expect(savedAiSettings().ragEngine).toBe('tfidf'));
    expect(await screen.findByText('Built-in engine, no model download required.')).toBeTruthy();
  });

  it('persists the TF-IDF fallback switch', async () => {
    render(<AIPanel />);
    const row = document.querySelector<HTMLElement>('[data-setting-id="settings.ai.ragFallback"]');
    const toggle = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle?.checked).toBe(true);

    fireEvent.click(toggle!);

    await waitFor(() => expect(savedAiSettings().ragFallback).toBe(false));
    expect(toggle?.checked).toBe(false);
  });

  it('clears the active model cache and refreshes status', async () => {
    render(<AIPanel />);
    await waitFor(() =>
      expect(mocks.getRagEngineRuntimeStatus).toHaveBeenCalledWith(DEFAULT_AI_SETTINGS.ragEngine),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }));

    await waitFor(() =>
      expect(mocks.clearRagModelCache).toHaveBeenCalledWith(DEFAULT_AI_SETTINGS.ragEngine),
    );
    await waitFor(() => expect(mocks.getRagEngineRuntimeStatus).toHaveBeenCalledTimes(2));
  });
});
