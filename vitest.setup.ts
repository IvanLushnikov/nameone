import '@testing-library/jest-dom';

// jsdom не реализует ResizeObserver, а его использует WorksheetScale —
// обёртка, которая масштабирует лист A4 (`.worksheet-page`, 210mm) под
// ширину контейнера, иначе на iPad лист уезжает за экран. Без стаба любой
// рендер превью (worksheet / lesson-plan / ktp) падает в useEffect с
// "ResizeObserver is not defined".
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom реализует Blob, но БЕЗ методов arrayBuffer() / text() / stream() —
// они есть в каждом реальном браузере. Из-за этого экспортные тесты падали:
// materials-zip и cards-docx вызывают arrayBuffer(), а JSZip дополнительно
// читает поток через stream().
//
// Лечится подменой класса целиком, а не добавлением методов по одному: jsdom-
//овский Blob настолько неполон, что любая библиотека натыкается на очередной
// недостающий метод. Нативный Blob из node:buffer реализует весь интерфейс
// спецификации (arrayBuffer, text, stream, slice, bytes) и ведёт себя так же,
// как в браузере.
//
// Подменяем ТОЛЬКО если jsdom-овский неполон — когда jsdom это починит,
// нативный Blob и так не понадобится.
if (typeof globalThis.Blob !== "undefined" && typeof globalThis.Blob.prototype.stream !== "function") {
  const { Blob: NodeBlob } = await import("node:buffer");
  globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
}
