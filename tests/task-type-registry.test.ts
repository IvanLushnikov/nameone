/**
 * ТЗ-33, В1.1: реестр типов заданий.
 *
 * Проверяем САМ реестр (`src/lib/content/task-types.ts`) — файл, которого
 * до этого не существовало. На старом коде этот тест падает по двум причинам
 * сразу: модуля нет, и `TASK_TYPE_REGISTRY` нет. Это и есть требуемая
 * проверка «до — падает».
 *
 * Что здесь проверяется и почему это важно:
 *   1. пять привычных типов на месте, `id` не изменились (старые листы в базе
 *      читаются как раньше, миграции нет);
 *   2. у каждого типа заполнены обязательные поля — иначе в промпте будет
 *      строка вроде `- undefined — undefined.`;
 *   3. фильтр по предмету и классу работает: «по образцу» доступно везде,
 *      а «практическая работа» — не математике;
 *   4. предметы в реестре — существующие слаги (тихо протухший слаг дал бы
 *      модели тип, который ей никогда не покажут);
 *   5. блок промпта собирается из реестра и содержит применимые типы.
 *
 * Сеть не используется, таймеров нет.
 */

import { describe, it, expect } from "vitest";
import {
  TASK_TYPE_REGISTRY,
  TASK_TYPE_IDS,
  getTaskTypeSpec,
  isKnownTaskType,
  typesForSubject,
  buildTaskTypesPromptBlock,
  type TaskTypeSpec,
} from "@/lib/content/task-types";
import { subjects } from "@/lib/content/subjects";

/**
 * Слаги предметов — из таксономии, единственного рантайм-источника истины.
 *
 * Отдельного лёгкого списка в проекте нет: `SubjectSlug` во фронте — это
 * compile-time union (`src/lib/types.ts:5`), а рантайм-список живёт в
 * `subjects.ts`. Поэтому список берём оттуда.
 */
const SUBJECT_SLUGS: string[] = subjects.map((s) => s.slug);

/** Пять типов, которые были в продукте до ТЗ-33. */
const LEGACY_IDS = ["computation", "multiple-choice", "short-answer", "essay", "fill-blank"];

/** Типы, которых не было. Их список зафиксирован в ТЗ-33 §3.1. */
const NEW_IDS = [
  "pattern",
  "matching",
  "sequence",
  "classification",
  "error-fixing",
  "table-task",
  "multi-answer",
  "compare",
  "open-ended",
  "practical",
  "word-problem",
  "source-analysis",
];

describe("ТЗ-33: реестр типов заданий", () => {
  it("в реестре 17 типов: 5 привычных и 12 новых", () => {
    expect(TASK_TYPE_REGISTRY).toHaveLength(17);
    expect(TASK_TYPE_IDS).toHaveLength(17);
  });

  it("пять привычных типов на месте, их id не изменились", () => {
    // Обратная совместимость: от id старых типов зависят листы в базе.
    for (const id of LEGACY_IDS) {
      expect(isKnownTaskType(id)).toBe(true);
    }
    expect(getTaskTypeSpec("computation")?.answerKind).toBe("exact");
    expect(getTaskTypeSpec("multiple-choice")?.needsOptions).toBe(true);
    expect(getTaskTypeSpec("essay")?.answerKind).toBe("criteria");
  });

  it("двенадцать новых типов на месте", () => {
    for (const id of NEW_IDS) {
      expect(isKnownTaskType(id)).toBe(true);
    }
  });

  it("у каждого типа заполнены обязательные поля", () => {
    for (const spec of TASK_TYPE_REGISTRY) {
      expect(spec.id, `пустой id`).toBeTruthy();
      expect(spec.name, `пустое имя у ${spec.id}`).toBeTruthy();
      expect(spec.whatTeacherAsks, `пустая формулировка у ${spec.id}`).toBeTruthy();
      expect(spec.answerKind, `пустой answerKind у ${spec.id}`).toBeTruthy();
      expect(Array.isArray(spec.printHints), `printHints не массив у ${spec.id}`).toBe(true);
      expect(spec.printHints.length, `пустые printHints у ${spec.id}`).toBeGreaterThan(0);
      expect(spec.checkHint, `пустой checkHint у ${spec.id}`).toBeTruthy();
    }
  });

  it("id уникальны", () => {
    const unique = new Set(TASK_TYPE_IDS);
    expect(unique.size).toBe(TASK_TYPE_IDS.length);
  });

  it("answerKind только из допустимых значений", () => {
    const allowed = ["exact", "choice", "text", "criteria", "order"];
    for (const spec of TASK_TYPE_REGISTRY) {
      expect(allowed, `неизвестный answerKind у ${spec.id}: ${spec.answerKind}`).toContain(
        spec.answerKind,
      );
    }
  });

  it("все предметы в реестре — существующие слаги", () => {
    for (const spec of TASK_TYPE_REGISTRY) {
      for (const subject of spec.subjects ?? []) {
        expect(SUBJECT_SLUGS, `несуществующий предмет "${subject}" у ${spec.id}`).toContain(
          subject,
        );
      }
    }
  });

  it("классы в реестре — в диапазоне 1..11", () => {
    for (const spec of TASK_TYPE_REGISTRY) {
      if (!spec.grades) continue;
      const [min, max] = spec.grades;
      expect(min).toBeGreaterThanOrEqual(1);
      expect(max).toBeLessThanOrEqual(11);
      expect(min).toBeLessThanOrEqual(max);
    }
  });

  describe("применимость к предмету и классу", () => {
    it("«по образцу» доступно везде — это самая частая школьная форма", () => {
      for (const subject of SUBJECT_SLUGS) {
        const ids = typesForSubject(subject, 5).map((s) => s.id);
        expect(ids, `нет pattern для ${subject}`).toContain("pattern");
      }
    });

    it("пять привычных типов доступны везде — обратная совместимость", () => {
      for (const subject of SUBJECT_SLUGS) {
        const ids = typesForSubject(subject, 7).map((s) => s.id);
        for (const legacy of LEGACY_IDS) {
          expect(ids, `нет ${legacy} для ${subject}`).toContain(legacy);
        }
      }
    });

    it("«практическая работа» не предлагается математике", () => {
      const math = typesForSubject("math", 5).map((s) => s.id);
      expect(math).not.toContain("practical");
    });

    it("«практическая работа» предлагается физкультуре и технологии", () => {
      expect(typesForSubject("pe", 8).map((s) => s.id)).toContain("practical");
      expect(typesForSubject("technology", 8).map((s) => s.id)).toContain("practical");
    });

    it("«установите соответствие» не предлагается физкультуре", () => {
      expect(typesForSubject("pe", 8).map((s) => s.id)).not.toContain("matching");
    });

    it("класс из диапазона отсекает тип, класс вне — нет", () => {
      // Берём тип с нижней границей класса выше 1-го и проверяем ЕГО на ЕГО
      // собственном предмете: иначе проверка выглядит как «тип не появился»,
      // хотя не появился из-за предмета, а не из-за класса.
      const spec = TASK_TYPE_REGISTRY.find((s) => s.grades && s.grades[0] > 1) as TaskTypeSpec;
      const [min, max] = spec.grades as [number, number];
      const subject = (spec.subjects as string[])[0];
      expect(typesForSubject(subject, min).map((s) => s.id)).toContain(spec.id);
      expect(typesForSubject(subject, max).map((s) => s.id)).toContain(spec.id);
      expect(typesForSubject(subject, min - 1).map((s) => s.id)).not.toContain(spec.id);
    });

    it("предмет не из реестра всё равно получает применимые типы", () => {
      const ids = typesForSubject("unknown-subject", 5).map((s) => s.id);
      expect(ids).toContain("pattern");
    });
  });

  describe("блок промпта", () => {
    it("собирается из реестра и содержит применимые типы", () => {
      const block = buildTaskTypesPromptBlock("math", 5, 12);
      expect(block).toContain("ДОСТУПНЫЕ ТИПЫ ЗАДАНИЙ");
      expect(block).toContain("`pattern`");
      expect(block).toContain("`computation`");
    });

    it("в блоке для математики нет практической работы", () => {
      expect(buildTaskTypesPromptBlock("math", 5, 12)).not.toContain("`practical`");
    });

    it("в блоке для физкультуры практическая работа есть", () => {
      expect(buildTaskTypesPromptBlock("pe", 8, 12)).toContain("`practical`");
    });

    it("в блоке каждого типа есть его id — модель должна знать точное имя", () => {
      for (const subject of SUBJECT_SLUGS) {
        const block = buildTaskTypesPromptBlock(subject, 5, 12);
        for (const spec of typesForSubject(subject, 5)) {
          expect(block, `${spec.id} потерялся в промпте для ${subject}`).toContain(`\`${spec.id}\``);
        }
      }
    });

    it("в блоке есть требование разнообразия с конкретными числами", () => {
      const block = buildTaskTypesPromptBlock("math", 5, 12);
      // Не «не пиши одинаковые подряд», а числа: сколько одного типа можно
      // и сколько должно быть других. Иначе модель трактует расплывчатое
      // «разнообразие» по-своему и выдаёт шесть расчётов из восьми.
      expect(block).toMatch(/Не больше \d+ \S+ одного типа/);
      expect(block).toMatch(/Остальные \d+ \S+ должны быть других видов/);
      expect(block).toMatch(/не меньше \d+ разных типов/);
    });
  });
});
