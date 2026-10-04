/**
 * Падежи названий предметов — предложный падеж после предлога «по».
 *
 * Зачем файл существует: карта нужна сразу нескольким SEO-страницам
 * (/subject/[subject] в H1 и тайтле, /ktp/... в H1 и тайтле, /lesson-plan/... в
 * описании). Раньше карта жила локально в /subject/[subject]/page.tsx, из-за
 * чего на остальных страницах после «по» выводилось «по Математика» —
 * это видно и в собранном HTML, и в сниппете.
 *
 * В типах Subject нет поля с предложным падежом (`nameInCase`/`prepositional`),
 * поэтому держим карту здесь. Если такое поле появится в таксономии
 * (`src/lib/content/subjects.ts`) — заменим вызовы на `subject.prepositional`
 * и удалим файл.
 *
 * Сокращения (ОБЖ) и непереводимые названия — fallback на именительный.
 */

/** slug предмета → название в предложном падеже («математике», «русскому языку»). */
export const SUBJECT_PREPOSITIONAL: Record<string, string> = {
  math: "математике",
  algebra: "алгебре",
  geometry: "геометрии",
  russian: "русскому языку",
  literature: "литературе",
  english: "английскому языку",
  informatics: "информатике",
  physics: "физике",
  chemistry: "химии",
  biology: "биологии",
  geography: "географии",
  history: "истории",
  social: "обществознанию",
  okruzhaet: "окружающему миру",
  german: "немецкому языку",
  obzh: "ОБЖ",
  technology: "технологии",
  finance: "финансовой грамотности",
  music: "музыке",
  art: "изобразительному искусству",
  pe: "физической культуре",
};

/**
 * Название предмета в предложном падеже — для фраз вида «по математике».
 * Если слага в карте нет (новый предмет), отдаём `fallback` в нижнем регистре.
 */
export function prepositionalTitle(slug: string, fallback: string): string {
  return SUBJECT_PREPOSITIONAL[slug] ?? fallback.toLowerCase();
}
