/**
 * Конфиг LLM-слоя на стороне фронта.
 * Реальный LLM-роутинг происходит на бэке (Cloudflare Worker + D1).
 * Здесь только то, что нужно фронту для UI и для smoke-теста:
 *   - список провайдеров (по наличию ключей в NEXT_PUBLIC_* переменных)
 *   - цены (для UI "сколько будет стоить")
 *   - ENV_KEYS — какие переменные где живут
 *
 * ВАЖНО: на фронте секретов быть не должно. Здесь читаются ТОЛЬКО NEXT_PUBLIC_* (без секретов).
 * Реальные ключи — на бэке через wrangler secrets.
 */

export const ENV_KEYS = {
  openai: 'NEXT_PUBLIC_OPENAI_PROVIDER', // на бэке OPENAI_API_KEY
  anthropic: 'NEXT_PUBLIC_ANTHROPIC_PROVIDER', // на бэке ANTHROPIC_API_KEY
  deepseek: 'NEXT_PUBLIC_DEEPSEEK_PROVIDER', // на бэке DEEPSEEK_API_KEY
  dashscope: 'NEXT_PUBLIC_DASHSCOPE_PROVIDER', // на бэке DASHSCOPE_API_KEY
} as const;

export interface ModelInfo {
  id: string;
  role: 'generator' | 'boost' | 'premium' | 'validator' | 'embeddings' | 'image';
  provider: 'openai' | 'anthropic' | 'deepseek' | 'dashscope' | 'replicate' | 'inception';
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number;
  description: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'gpt-6-luna',
    role: 'generator',
    provider: 'openai',
    inputPricePer1M: 0.10,
    outputPricePer1M: 0.50,
    contextWindow: 128_000,
    description: 'Базовый генератор рабочих листов (95% запросов).',
  },
  {
    id: 'gpt-6-sol',
    role: 'boost',
    provider: 'openai',
    inputPricePer1M: 2.0,
    outputPricePer1M: 10.0,
    contextWindow: 128_000,
    description: 'Boost: тяжёлые темы, низкая уверенность Luna.',
  },
  {
    id: 'claude-opus-5-5',
    role: 'premium',
    provider: 'anthropic',
    inputPricePer1M: 4.0,
    outputPricePer1M: 20.0,
    contextWindow: 200_000,
    description: 'Премиум (Plus): ЕГЭ/ОГЭ, 10-11 класс. С prompt cache.',
  },
  {
    id: 'deepseek-v4-flash',
    role: 'validator',
    provider: 'deepseek',
    inputPricePer1M: 0.14,
    outputPricePer1M: 0.28,
    contextWindow: 64_000,
    description: 'Валидатор: дубли, корректность ответов, ФГОС.',
  },
  {
    id: 'qwen3-embedding-8b',
    role: 'embeddings',
    provider: 'dashscope',
    inputPricePer1M: 0.0,
    outputPricePer1M: 0.0,
    contextWindow: 8192,
    description: 'Эмбеддинги для семантического кэша и поиска.',
  },
  {
    id: 'text-embedding-3-large',
    role: 'embeddings',
    provider: 'openai',
    inputPricePer1M: 0.13,
    outputPricePer1M: 0.0,
    contextWindow: 8192,
    description: 'Fallback embeddings (OpenAI).',
  },
];

/**
 * Список моделей, доступных на бэке (по наличию ключей в env).
 * На фронте мы НЕ знаем какие ключи есть на бэке — поэтому проксируем запрос через /api/llm/models.
 * Локальный fallback: если NEXT_PUBLIC_API_URL не задан, фронт в mock-режиме и считает что ничего не доступно (только UI).
 *
 * ВАЖНО: smoke-llm.ts вызывает эту функцию БЕЗ await (синхронно), поэтому возвращаем string[].
 * Если понадобится реальный fetch к бэку — это будет отдельная async-функция (`fetchAvailableModels`).
 */
export function availableModels(): string[] {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    // Demo: вернём только то, что фронт "знает" через NEXT_PUBLIC_* (без секретов)
    const any =
      !!process.env[ENV_KEYS.openai] ||
      !!process.env[ENV_KEYS.anthropic] ||
      !!process.env[ENV_KEYS.deepseek] ||
      !!process.env[ENV_KEYS.dashscope];
    return any ? MODELS.map((m) => m.id) : [];
  }
  // Бэк задан, но мы в синхронной функции — возвращаем пусто (UI может дёрнуть отдельный fetch).
  // TODO: добавить отдельный `fetchAvailableModels(): Promise<string[]>` если UI потребуется runtime-check.
  return [];
}

export function isImageGenAvailable(): boolean {
  // На бэке проверяются REPLICATE_API_TOKEN / INCEPTION_API_KEY.
  // На фронте мы не знаем. Возвращаем false по умолчанию.
  return false;
}
