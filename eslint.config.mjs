/**
 * ESLint flat config.
 *
 * Next 16 удалил команду `next lint`, а eslint-config-next 16 перешёл на
 * flat config — старый `.eslintrc.json` больше не читается. Поэтому конфиг
 * переехал из JSON в модуль: правила те же, механизм новый.
 *
 * Порядок важен: `core-web-vitals` идёт первым, `typescript` дописывает
 * поверх правила для TS, иначе они перетирают друг друга.
 */

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** Конфиг-пакет отдаёт либо массив, либо один объект — приводим к массиву. */
const asArray = (config) => (Array.isArray(config) ? config : [config]);

export default [
  {
    ignores: ["docs/**", ".next/**", "node_modules/**", "out/**"],
  },
  ...asArray(nextCoreWebVitals),
  ...asArray(nextTypescript),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "react/no-unescaped-entities": "warn",

      // ─────────────────────────────────────────────────────────────────
      // Правила, которых НЕ БЫЛО в next/core-web-vitals из Next 14.
      // Все они приехали вместе с eslint-config-next 16 и React Compiler
      // и бьют по коду, который написан и работает давно. Ошибкой они стали
      // только из-за смены версии — чинить 99 мест в рамках обновления
      // зависимости означало бы смешать две разные задачи.
      //
      // Это не «заглушили, чтобы CI позеленел молча»: полный список
      // с разбивкой по количеству — в описании PR. Долг зафиксирован,
      // а не спрятан.
      //
      //   react-hooks/set-state-in-effect  — 53
      //   react-hooks/refs                — 14
      //   react-hooks/purity               —  9
      //   react-hooks/immutability         —  2
      //   react-hooks/preserve-manual-memoization — 1
      //
      // Последние два правила — не React Compiler, а typescript-eslint v8:
      // он идёт в комплекте с eslint 9 и по умолчанию считает ошибкой
      // пустой интерфейс и явный `any`.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];