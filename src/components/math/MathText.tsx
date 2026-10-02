"use client";

/**
 * Рендер текста задания с настоящей математикой (вертикальные дроби, степени).
 *
 * ЗАЧЕМ. Учительница просила привычный формат: «Может будет лучше сделать как
 * дети и учителя пишут… Мне тут будто надо сначала расшифровать что за вечные
 * /+/». То есть дроби как в тетради, а не «8/12».
 *
 * ТРИ ПРАВИЛА, КОТОРЫЕ НЕЛЬЗЯ НАРУШАТЬ.
 * 1) `text` — источник правды. Компонент его НЕ МЕНЯЕТ: self-verification
 *    (`src/lib/llm/self-verify.ts`) сверяет ответы именно по нему. Подменять
 *    `text` на `text_latex` нельзя — разъедется проверка ответов.
 * 2) ЛЕНИВАЯ ЗАГРУЗКА. katex весит ~300КБ, поэтому тянем его через
 *    `import("katex")` и ТОЛЬКО когда в тексте реально есть формула. До
 *    загрузки показываем обычный текст — лист не мигает и не блокирует показ.
 * 3) УСТОЙЧИВОСТЬ. Битый LaTeX не роняет страницу и не портит лист: если хоть
 *    одна формула не разобралась, компонент целиком откатывается на исходный
 *    `text` и рисует его обычным текстом (см. состояние `failed`).
 *
 * CSS KaTeX намеренно НЕ импортируется здесь, а подключён глобально в
 * `src/app/globals.css` — иначе печать (`window.print`) останется без стилей.
 */

import { useEffect, useMemo, useState } from "react";
import { hasMathSegment, parseMathText } from "@/lib/math/latex";

interface Props {
  /** Обычный текст задания. Источник правды для проверки ответов — не меняем. */
  text: string;
  /** Опциональный LaTeX-вариант для отрисовки, формулы в `$...$`. */
  textLatex?: string | null;
  className?: string;
}

/**
 * @param html[i] — готовый HTML KaTeX для i-го сегмента, `null` = пока обычный текст.
 */
type RenderedSlots = ReadonlyArray<string | null>;

const NOT_LOADED: RenderedSlots = [];

export function MathText({ text, textLatex, className }: Props) {
  // Разокнулись на text_latex — откатываемся на исходный `text` и больше не
  // пробуем KaTeX (см. комментарий про `failed` в useEffect).
  const [failed, setFailed] = useState(false);

  const segments = useMemo(
    () => parseMathText(text, failed ? undefined : textLatex),
    [text, textLatex, failed]
  );
  const needsKatex = useMemo(() => !failed && hasMathSegment(segments), [segments, failed]);

  // До загрузки KaTeX (и если формул нет вообще) — держим обычный текст.
  const [html, setHtml] = useState<RenderedSlots>(NOT_LOADED);

  useEffect(() => {
    setHtml(NOT_LOADED);
    if (!needsKatex) return;

    let cancelled = false;
    // Динамический импорт: katex (~300КБ) не тянется в бандл листа, пока
    // в задании нет ни одной формулы.
    void import("katex")
      .then(({ default: katex }) => {
        let anyFailed = false;
        const next = segments.map((segment): string | null => {
          if (segment.type !== "math") return null;
          try {
            return katex.renderToString(segment.latex, {
              displayMode: false,
              // true → на битом LaTeX бросаем ParseError и ловим его сами.
              throwOnError: true,
              output: "html",
            });
          } catch {
            anyFailed = true;
            return null;
          }
        });
        return { anyFailed, next };
      })
      .then((result) => {
        if (cancelled || !result) return;
        // Хотя бы одна формула не разобралась — НЕ показываем частично
        // отрисованный лист. Откатываемся на исходный `text` целиком: он
        // гарантированно читаем (это тот самый текст, по которому сверяются
        // ответы), а не «frac{1}{» из испорченного $...$.
        if (result.anyFailed) setFailed(true);
        else setHtml(result.next);
      })
      .catch(() => {
        // katex не загрузился (офлайн, чанк не пришёл) — не считаем это поломкой
        // формулы: показываем обычный текст, лист остаётся читаемым.
      });

    return () => {
      cancelled = true;
    };
  }, [segments, needsKatex]);

  // После отката сегменты пересчитаны из `text` в legacy-режиме: KaTeX больше не
  // нужен, поэтому рисуем всё обычным текстом (fraction fallback = исходный вид).
  if (failed) {
    return (
      <span className={className}>
        {segments.map((segment, index) => (
          <span key={index}>
            {segment.type === "text" ? segment.value : segment.fallback}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") return <span key={index}>{segment.value}</span>;

        const rendered = html[index];
        if (rendered) {
          return (
            <span
              key={index}
              className="math-inline"
              // HTML сгенерирован KaTeX из LaTeX, который пришёл из ответа модели.
              // KaTeX экранирует входные данные (trust по умолчанию false).
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          );
        }

        // KaTeX ещё грузится или упал на этой формуле — обычный текст.
        return <span key={index}>{segment.fallback}</span>;
      })}
    </span>
  );
}
