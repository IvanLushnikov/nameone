# Hands-on teardown: Обучай + MagicSchool + EasyClass + Chalkie
**Дата:** 2026-09-25
**Автор:** Mavis
**Метод:** Firecrawl (`scrape` + `interact`). Скриншоты 1440×900 fullPage. Без email-входа в кабинет (все 3 конкурента режут temp-домены).
**Скриншоты:** `_screenshots/` (12 файлов, ~4.5 MB).
**Что НЕ удалось:** hands-on в кабинете после логина. Email-блокер — все 3 сервиса отвергают temp-почту. Решение — нужен юзеровский email.

---

## 0. Резюме: 4 конкурента за один раз

| Конкурент | Рынок | Модель | Цена за $1 | Free tier | Главная фишка vs ЛистAI |
|---|---|---|---|---|---|
| **Обучай** | RU EdTech | Freemium B2C | 490 ₽/мес | 2 генерации разово | ИИ-проверка фото тетрадей, банк материалов с авторами, 9 типов генерации |
| **MagicSchool AI** | US K-12 | Freemium + district B2B | $8.33/мес | 80+ tools unlimited | District procurement deals, 80+ AI tools, MagicStudent |
| **EasyClass AI** | US K-12 | Freemium (жёсткий paywall) | $8.99/мес | 60+ tools (БЕЗ worksheet gen) | **Авто-генерация bar graphs/diagrams** внутри листа, 5 визуальных стилей |
| **Chalkie** | UK/EU/US K-12 | Freemium (?) | "Try for free" | Не видно | Lesson series (unit planner), State standards alignment (NGSS, C3) |

---

## 1. Обучай (obuchai.com)

*(Подробный разбор в `2026-09-25-hands-on-teardown.md`. Краткое summary:)*

**Что собрано:** лендинг, форма регистрации, меню кабинета (20+ разделов), 9 типов материала в генераторе, Банк материалов (1 085 листов, 20-150₽), 4 тарифа (0/490/990/1790 ₽), 110 000+ учителей, 5 000+ платящих.

**Главная UX-фишка:** 4 поля на лендинге → 8-9 кнопок-фильтров после выбора темы → wizard.

**Чем сильнее нас:** банк материалов с авторами (монетизация для учителей), ИИ-проверка тетрадей по фото, 32 стиля оформления, ИИ-чат «коллега» с ФГОС/ФИПИ.

**Чем мы сильнее:** SEO-карта «рабочий лист + [предмет] + [тема]» (у них параллельная через банк, но 46 тем — наш задел).

---

## 2. MagicSchool AI (magicschool.ai)

*(Подробный разбор в `2026-09-25-hands-on-teardown.md`. Краткое summary:)*

**Что собрано:** лендинг (главная), worksheet generator landing, pricing, 80+ teacher tools + 50+ student tools, тарифы FREE/PLUS/ENTERPRISE.

**Главная UX-фишка:** всё в одной платформе (worksheets, lesson plans, rubrics, quizzes, IEPs, writing feedback, presentations, AI tutor «Raina»). District procurement deals (20+ округов).

**Чем сильнее нас:** масштаб (K-12 districts в US), интеграции с LMS (Canvas/ClassLink/Clever/Schoology), SOC-2/FERPA/COPPA compliance, AI safeguards.

**Чем мы сильнее:** фокус на RU EdTech с SEO-картой + ничего про US districts не знаем (нет инсайтов для RU).

---

## 3. EasyClass AI (easyclass.ai) — НОВОЕ

### 3.1 Позиционирование

«**The only AI worksheet generator that creates bar graphs and diagrams automatically**», US K-12. Ключевая дифференциация — **визуальные элементы (SVG-графики и диаграммы) внутри листа**, не только текст. Built on **Claude AI (Anthropic)**.

**Метрики:** 10 000+ teachers, 120+ стран, Trustpilot-рейтинг (встроенный social proof).

### 3.2 Структура продукта — 60+ AI-инструментов

EasyClass — это **полноценная платформа**, не только worksheet gen:

| Категория | Инструменты |
|---|---|
| **Content Creation** | Lesson Plan Generator (18 форматов: 5E, workshop, UbD, SIOP), Worksheet Generator, Reading Passages, Presentation Generator, Math Word Problems, Vocabulary Lists, Warm-Up |
| **Assessment & Grading** | AI Grading Assistant, Rubric Generator, Quiz Generator, Exit Tickets |
| **Writing & Communication** | Writing Feedback, Text Rewriter, Text Proofreader, Email Generator (parent), Report Card Comments, Recommendation Letters, Sentence Starters, Newsletter Generator |
| **Special Education** | IEP Goal Generator (SMART goals), 504 Plan Generator, BIP Generator, Social Stories |
| **Student Activities** | Bingo Board Maker, Word Search Maker, Coloring Pages, Choice Boards, Teacher Jokes |
| **Classroom Management** | QR Code Generator, Seating Chart Maker, Display Boards (интерактивные) |

### 3.3 Главная фишка — Worksheet Generator

**5 визуальных стилей** (визуально разные шаблоны):
- **Classic** — clean professional (тесты, assessment)
- **Newspaper** — two-column broadsheet (ELA, reading)
- **Comic** — panels (reluctant learners)
- **Chalkboard** — classroom vibes (K-5)
- **Space** — STEM, science

**5 шагов:**
1. Choose topic (specific → better)
2. Select grade band (K-2 / 3-4 / 5-6 / 7-8 / 9-12) + question types (MC, fill-in, short answer, draw-and-create)
3. Click Generate — instant (Claude под капотом)
4. Review / regenerate
5. Download PDF (page 1 = worksheet, page 2 = answer key)

**Ключевая фишка:** автоматические **bar graphs, data tables, labeled diagrams, math models** (SVG-генерация). Конкуренты (MagicSchool, Canva, worksheets.ai) этого не делают — это прямой competitive moat.

**Дифференциация:** differentiated versions с word banks, sentence frames, simplified language (для ELL/SPED).

### 3.4 SEO-стратегия — ПРЯМАЯ АТАКА на нашу

**50+ страниц `/free/worksheet-generator/<subject>-<grade>-worksheets`:**
- Math: K, 1, 2, 3, 4, 5, 6, 7, 8, middle, high, elementary
- ELA: K, 1, 2, 3, 4, 5, 6, 7, 8, middle, high, elementary
- Science: 1, 2, 3, 4, 5, 6, 7, 8, elementary, middle, high, biology
- Social Studies: 2, 3, 4, 5, 6, 7, 8, elementary, middle, high, US History, World History

Каждая страница — pre-loaded worksheet generator с готовыми примерами. **Это формат нашей SEO-карты, но × 50+ страниц × US-локализация.**

**Структура URL:** `easyclass.ai/free/worksheet-generator/<slug>-worksheets`

### 3.5 Free vs Pro — модель freemium

| | **FREE** | **Pro** ($8.99/мес или $39.99/год) |
|---|---|---|
| AI tool access | 60+ | 60+ |
| Usage limits | Unlimited | Unlimited |
| Lesson Planner | basic | 18 lesson formats |
| **AI Grading** | — | ✓ |
| **Rubric Builder** | — | ✓ |
| **Worksheet Generator** | — | ✓ (с export) |
| Presentation Creator | — | ✓ |
| Newsletter Builder | — | ✓ |
| Display Boards | — | advanced |
| Support | community | priority |
| Credit card | No | No (free trial) |

**Pro = $8.99/мес или $39.99/год (≈ $3.33/мес).**

**Прямая атака на MagicSchool** (на их лендинге):
> "MagicSchool Pro costs $12.99/month (billed monthly). EasyClass Pro is $8.99/month or $3.33/month when billed annually — with a more generous free tier that includes unlimited uses."

**School-тариф:** 30-day free trial для 50 учителей (полный Pro без карты), потом volume pricing + admin dashboard + dedicated support.

### 3.6 Чем EasyClass сильнее нас

| Фишка | EasyClass | ЛистAI |
|---|---|---|
| Визуальные элементы в листе (SVG-графики) | **✓ автоматические** | ✗ нет |
| 5 шаблонов оформления | **✓** | ✗ один стиль |
| Дифференциация (word banks, sentence frames) | **✓** | ✗ нет |
| 50+ SEO-страниц `/free/worksheet-generator/...` | **✓** | ✓ (но меньше и RU-фокус) |
| Trustpilot social proof | **✓** | ✗ нет |
| Free tier БЕЗ worksheet gen | ✓ (намеренно — paywall жёсткий) | ✓ (3/день) |

### 3.7 Чем EasyClass НЕ сильнее

- **RU EdTech:** EasyClass — US-only, CCSS/NGSS alignment. Никаких ОГЭ/ЕГЭ, ФГОС, русского языка. Не конкурент на нашем рынке.
- **Без регистрации preview** — это UX-плюс для них, но paywall сразу при попытке скачать.
- **Нет ИИ-чата/коллеги** (как Raina у MagicSchool) — нет conversational interface.
- **Нет банка материалов от учителей** (как у Обучай) — только сгенерированные листы.

### 3.8 Что мы должны отсюда взять

1. **SVG-генерация в листах** — это наш технический долг. Даже простые bar graphs «5 учеников сдали на 5, 3 — на 4» сделают листы в 10× привлекательнее.
2. **Шаблоны оформления** — дать выбор «строгий/детский/минималистичный» — низковисящий плод.
3. **Дифференциация в один клик** — после генерации сделать «сделать проще/сложнее» как MagicSchool.

---

## 4. Chalkie (chalkie.ai) — НОВОЕ

### 4.1 Позиционирование

«Your best lesson. Every lesson.» UK/EU/US K-12. Фокус — **curriculum-aligned lessons + worksheets + activities**. Похож на MagicSchool, но с упором на **lesson series** (целый юнит, а не отдельный урок).

**Метрики:** «Over 1 million happy teachers», testimonials от 12-year special ed teachers, AP teachers, K-5 art teachers — широкий охват по grade levels и предметам.

### 4.2 Структура продукта

- **Lessons** — classroom-ready с объяснениями, примерами, interactive activities
- **Lesson series** — целый unit в один заход, каждый урок строится на предыдущем
- **Worksheets** — от quick gap-fill до full murder mystery, адаптированы под конкретный класс
- **Slide creation**
- **Interactive activities**

**Standards alignment:** NGSS (science), C3 (social studies), national/state frameworks.

### 4.3 Уникальные фишки

- **«Differentiated for your class»** — адаптация под конкретных учеников в классе, не «generic worksheet»
- **Remix library favourites** — взять готовый лист коллеги и адаптировать
- **Upload file / paste lesson plan / use URL as starting point** — несколько способов начать генерацию
- **Activity Sheets + Lessons** — не только рабочие листы, но и полноценные уроки со слайдами

### 4.4 Контент-стратегия: Chalkie Library

**Шаблоны уроков/листов от других учителей** (аналог Обучай-банка):
- «Lesson of the week» / «Sheet of the week» — featured
- Library с фильтрами по subject/grade
- Конкретные превью (PNG thumbnails)

**SEO:** `/en/library/worksheets/<subject>-<grade>` — но это **не отдельная SEO-карта**, а просто browse-страница.

### 4.5 Цены — не видно на лендинге

Chalkie **НЕ публикует тарифы** на лендинге. Просто «Try for free» → `app.chalkie.ai/signup`. Это B2C-funnel с freemium-onboarding.

### 4.6 Что это значит для нас

- Chalkie — **не прямой конкурент**: UK/EU/US, не RU. Но показывает что **lesson series (юнит-планнинг)** — это новая фишка, которой нет ни у Обучай, ни у MagicSchool, ни у EasyClass.
- «Differentiated for your class» — то же что у MagicSchool (state standards) и EasyClass (word banks). Все копируют эту идею.
- **Банк шаблонов от учителей** — как Обучай, но с большим фокусом на lessons (не только worksheets).

---

## 5. Сравнительная таблица (3 конкурента)

| Критерий | Обучай (RU) | MagicSchool (US) | EasyClass (US) | Chalkie (UK/EU/US) |
|---|---|---|---|---|
| **Главная фокус-фича** | рабочие листы + фото-проверка | 80+ tools + district deals | **bar graphs/diagrams в листах** | lesson series + worksheets |
| **AI под капотом** | не раскрыто | не раскрыто | **Claude (Anthropic)** | не раскрыто |
| **Главный рынок** | RU EdTech (учителя) | US K-12 (district deals) | US K-12 (B2C freemium) | UK/EU/US K-12 |
| **Тариф бесплатный** | 2 генерации разово | 80+ tools unlimited | 60+ tools unlimited, **NO worksheet gen** | неизвестно |
| **Минимальный платный** | 490 ₽/мес (≈$5) | $8.33/мес (annual) | $8.99/мес или $3.33 (annual) | скрыто |
| **Топ-тариф** | 1 790 ₽/мес (≈$18) | Custom Enterprise | $8.99 + school volume | скрыто |
| **Регистрация** | email/Яндекс/VK | email/Google/Microsoft | email (можно без акк preview) | email |
| **Wizard генерации** | да (тип материала + промпт + кнопки-фильтры) | да (topic + reading level) | да (topic + grade band + style + question types) | да (topic + способ старта) |
| **Визуальные элементы в листе** | да (32 стиля оформления, но без графиков) | нет | **✓ АВТО bar graphs/diagrams** | да (через lessons) |
| **Онлайн-формы для учеников** | да | да (через LMS) | нет | нет |
| **Проверка работ по фото** | да | нет | нет | нет |
| **ИИ-чат «коллега»** | да (знает ФГОС/ФИПИ 2026) | да (Raina) | нет | нет |
| **Банк материалов от учителей** | да (1 085 листов, 20-150₽) | нет | нет | да (lesson/sheet library) |
| **SEO-карта** | да (`/razbor/<слово>` × сотни) + банк | нет | **да (50+ страниц)** `/free/worksheet-generator/...` | частичная (`/library/...`) |
| **District procurement** | нет | да (20+ districts) | да (школьный план, 30-д trial 50 учителей) | нет |
| **LMS-интеграции** | минимальные | SSO + Canvas/ClassLink/Schoology/Clever | нет | нет |
| **Compliance** | 152-ФЗ | SOC-2/FERPA/COPPA/GDPR | FERPA/COPPA | UK GDPR |
| **Lesson series (unit planner)** | нет | нет | да (AI Lesson Planner) | **✓ главная фишка** |
| **Дифференциация** | частично (фильтры сложности) | да | да (word banks) | да (per class) |
| **Метрики** | 110k учителей | не раскрыто | 10k учителей | 1M+ teachers |
| **K-12 / RU EdTech** | RU | US K-12 | US K-12 | UK/EU/US |

---

## 6. Выводы для ЛистAI

### 6.1 Критичные наблюдения

1. **EasyClass — это «наш конкурент», если бы мы были в US.** Та же SEO-стратегия (страницы по `предмет/класс/тип`), тот же freemium с paywall на основной фиче, но с SVG-графиками. **Мы НЕ конкурируем напрямую с ними** (US vs RU), но их SEO-структура — это **шаблон для подражания**.
2. **«Главная фишка» у каждого своя**, и **не одна фишка — это маркетинговый риск**:
   - Обучай: фото-проверка
   - MagicSchool: 80+ tools + district deals
   - EasyClass: bar graphs в листах
   - Chalkie: lesson series
   - **ЛистAI**: только рабочие листы — этого мало для дифференциации
3. **Все четверо копируют «differentiated for your class»** — это новая норма в EdTech AI, не фишка.

### 6.2 Конкретные фишки, которые нам нужны (по приоритету)

| # | Фишка | Трудоёмкость | Ожидаемый эффект |
|---|---|---|---|
| 1 | **SVG-графики в листах** (EasyClass-style) | высокая (Claude → SVG pipeline) | **огромный** — это главный moat |
| 2 | **Дифференцированные версии** (1 клик «проще/сложнее») | средняя | высокий |
| 3 | **5 шаблонов оформления** (визуальный стиль листа) | низкая | средний |
| 4 | **PDF экспорт с автоматическим ключом ответов** | низкая (у нас уже есть PDF, нужен ответ-ключ) | высокий |
| 5 | **Превью БЕЗ регистрации** (как EasyClass) | низкая | средний (конверсия) |
| 6 | **Банк материалов от учителей** (как Обучай, с монетизацией) | средняя (нужна модерация) | долгосрочно огромный |

### 6.3 Чего НЕ делать

- ❌ Не пытаться конкурировать с MagicSchool на US-рынке (district deals — это отдельная история на годы)
- ❌ Не публиковать тарифы по US-модели ($8.99/мес) для RU — у нас другая вилка (490 ₽ ≈ $5 — оптимально для RU учителя)
- ❌ Не копировать 80+ tools — это не наш масштаб и не наш замысел. SEO-фокус — наш козырь.

### 6.4 Что делать дальше

**Самое ценное прямо сейчас — взять 5 тем из нашей SEO-карты и сгенерить листы у нас + у Обучай + у EasyClass (если получится с email), глазами сравнить качество.** Это даст **объективную** оценку где мы стоим.

**Второе — зарегистрироваться на EasyClass через реальный email и проверить качество выдачи.** EasyClass — это ближайший аналог нашего продукта, и их подход (Claude AI, SVG-графики) — это стандарт, который мы должны знать изнутри.

---

## 7. Что нужно от тебя

### Email-блокер — снова

Все 3 сервиса режут temp-домены (проверено: mail.tm `uberip.com`, guerrillamail `guerrillamailblock.com`, dropmail требует токен). Без реального email в кабинет не войти, а там прячется:
- Реальный UI генератора
- Качество выдачи (по листу можно понять, кто реально сильнее)
- Paywall-модалка
- Скорость TTI

**Варианты:**
- **А)** Дай email + пароль (на новый Google или существующий — твой выбор)
- **Б)** Сам зарегайся на Обучай + MagicSchool + EasyClass, пройди воронку до paywall, скинь скриншоты кабинета + одного сгенерированного листа от каждого
- **В)** Пропустить hands-on, довольствуемся тем что есть (~85% нужной инфы)

### Что из этого хочешь

- ☐ Email (A)
- ☐ Сам зарегаюсь (B)
- ☐ Пропустить (C)

---

## 8. Скриншоты (12 шт., все в `_screenshots/`)

| # | Файл | Размер | Что |
|---|---|---|---|
| 1 | obuchai-01-landing.png | 115K | Обучай: лендинг |
| 2 | obuchai-02-worksheets.png | 79K | Обучай: /worksheets |
| 3 | obuchai-03-pricing.png | 106K | Обучай: тарифы |
| 4 | obuchai-04-presentations.png | 303K | Обучай: /prezentacii |
| 5 | obuchai-05-photo-check.png | 228K | Обучай: ИИ-проверка фото |
| 6 | obuchai-06-bank-materials.png | 762K | Обучай: Банк (1085 листов) |
| 7 | magicschool-01-worksheet-gen.png | 431K | MagicSchool: worksheet generator |
| 8 | magicschool-02-pricing.png | 432K | MagicSchool: тарифы |
| 9 | magicschool-03-home.png | 1.1M | MagicSchool: главная |
| 10 | easyclass-01-worksheet-gen.png | 629K | EasyClass: worksheet generator |
| 11 | easyclass-02-pricing.png | 169K | EasyClass: тарифы |
| 12 | easyclass-03-features.png | 509K | EasyClass: 60+ tools |
| 13 | chalkie-01-home.png | 634K | Chalkie: главная |

**Все скриншоты — fullPage 1440×900.** Кабинеты и paywall — за логином.

---

## 9. Кредиты и стоимость

- 8× `firecrawl_scrape` + 2× `firecrawl_interact` (351 сек сессии) + ~3 retry на протухшие скриншоты
- **~16 кредитов** на 4 конкурентов
- Из них: Обучай 6, MagicSchool 4, EasyClass 4, Chalkie 1, retry 1

---

**Дата:** 2026-09-25
**Где живёт:** `/Users/ivanlusnikov/Documents/nameone/.audit/competitors/2026-09-25-hands-on-teardown-3-companies.md`
**Связанные:** `2026-09-25-competitive-map.md` (общий обзор), `2026-09-25-hands-on-teardown.md` (детальный по Обучай+MagicSchool)
