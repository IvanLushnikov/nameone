/**
 * Готов ли вход по ссылке из письма (magic link).
 *
 * ✅ 2026-10-07 — true. Все три условия из чеклиста ниже выполнены:
 *   1. uchlist.ru куплен и делегирован на Cloudflare (NS elinore/toby.ns),
 *      привязан как custom domain к Pages-проекту listai-prototype.
 *   2. Домен добавлен в Resend и перешёл в статус `verified`: DNS-записи
 *      dkim.resend / send (MX) / send (TXT SPF) / rsend лежат в зоне
 *      Cloudflare с proxied=false (оранжевое облако ломает верификацию).
 *   3. Живая проверка: POST /api/auth/magic-link возвращает
 *      {"ok":true,"sent":true} — письмо реально уходит.
 *
 * История: флаг стоял в false с 3 октября, пока домен не был куплен и Resend
 * отвечал 403 «domain is not verified». Форма «Email → Получить ссылку» была
 * обещанием, которое нельзя выполнить: учитель вводил адрес, видел
 * «Проверьте почту» и ждал письма, которого не существовало. Поэтому вместо
 * формы показывалось честное объяснение.
 *
 * ⚠️ Если письма перестанут уходить — сначала проверь Resend, потом смотри
 * флаг. Проверка: python3 scripts/check-resend-domain.py
 */
export const MAGIC_LINK_READY = true;
