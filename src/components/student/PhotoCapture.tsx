"use client";

/**
 * Кнопка «Сфотографировать» для одного задания (TZ-28).
 *
 * Четыре состояния вместо одной кнопки, потому что телефон теряет сеть в классе:
 *   idle     — «Сфотографировать»;
 *   working  — «Загружаем…», кнопка заблокирована: два кадра подряд отправляют
 *              два фото, а учитель увидит «переснято дважды» вместо ответа;
 *   failed   — снимок НЕ выброшен: лежит в состоянии, под ним «Повторить», и
 *              попытка уходит сама, как только браузер скажет, что сеть есть;
 *   error    — то же самое, но повтор только по нажатию.
 *
 * ─── Почему снимок нельзя отбрасывать ───
 * Ученик сфотографировал тетрадь, нажал «Сфотографировать» — и в этот момент
 * выключился Wi-Fi. Если снимок выбросить, ученику придётся снова искать тетрадь
 * и снова попадать в кадр, а учитель увидит «пустое» задание без объяснения.
 * Поэтому единственный дорогой объект (Blob) переживает обрыв, а кнопка
 * «повторить» появляется сама.
 *
 * `capture="environment"` открывает заднюю камеру сразу. Без него Android
 * показывает выбор галереи, и ученик в первый раз выбирает «неправильное»
 * фото старой контрольной.
 *
 * Загрузку передаёт родитель (`FormRunner`) колбэком: компонент не должен знать
 * ни про токен ученика, ни про код, ни куда страница уйдёт дальше.
 */

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { compressPhoto } from "./photo";

export function PhotoCapture({
  taskNumber,
  uploaded,
  onUpload,
  onError,
}: {
  taskNumber: number;
  /** Уже есть загруженное фото для этого задания? */
  uploaded: boolean;
  /** Загрузить сжатый Blob и отдать ключ, либо признать ошибку. */
  onUpload: (taskNumber: number, blob: Blob) => Promise<{ ok: true; photoR2Key: string } | { ok: false }>;
  onError?: (message: string) => void;
}) {
  const [working, setWorking] = React.useState(false);
  /**
   * Снимок, который не ушёл. Хранится здесь, а не в props: пока он не принят
   * сервером, потерять его — значит заставить ученика фотографировать заново.
   */
  const [pending, setPending] = React.useState<Blob | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const send = React.useCallback(
    async (blob: Blob) => {
      setWorking(true);
      try {
        const res = await onUpload(taskNumber, blob);
        if (res.ok) {
          setPending(null);
          return true;
        }
        onError?.("Фото не отправилось — проверьте интернет и попробуйте ещё раз");
        return false;
      } finally {
        setWorking(false);
      }
    },
    [onUpload, onError, taskNumber],
  );

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Сбрасываем value сразу: иначе повторный выбор того же же файла не даст
    // события change, и «попробовать ещё раз» молча ничего не сделает.
    event.target.value = "";
    if (!file) return;

    // Сжатие здесь, а не в обработчике родителя: это обязательная часть
    // «сфотографировать», а не забота вызывающего кода.
    const compressed = (await compressPhoto(file)) ?? file;
    // Новый снимок ЗАМЕНЯЕТ неотправленный: один ученик — одно фото на задание.
    setPending(compressed);
    await send(compressed);
  };

  // Сеть вернулась — пробуем сами, без лишнего нажатия. Один обработчик на всё
  // окно страницы: браузер отдаёт `online` и на соседних заданиях.
  React.useEffect(() => {
    const onOnline = () => {
      setPending((current) => {
        if (current) void send(current);
        return current;
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [send]);

  return (
    <div className="mt-3" data-testid={`photo-capture-${taskNumber}`}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => void handleChange(e)}
        data-testid={`photo-input-${taskNumber}`}
      />
      <Button
        type="button"
        variant={uploaded ? "secondary" : "accent"}
        size="md"
        fullWidth
        loading={working}
        onClick={() => inputRef.current?.click()}
        data-testid={`photo-button-${taskNumber}`}
      >
        {uploaded ? "Переснять фото" : "Сфотографировать"}
      </Button>
      {pending && (
        <div className="mt-2" data-testid={`photo-failed-${taskNumber}`}>
          <p className="text-xs text-[color:var(--text-muted)]">
            Фото снято, но отправить не вышло. Оно не потеряно — нажмите «Повторить».
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-1.5"
            loading={working}
            onClick={() => void send(pending)}
            data-testid={`photo-retry-${taskNumber}`}
          >
            Повторить отправку фото
          </Button>
        </div>
      )}
      {uploaded && (
        <p className="mt-1.5 text-xs text-[color:var(--text-muted)]">
          Фото прикреплено. Ответ можно не вводить — учитель увидит снимок.
        </p>
      )}
    </div>
  );
}