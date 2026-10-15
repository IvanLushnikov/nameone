/**
 * Тип окружения для `cloudflare:test`.
 *
 * `@cloudflare/vitest-plugin` объявляет `env` как `Cloudflare.Env` — глобальное
 * пространство имён. Прежний `@cloudflare/vitest-pool-workers` использовал
 * интерфейс `ProvidedEnv`, который в новом пакете удалён: пустой интерфейс
 * больше не связывался с типом окружения, и типизация тестов падала на
 * «Property 'DB' does not exist on type 'Env'».
 *
 * Одно объявление здесь заменяет девятнадцать одинаковых блоков
 * `declare module "cloudflare:test"` в самих тестах. Добавлять новый тип
 * биндинга нужно здесь, а не в каждом файле.
 */

import type { Env as BackendEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends BackendEnv {}
  }
}

export {};
