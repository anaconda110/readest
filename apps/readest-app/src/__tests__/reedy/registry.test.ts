import { describe, it, expect, vi } from 'vitest';
import { createReedyModels } from '@/services/reedy/models/registry';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

// Mock the AIProvider factory so we don't pull provider transports into the
// registry test — registry's job is metadata + routing, not provider plumbing.
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({
    getModel: () => ({ __mock: 'language-model' }),
    getEmbeddingModel: () => ({ __mock: 'embedding-model' }),
  }),
}));

function settings(overrides: Partial<AISettings> = {}): AISettings {
  return { ...DEFAULT_AI_SETTINGS, enabled: true, ...overrides };
}

describe('createReedyModels — chat metadata table', () => {
  it('routes Gemini 2.5 models to the 2M context window', () => {
    const { chat } = createReedyModels(
      settings({ provider: 'ai-gateway', aiGatewayModel: 'google/gemini-2.5-flash-lite' }),
    );
    expect(chat.id).toBe('google/gemini-2.5-flash-lite');
    expect(chat.contextWindow).toBe(2_000_000);
    expect(chat.supportsTools).toBe(true);
  });

  it('routes GPT-5 family to a 128K context window', () => {
    const { chat } = createReedyModels(
      settings({ provider: 'ai-gateway', aiGatewayModel: 'openai/gpt-5-nano' }),
    );
    expect(chat.contextWindow).toBe(128_000);
    expect(chat.supportsTools).toBe(true);
  });

  it('routes Llama 4 to 128K with tool support', () => {
    const { chat } = createReedyModels(
      settings({ provider: 'ai-gateway', aiGatewayModel: 'meta/llama-4-scout' }),
    );
    expect(chat.contextWindow).toBe(128_000);
    expect(chat.supportsTools).toBe(true);
  });

  it('treats local Ollama llama models as 4K ctx, no tool support', () => {
    const { chat } = createReedyModels(settings({ provider: 'ollama', ollamaModel: 'llama3.2' }));
    expect(chat.id).toBe('llama3.2');
    expect(chat.contextWindow).toBe(4_096);
    expect(chat.supportsTools).toBe(false);
  });

  it('falls back to a conservative 8K default for unknown model ids', () => {
    const { chat } = createReedyModels(
      settings({ provider: 'ai-gateway', aiGatewayModel: 'unknown/strange-future-model' }),
    );
    expect(chat.contextWindow).toBe(8_192);
    expect(chat.supportsTools).toBe(false);
  });

  it('prefers the AI Gateway custom-model field over the dropdown selection', () => {
    const { chat } = createReedyModels(
      settings({
        provider: 'ai-gateway',
        aiGatewayModel: 'openai/gpt-5-nano',
        aiGatewayCustomModel: 'anthropic/claude-opus-4-7',
      }),
    );
    expect(chat.id).toBe('anthropic/claude-opus-4-7');
    expect(chat.contextWindow).toBe(200_000);
  });

  it('returns the underlying Vercel SDK model via getLanguageModel()', () => {
    const { chat } = createReedyModels(settings({ provider: 'ai-gateway' }));
    expect(chat.getLanguageModel()).toEqual({ __mock: 'language-model' });
  });
});

describe('createReedyModels — local embedding engine', () => {
  it('uses the local BGE engine independently of the chat provider', () => {
    const { embedding } = createReedyModels(
      settings({ provider: 'ai-gateway', ragEngine: 'Xenova/bge-small-zh-v1.5' }),
    );
    expect(embedding.id).toBe('Xenova/bge-small-zh-v1.5');
    expect(embedding.dim).toBe(512);
    expect(embedding.batchSize).toBe(8);
  });

  it('supports the built-in TF-IDF fallback engine without a model download', () => {
    const { embedding } = createReedyModels(settings({ ragEngine: 'tfidf' }));
    expect(embedding.id).toBe('tfidf');
    expect(embedding.dim).toBe(128);
    expect(embedding.batchSize).toBe(32);
  });
});
