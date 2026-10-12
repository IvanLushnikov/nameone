import { REVIEWS, type Review } from "@/lib/content/reviews";

/**
 * Блок отзывов на `/about/`.
 *
 * ## Главное правило блока
 *
 * Источник (`REVIEWS`) пуст → блок не рисует НИЧЕГО. Не заголовок, не
 * «скоро здесь появятся отзывы», не серую рамку с призывом оставить отзыв.
 * Пустое место с подписью выглядит как сломанная страница, а блок,
 * которого нет вообще, — как страница, где отзывов ещё не было.
 *
 * Проверяется тестом `tests/trust-pages.test.ts`: пустой источник даёт `null`,
 * тестовая запись даёт карточку.
 *
 * ## Почему данные приходят пропом, а не читаются здесь
 *
 * Тест должен уметь подставить запись и не трогать при этом файл источника.
 * Поэтому список приходит пропом и по умолчанию равен `REVIEWS`.
 */

/** Формат даты ISO → «11 октября 2026». */
function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <li className="rounded-2xl border border-warm-200 bg-white p-5">
      {review.rating != null && (
        <p className="mb-2 text-sm text-accent-600" aria-label={`Оценка ${review.rating} из 5`}>
          {"★".repeat(review.rating)}
        </p>
      )}
      <p className="text-warm-800">{review.text}</p>
      <p className="mt-3 text-sm text-warm-500">
        {review.author}
        {review.role ? `, ${review.role}` : ""} · {formatDate(review.date)}
      </p>
    </li>
  );
}

export function ReviewsBlock({ reviews = REVIEWS }: { reviews?: readonly Review[] } = {}) {
  // Ранний выход до любой разметки: пустой список — это отсутствие блока.
  if (reviews.length === 0) return null;

  return (
    <section className="py-12 sm:py-16" aria-labelledby="reviews-title">
      <div className="container-tight">
        <h2 id="reviews-title" className="text-3xl font-display font-bold tracking-tight">
          Отзывы
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </ul>
      </div>
    </section>
  );
}