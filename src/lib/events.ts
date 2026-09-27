/**
 * Имя кастомного события, которое выстреливает после успешного login/logout
 * в текущей вкладке, чтобы Header мог перечитать профиль без перезагрузки.
 *
 * Подписки два:
 *   1. `storage` — стандартный cross-tab event, когда вторая вкладка меняет
 *      localStorage.
 *   2. `profile-changed` — CustomEvent, чтобы в той же вкладке триггернуть
 *      обновление без перезагрузки (используется в /auth/callback после
 *      успешного verifyMagicLink и в signOut).
 *
 * Эта константа — общий контракт между Header, AuthCallbackInner и storage.signOut.
 * Вынесена в отдельный модуль, чтобы избежать циклической зависимости
 * storage → Header (Header уже импортирует storage).
 */
export const PROFILE_CHANGED_EVENT = "profile-changed";