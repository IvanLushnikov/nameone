/**
 * Semantic cache для LLM-ответов.
 * Не строгий — ищем ближайший embedding по cosine similarity ≥ threshold.
 *
 * Storage: in-memory + опциональная персистентность в JSON.
 * Для long-running прода (VPS/Docker) — работает как есть.
 * Для Vercel serverless — in-memory теряется между инвокациями; в таком режиме
 * нужно подменять storage на Redis/KV (TODO: добавить адаптер).
 */

const DEFAULTS = {
  threshold: 0.95,
  ttlMs: 30 * 24 * 3600 * 1000, // 30 дней
  persistPath: process.env.LLM_CACHE_PATH ?? ".cache/llm-cache.json",
  maxEntries: 5000,
};

interface CacheEntry<T> {
  embed: number[];
  value: T;
  createdAt: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class SemanticCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private opts: typeof DEFAULTS;
  private dirty = false;

  constructor(opts: Partial<typeof DEFAULTS> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.load();
  }

  /** Найти ближайший похожий entry. */
  async lookup<U = T>(embed: number[]): Promise<{ id: string; value: U; similarity: number } | null> {
    this.prune();
    let best: { id: string; value: U; similarity: number } | null = null;
    for (const [id, entry] of Array.from(this.store.entries())) {
      const sim = cosine(embed, entry.embed);
      if (sim >= this.opts.threshold && (!best || sim > best.similarity)) {
        best = { id, value: entry.value as unknown as U, similarity: sim };
      }
    }
    return best;
  }

  /** Сохранить. */
  set(id: string, embed: number[], value: T): void {
    if (this.store.size >= this.opts.maxEntries) {
      // FIFO по createdAt — удаляем самый старый.
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, v] of Array.from(this.store.entries())) {
        if (v.createdAt < oldestTs) {
          oldestTs = v.createdAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(id, { embed, value, createdAt: Date.now() });
    this.dirty = true;
    this.persist();
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
    this.dirty = true;
    this.persist();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of Array.from(this.store.entries())) {
      if (now - entry.createdAt > this.opts.ttlMs) {
        this.store.delete(id);
        this.dirty = true;
      }
    }
  }

  private load(): void {
    try {
      // dynamic require чтобы модуль работал и в edge runtime (если понадобится)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
      const file = path.resolve(process.cwd(), this.opts.persistPath);
      if (!fs.existsSync(file)) return;
      const raw = fs.readFileSync(file, "utf-8");
      const data = JSON.parse(raw) as { entries: [string, CacheEntry<T>][] };
      this.store = new Map(data.entries);
    } catch {
      // noop — cache просто пустой
    }
  }

  private persist(): void {
    if (!this.dirty) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
      const file = path.resolve(process.cwd(), this.opts.persistPath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ entries: Array.from(this.store.entries()) }, null, 0));
      this.dirty = false;
    } catch {
      // тихий fallback — работаем без персистентности, чем падать
    }
  }
}

// Singleton — на процесс (на сервере один инстанс).
let _cache: SemanticCache | null = null;
export function getCache(): SemanticCache {
  if (!_cache) _cache = new SemanticCache();
  return _cache;
}
