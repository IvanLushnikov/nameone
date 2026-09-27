/**
 * Маршрутизация LLM по тарифу и задаче.
 * Фронт использует эту функцию только для UI-превью ("какая модель будет вызвана?").
 * Реальный выбор делает бэк в `backend/src/llm/router.ts`.
 *
 * Если нужен точный рантайм-pick (например, для теста), вызывай бэк через fetch.
 */

import { MODELS, availableModels, type ModelInfo } from './config';

// Реэкспорт для smoke-теста и UI: smoke-llm.ts импортит availableModels из "./router".
export { availableModels };

export interface RouterPick {
  primary: ModelInfo;
  fallbacks: ModelInfo[];
  reason: string;
}

export function pickModelByPlan(task: 'worksheet-gen' | 'validate' | 'embed' | 'image-gen', plan: 'free' | 'base' | 'plus'): RouterPick {
  if (task === 'validate') {
    const v = MODELS.find((m) => m.role === 'validator')!;
    return { primary: v, fallbacks: [], reason: 'validator — всегда deepseek-v4-flash' };
  }
  if (task === 'embed') {
    const e = MODELS.find((m) => m.role === 'embeddings')!;
    return { primary: e, fallbacks: [], reason: 'embeddings — qwen3 или openai' };
  }
  if (task === 'image-gen') {
    return { primary: MODELS[0]!, fallbacks: [], reason: 'image-gen — отдельный провайдер (см. бэк)' };
  }

  // worksheet-gen
  if (plan === 'plus') {
    const p = MODELS.find((m) => m.role === 'premium')!;
    return { primary: p, fallbacks: [], reason: 'Plus → Claude Opus 5.5 (с prompt cache)' };
  }
  // free / base
  const gen = MODELS.find((m) => m.role === 'generator')!;
  const boost = MODELS.find((m) => m.role === 'boost')!;
  return { primary: gen, fallbacks: [boost], reason: 'free/base → gpt-6-luna, fallback gpt-6-sol' };
}
