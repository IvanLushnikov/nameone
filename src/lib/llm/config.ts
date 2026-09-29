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
 *
 * С 2026-09-27 primary провайдер — polza.ai (юрлица РФ, ФЗ-152, ₽).
 * Цены в MODELS — тарифы polza, конвертация RUB→USD по курсу ~85 ₽/$.
 */

export const ENV_KEYS = {
  openai: 'NEXT_PUBLIC_OPENAI_PROVIDER', // на бэке OPENAI_API_KEY
  anthropic: 'NEXT_PUBLIC_ANTHROPIC_PROVIDER', // на бэке ANTHROPIC_API_KEY
  deepseek: 'NEXT_PUBLIC_DEEPSEEK_PROVIDER', // на бэке DEEPSEEK_API_KEY
  dashscope: 'NEXT_PUBLIC_DASHSCOPE_PROVIDER', // на бэке DASHSCOPE_API_KEY
  polza: 'NEXT_PUBLIC_POLZA_PROVIDER', // на бэке POLZA_API_KEY
} as const;

export interface ModelInfo {
  id: string;
  role: 'generator' | 'boost' | 'premium' | 'validator' | 'embeddings' | 'image';
  provider: 'openai' | 'anthropic' | 'deepseek' | 'dashscope' | 'polza' | 'replicate' | 'inception';
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number;
  description: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'gpt-6-luna',
    role: 'generator',
    provider: 'polza',
    inputPricePer1M: 0.07, // polza: 5.91 ₽/1M ≈ $0.07
    outputPricePer1M: 0.35, // 29.53 ₽/1M ≈ $0.35
    contextWindow: 128_000,
    description: 'Базовый генератор рабочих листов (95% запросов). Polza: openai/gpt-6-luna.',
  },
  {
    id: 'gpt-6-sol',
    role: 'boost',
    provider: 'polza',
    inputPricePer1M: 1.39, // 118 ₽/1M ≈ $1.39
    outputPricePer1M: 6.95, // 590 ₽/1M ≈ $6.95
    contextWindow: 128_000,
    description: 'Boost: тяжёлые темы, низкая уверенность Luna. Polza: openai/gpt-6-sol.',
  },
  {
    id: 'claude-opus-5-5',
    role: 'premium',
    provider: 'polza',
    inputPricePer1M: 5.56, // 472 ₽/1M ≈ $5.56
    outputPricePer1M: 27.8, // 2362 ₽/1M ≈ $27.80
    contextWindow: 200_000,
    description: 'Премиум (Plus): ЕГЭ/ОГЭ, 10-11 класс. С prompt cache. Polza: anthropic/claude-opus-5.5.',
  },
  {
    id: 'deepseek-v4-flash',
    role: 'validator',
    provider: 'polza',
    inputPricePer1M: 0.14,
    outputPricePer1M: 0.28,
    contextWindow: 64_000,
    description: 'Валидатор: дубли, корректность ответов, ФГОС. Polza: deepseek/deepseek-chat (нет точной v4-flash).',
  },
  {
    id: 'qwen3-embedding-8b',
    role: 'embeddings',
    provider: 'polza',
    inputPricePer1M: 0.0,
    outputPricePer1M: 0.0,
    contextWindow: 8192,
    description: 'Эмбеддинги для семантического кэша и поиска. (TODO: проверить точное имя на polza).',
  },
  {
    id: 'text-embedding-3-large',
    role: 'embeddings',
    provider: 'polza',
    inputPricePer1M: 0.13,
    outputPricePer1M: 0.0,
    contextWindow: 8192,
    description: 'Fallback embeddings. Polza: openai/text-embedding-3-large.',
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
    // Demo: вернём только то, что фронт "знает" через NEXT_PUBLIC_* (без секретов).
    // Polza — primary, проверяем его в первую очередь.
    const any =
      !!process.env[ENV_KEYS.polza] ||
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
