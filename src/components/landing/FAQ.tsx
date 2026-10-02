"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ARTIFACT_NAMES, FREE_QUOTA_LABEL, priceLabel, normLabel } from "@/lib/content/plans";

/**
 * Бесплатный вход обещаем ОДИН раз и одним способом: 3 генерации всего,
 * без карты и без регистрации. Обещание «первый месяц за один рубль» убрано —
 * оно конфликтовало с пробным периодом на странице тарифов.
 *
 * Периода у бесплатной квоты нет: счёт ведёт сервер, суточного окна не
 * существует. Поэтому в текстах нигде не пишем «ежедневно» / «в день» —
 * только подпись FREE_QUOTA_LABEL из plans.ts. Обещание, которого нет
 * в коде, стоило бы нам репутации, когда учитель на второй день обнаружил бы,
 * что листы кончились.
 */
const items = [
  {
    q: "Листы соответствуют ФГОС 2021?",
    a: "Да. Для 1–9 классов — по ФГОС 2021 и федеральным рабочим программам (ФРП). Для 9 и 11 классов — по спецификациям ФИПИ 2026. Для 10–11 классов ждём ФГОС СОО, который вступает с 01.09.2027 — готовимся заранее. Зелёный значок рядом с темой показывает раздел ФГОС.",
  },
  {
    q: "Как это работает? Это правда AI или шаблон?",
    a: "Это не шаблон — задания генерируются под ваш класс и тему. Каждый ответ проверяется отдельно. Если задача расходится с ответом — лист перегенерируется. Ошибки в ответах не доходят до выдачи.",
  },
  {
    q: "А если AI ошибётся в задаче?",
    a: "Для математики self-verification обязательна: модель решает свою же задачу и сравнивает с указанным ответом. Если ответы не совпадают — задание перегенерируется. Для гуманитарных предметов есть human-in-the-loop: первые 1000 листов проверяет методист. Пользователи могут пожаловаться → проверка.",
  },
  {
    q: "Чем это лучше шаблонов и поиска в интернете?",
    a: "Шаблоны и поиск в интернете не учитывают ваш класс, ошибаются в задачах и не дают готовый PDF в едином формате. РабочиеЛисты AI: таксономия тем по ФГОС, проверка каждого ответа, формат A4, история и шаблоны.",
  },
  {
    q: "Нужна ли регистрация?",
    a: `Нет. Мы даём ${FREE_QUOTA_LABEL} — без карты и без регистрации, счёт ведётся на нашем сервере, так что обойти его сменой браузера нельзя. Дальше — подписка. Регистрация нужна, чтобы сохранять историю и пользоваться личным кабинетом.`,
  },
  {
    q: "Сколько стоит?",
    a: `Бесплатно: ${FREE_QUOTA_LABEL} — без карты и без регистрации. Базовый: ${priceLabel("base", "month")} или ${priceLabel("base", "academicYear")} (${normLabel("base")}, история, шаблоны). Плюс: ${priceLabel("plus", "month")} или ${priceLabel("plus", "academicYear")} (${normLabel("plus")}, + ${ARTIFACT_NAMES.lessonPlan.toLowerCase()} по ФГОС, ${ARTIFACT_NAMES.presentation.toLowerCase()}, ${ARTIFACT_NAMES.ktp}, варианты ОГЭ/ЕГЭ с разбором). Учебный год — это 9 месяцев, а не 12: летом платить не нужно. Принимаем ЮКасса, карты, СБП.`,
  },
  {
    q: "Можно использовать в школе?",
    a: `Скоро. Тариф «Школа» для классов готовим к запуску в Q1 2027 — там будут админка учителя, личные кабинеты учеников и отчёты по успеваемости. Ориентир цены — ${priceLabel("school", "month")}.`,
  },
  {
    q: "PDF можно редактировать?",
    a: "PDF генерируется в формате A4 с реальным текстом (не картинкой), поэтому задания можно выделять и копировать. Редактировать содержимое в Word нельзя — но в этом и смысл: гарантированно правильные задания и ответы.",
  },
  {
    q: "Возвращаете деньги, если не подошло?",
    a: "Да. Отмена подписки — в 1 клик в личном кабинете: после отмены в следующем периоде списания не будет. Если вопрос по самой оплате — напишите в поддержку.",
  },
];

export function FAQ() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section className="py-20 sm:py-28 bg-warm-50 border-y border-warm-100">
      <div className="container-tight max-w-3xl">
        <div className="text-center mb-10">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            FAQ
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Частые вопросы
          </h2>
        </div>

        <div className="space-y-2.5">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={cn(
                  "bg-white rounded-2xl border transition-all",
                  isOpen ? "border-brand-300 shadow-soft" : "border-warm-100"
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-medium text-warm-950">{it.q}</span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-warm-400 shrink-0 transition-transform",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-0">
                    <p className="text-sm text-warm-600 leading-relaxed">{it.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}