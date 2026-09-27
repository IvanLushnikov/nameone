"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ExamRunner } from "@/components/oge/ExamRunner";
import {
  GraduationCap,
  Timer,
  Sparkles,
  TrendingUp,
  Lock,
} from "lucide-react";
import { generateExamVariant } from "@/lib/mock/generator";
import { canGenerate } from "@/lib/utils/limit";
import type { ExamVariant } from "@/lib/types";

const examSubjects = [
  { slug: "math", name: "Математика", emoji: "🔢", color: "brand" as const, popular: true },
  { slug: "russian", name: "Русский язык", emoji: "📖", color: "accent" as const, popular: true },
  { slug: "physics", name: "Физика", emoji: "⚛️", color: "info" as const, popular: false },
  { slug: "chemistry", name: "Химия", emoji: "🧪", color: "info" as const, popular: false },
  { slug: "biology", name: "Биология", emoji: "🌿", color: "info" as const, popular: false },
  { slug: "history", name: "История", emoji: "🏛️", color: "info" as const, popular: false },
  { slug: "social", name: "Обществознание", emoji: "⚖️", color: "info" as const, popular: true },
  { slug: "english", name: "Английский", emoji: "🇬🇧", color: "warm" as const, popular: false },
  { slug: "informatics", name: "Информатика", emoji: "💻", color: "info" as const, popular: false },
  { slug: "literature", name: "Литература", emoji: "📚", color: "accent" as const, popular: false },
];

export default function OgeHubPage() {
  const [exam, setExam] = React.useState<"oge" | "ege">("oge");
  const [variant, setVariant] = React.useState<ExamVariant | null>(null);
  const [loading, setLoading] = React.useState(false);

  const { toast } = useToast();

  const handleStart = async (subject: string) => {
    if (!canGenerate()) {
      toast({
        tone: "error",
        title: "Лимит исчерпан",
        description: "Оформите подписку Плюс для безлимитных вариантов ОГЭ/ЕГЭ.",
      });
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    const variantNumber = Math.floor(Math.random() * 99) + 1;
    setVariant(generateExamVariant(exam, subject, variantNumber));
    setLoading(false);
  };

  if (variant) {
    return <ExamRunner variant={variant} onExit={() => setVariant(null)} />;
  }

  return (
    <div className="container-tight py-8 sm:py-12">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <Badge tone="accent" className="mb-4">
          <Sparkles className="w-3 h-3" />
          Подготовка к экзаменам
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight">
          ОГЭ и ЕГЭ с&nbsp;разбором каждого задания
        </h1>
        <p className="mt-4 text-lg text-warm-600">
          Свежий вариант по любому предмету. Решайте по одному заданию — сразу видите правильный ответ и подробный разбор.
        </p>
      </div>

      {/* Tabs ОГЭ/ЕГЭ */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 p-1 bg-warm-100 rounded-2xl">
          {(["oge", "ege"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setExam(e)}
              className={`px-5 h-10 rounded-xl text-sm font-semibold transition-all ${
                exam === e
                  ? "bg-white text-warm-950 shadow-soft"
                  : "text-warm-600 hover:text-warm-900"
              }`}
            >
              {e === "oge" ? "ОГЭ · 9 класс" : "ЕГЭ · 11 класс"}
            </button>
          ))}
        </div>
      </div>

      {/* Subject picker */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 max-w-6xl mx-auto">
        {examSubjects.map((s) => (
          <Card key={s.slug} hover className="text-center relative">
            {s.popular && (
              <Badge tone="brand" className="absolute top-3 right-3">
                <Sparkles className="w-3 h-3" />
              </Badge>
            )}
            <div className="text-4xl mb-2 mt-2">{s.emoji}</div>
            <h3 className="text-base font-semibold text-warm-950">{s.name}</h3>
            <p className="text-xs text-warm-500 mt-1">
              {exam === "oge" ? "9 класс" : "11 класс"}
            </p>
            <Button
              variant="primary"
              size="md"
              fullWidth
              className="mt-4"
              onClick={() => handleStart(s.slug)}
              loading={loading}
              leftIcon={<GraduationCap className="w-4 h-4" />}
            >
              Начать
            </Button>
          </Card>
        ))}
      </div>

      {/* Features */}
      <section className="mt-16 grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {[
          {
            icon: Timer,
            title: "Таймер как на экзамене",
            text: "Реальные 3-4 часа. По окончании — автоматическая проверка.",
          },
          {
            icon: TrendingUp,
            title: "Видно слабые темы",
            text: "После варианта — карта: где ошиблись, где точно знаете. Подскажет, что подтянуть.",
          },
          {
            icon: Sparkles,
            title: "Разбор каждого задания",
            text: "Не просто «правильно/неправильно», а пошаговое объяснение от AI.",
          },
        ].map((f) => (
          <div key={f.title} className="flex flex-col items-center text-center">
            <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 grid place-items-center mb-3">
              <f.icon className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-warm-950 mb-1">{f.title}</h4>
            <p className="text-sm text-warm-600">{f.text}</p>
          </div>
        ))}
      </section>

      {/* B2C link */}
      <div className="text-center mt-12">
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 text-sm text-warm-500 hover:text-warm-900"
        >
          <Lock className="w-3.5 h-3.5" />
          Доступно на тарифе Плюс · 1 490 ₽/мес
        </Link>
      </div>
    </div>
  );
}