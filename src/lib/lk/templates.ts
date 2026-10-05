/**
 * Сохранение шаблона из любого артефакта (ТЗ-21, блок 2).
 *
 * Проблема, которую это чинит: `addTemplate` вызывался ровно из одного места
 * в продукте — со страницы превью, а в превью можно было попасть только из
 * избранного. Входной точки у функции фактически не было, и вкладка «Шаблоны»
 * выглядела рабочей, оставаясь пустой.
 *
 * Теперь saves работают из двух мест: конструктор (сразу после генерации) и
 * превью. Запись идёт на устройство ВСЕГДА, а на сервер — дополнительно,
 * когда есть сессия. Если сервер недоступен, шаблон всё равно появляется
 * в кабинете: учитель не теряет то, что сохранил.
 */

import {
  addTemplate,
  getProfile,
  removeTemplate,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import { createTemplateRemote, deleteTemplateRemote } from "./materials-api";
import type { Difficulty, SubjectSlug, UserTemplate } from "@/lib/types";

/**
 * Выводит параметры шаблона из артефакта любого типа.
 *
 * Для рабочего листа это точное соответствие (тема, сложность, число заданий);
 * для остальных типов — best-effort по их собственным полям. У КТП поля
 * `topic` нет вовсе, поэтому темой становится заголовок.
 */
export function templateFromArtifact(artifact: FavoriteArtifact): UserTemplate {
  let difficulty: Difficulty = "medium";
  let count = 0;
  let topic = artifact.title;

  if ("tasks" in artifact) {
    difficulty = artifact.difficulty;
    count = artifact.tasks.length;
    topic = artifact.topic;
  } else if ("stages" in artifact) {
    count = artifact.stages.length;
    topic = artifact.topic;
  } else if ("slides" in artifact) {
    count = artifact.slides.length;
    topic = artifact.topic;
  } else if ("weeks" in artifact) {
    count = artifact.totalHours;
  }

  return {
    id: `tpl_${Math.random().toString(36).slice(2, 10)}`,
    name: artifact.title,
    subject: artifact.subject as SubjectSlug,
    grade: artifact.grade,
    topic,
    difficulty,
    count,
  };
}

export interface SaveTemplateResult {
  /** Шаблон, который попал в локальный список и, возможно, на сервер. */
  template: UserTemplate;
  /** true = шаблон записался на сервер и переедет на другое устройство. */
  synced: boolean;
  /** true = запрос к серверу был, но не прошёл. */
  serverFailed: boolean;
}

/**
 * Сохранить артефакт как шаблон: устройство + сервер (если есть сессия).
 *
 * Наружу не бросает — локальная запись всегда успевает первой и является
 * гарантией того, что учитель не потерял шаблон.
 */
export async function saveTemplate(
  artifact: FavoriteArtifact,
): Promise<SaveTemplateResult> {
  const template = templateFromArtifact(artifact);
  addTemplate(template);

  if (getProfile() === null) {
    return { template, synced: false, serverFailed: false };
  }

  const res = await createTemplateRemote({
    name: template.name,
    subject: template.subject,
    grade: template.grade,
    topic: template.topic,
    difficulty: template.difficulty,
    count: template.count,
  });

  if (res.ok) {
    return { template: res.data, synced: true, serverFailed: false };
  }
  return { template, synced: false, serverFailed: true };
}

/**
 * Удалить шаблон с устройства и, если он был серверным, с сервера.
 *
 * Идентификаторы серверных шаблонов начинаются с `tpl_` и совпадают с
 * локальными (бэк возвращает присланный id), поэтому одного вызова хватает;
 * попытка удалить несуществующий на сервере шаблон молча игнорируется —
 * локальный список при этом чистится в любом случае.
 */
export async function removeTemplateEverywhere(id: string): Promise<void> {
  removeTemplate(id);
  if (getProfile() === null) return;
  await deleteTemplateRemote(id);
}
