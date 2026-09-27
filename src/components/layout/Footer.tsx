import Link from "next/link";
import { Logo } from "@/components/shared/Logo";
import { Mail, MessageCircle } from "lucide-react";

const cols = [
  {
    title: "Продукт",
    links: [
      { href: "/constructor", label: "Генератор листов" },
      { href: "/oge", label: "ОГЭ / ЕГЭ режим" },
      { href: "/pricing", label: "Тарифы" },
      { href: "/dashboard", label: "Личный кабинет" },
    ],
  },
  {
    title: "Предметы",
    links: [
      { href: "/subject/math", label: "Математика" },
      { href: "/subject/russian", label: "Русский язык" },
      { href: "/subject/english", label: "Английский" },
      { href: "/subject", label: "Все предметы" },
    ],
  },
  {
    title: "Документы",
    links: [
      { href: "/legal/offer", label: "Публичная оферта" },
      { href: "/legal/privacy", label: "Политика конфиденциальности" },
      { href: "/legal/terms", label: "Пользовательское соглашение" },
      { href: "/legal/cookies", label: "Использование cookies" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-warm-100 border-t border-warm-200 mt-20">
      <div className="container-tight py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 text-sm text-warm-600 max-w-xs leading-relaxed">
              AI-генератор рабочих листов и тестов по ФГОС. Готовый PDF за 30 секунд для репетиторов, родителей и школьников.
            </p>
            <div className="mt-5 flex gap-2">
              <a
                href="mailto:hello@listai.ru"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-white border border-warm-200 text-warm-700 hover:bg-warm-50 text-sm"
              >
                <Mail className="w-4 h-4" />
                hello@listai.ru
              </a>
              <a
                href="https://t.me/listai"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-white border border-warm-200 text-warm-700 hover:bg-warm-50 text-sm"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="w-4 h-4" />
                Telegram
              </a>
            </div>
          </div>

          {cols.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-warm-950 mb-3">{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-warm-600 hover:text-warm-950 transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-warm-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-warm-500">
          <p>© 2026 ЛистAI. Все права защищены. Сделано с ❤ для учителей и родителей.</p>
          <p>Работает на AI · Cloudflare Pages</p>
        </div>
      </div>
    </footer>
  );
}