import type { Metadata } from "next";
import { StudentClassPage } from "@/components/student/StudentClassPage";

/**
 * Страница ученика по короткому коду — `/k/?c=XXXXXX` (ТЗ-28).
 *
 * ─── ПОЧЕМУ ТАК ────────────────────────────────────────────────────────────
 * Фронт собирается как `output: "export"`. Динамического маршрута с кодом в
 * пути здесь быть не может: для него понадобились бы `generateStaticParams` и
 * тысячи сгенерированных страниц. Поэтому страница ОДНА статическая, а код
 * приходит в query и читается в useEffect — так же, как токен формы в
 * `src/app/form/FormRunner.tsx`.
 *
 * ─── ПОЧЕМУ В ROBOTS ЗАКРЫТО ───────────────────────────────────────────────
 * Страница без кода бесполезна, а с кодом — личная страница ученика. В карту
 * сайта она не идёт (там только `/`), и индексации не подлежит: поисковику
 * нет причины хранить пустую форму входа.
 */
export const metadata: Metadata = {
  title: "Сдача работы по коду класса",
  description:
    "Откройте задания по коду класса с телефона, сфотографируйте работу и отправьте учителю.",
  // Личная страница ученика: в индекс не идём даже с кодом.
  robots: { index: false, follow: false },
  // APPLE-WEB-APP — чтобы iOS открывал страницу на весь экран, как приложение.
  appleWebApp: { capable: true, title: "УчЛист", statusBarStyle: "default" },
};

export default function StudentClassPageRoute() {
  return <StudentClassPage />;
}