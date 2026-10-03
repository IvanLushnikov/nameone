import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { Sparkles, ArrowLeft } from "lucide-react";

/**
 * Без своих метаданных страница «не найдено» наследовала заголовок и
 * описание главной — в выдаче и в шарилке это выглядело как главная.
 */
export const metadata: Metadata = {
  title: "Страница не найдена",
  description: "Такой страницы нет. Вернитесь на главную или откройте каталог предметов и тем.",
};

export default function NotFound() {
  return (
    <div className="container-tight py-20 sm:py-32 max-w-md mx-auto text-center">
      <div className="text-7xl font-bold text-brand-200 mb-4">404</div>
      <h1 className="text-2xl font-display font-bold text-warm-950">
        Страница не найдена
      </h1>
      <p className="mt-3 text-warm-600">
        Возможно, тема ещё не добавлена или ссылка устарела. Попробуйте начать с генератора.
      </p>
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-2">
        <Button as="link" href="/" variant="secondary" leftIcon={<ArrowLeft className="w-4 h-4" />}>
          На главную
        </Button>
        <Button as="link" href="/constructor" variant="primary" leftIcon={<Sparkles className="w-4 h-4" />}>
          Создать лист
        </Button>
      </div>
    </div>
  );
}