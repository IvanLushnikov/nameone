import { TotpSettings } from "@/components/superpower/TotpSettings";
import { AdminList } from "@/components/superpower/AdminList";

/**
 * Безопасность суперадминки.
 *
 * Отдельная страница, а не вкладка в «Деньгах»: настройка доступа и просмотр
 * выручки — разные вещи, и смешивать их в одном экране не стоит ни пользователю,
 * ни тому, кто будет читать журнал обращений после инцидента.
 *
 * ПОРЯДОК БЛОКОВ. Сначала «кто может заходить» — это вопрос, который человек
 * задаёт себе первым, открывая безопасность. Код подтверждения ниже: он
 * настраивает каждый для себя, и для этого нужно уже быть внутри.
 */
export default function SuperpowerSecurityPage() {
  return (
    <div className="space-y-6">
      <AdminList />
      <TotpSettings />
    </div>
  );
}
