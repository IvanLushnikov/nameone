import { TotpSettings } from "@/components/superpower/TotpSettings";

/**
 * Безопасность суперадминки.
 *
 * Отдельная страница, а не вкладка в «Деньгах»: настройка доступа и просмотр
 * выручки — разные вещи, и смешивать их в одном экране не стоит ни пользователю,
 * ни тому, кто будет читать журнал обращений после инцидента.
 */
export default function SuperpowerSecurityPage() {
  return <TotpSettings />;
}