"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const items = [
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
    a: "Нет. Первые 3 генерации в сутки работают без регистрации — только cookie. Дальше можно оформить подписку или подождать до следующего дня. Регистрация нужна, чтобы сохранять историю и пользоваться личным кабинетом.",
  },
  {
    q: "Сколько стоит?",
    a: "Бесплатно: 3 генерации в сутки. Базовый: 590 ₽/мес или 5 900 ₽/год = 490 ₽/мес (безлимит, история, шаблоны). Плюс: 1 490 ₽/мес или 11 900 ₽/год = 990 ₽/мес (+ варианты ОГЭ/ЕГЭ с разбором, Telegram-бот). Принимаем ЮKassa, карты, СБП. Первый месяц Базового — 1 ₽.",
  },
  {
    q: "Можно использовать в школе?",
    a: "Да. Для учителей и школ есть B2B-тариф: 3 990 ₽/мес за класс (учитель + ученики, админка, отчёты). От 5 классов — 4 500 ₽/класс. Отправьте запрос через форму на странице «Тарифы», и мы свяжемся с вами.",
  },
  {
    q: "PDF можно редактировать?",
    a: "PDF генерируется в формате A4 с реальным текстом (не картинкой), поэтому задания можно выделять и копировать. Редактировать содержимое в Word нельзя — но в этом и смысл: гарантированно правильные задания и ответы.",
  },
  {
    q: "Возвращаете деньги, если не подошло?",
    a: "Да. Возврат в течение 7 дней без вопросов. Отмена подписки в 1 клик в личном кабинете.",
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