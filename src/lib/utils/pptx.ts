/**
 * Q1-2027: минимальный PPTX-генератор на базе JSZip (browser-friendly).
 *
 * Почему не pptxgenjs: у пакета ESM-сборка тянет node:https → webpack падает
 * на статическом экспорте (output: "export" + Next 14). Решение — собрать
 * PPTX руками: ZIP из ~5 XML-файлов (минимальная спецификация OOXML).
 *
 * Результат открывается в PowerPoint, LibreOffice Impress, Google Slides.
 *
 * Контракт: generatePptx(presentation) → Promise<Blob>
 *   + pptxFilename(presentation) → string
 *   + downloadBlob(blob, filename) (ре-экспорт из utils/docx.ts)
 */

import JSZip from "jszip";
import type { Presentation, Slide, SlideKind } from "@/lib/types";

const SLIDE_W = 9144000; // 10" в EMU
const SLIDE_H = 6858000; // 7.5"

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Слайд с заголовком + буллетами. */
function slideXml(slide: Slide, idx: number): string {
  const bullets = (slide.bullets ?? []).slice(0, 6).map(
    (b) => `<a:p><a:r><a:rPr lang="ru-RU"/><a:t>${xmlEscape(b)}</a:t></a:r></a:p>`
  ).join("");
  const notes = slide.notes
    ? `<p:notes>
        <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:rPr lang="ru-RU"/><a:t>${xmlEscape(slide.notes)}</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:notes>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="274680"/><a:ext cx="${SLIDE_W - 914400}" cy="900000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ru-RU" sz="3200" b="1"/><a:t>${xmlEscape(slide.title)}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="1400000"/><a:ext cx="${SLIDE_W - 914400}" cy="${SLIDE_H - 1600000}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>
          ${bullets}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  ${notes}
</p:sld>`;
}

function contentTypesXml(count: number): string {
  let overrides = "";
  for (let i = 1; i <= count; i++) {
    overrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${overrides}
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
}

function presentationXml(count: number): string {
  let sldIdList = "";
  for (let i = 1; i <= count; i++) {
    sldIdList += `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIdList}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRelsXml(count: number): string {
  let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
  for (let i = 1; i <= count; i++) {
    rels += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

export async function generatePptx(presentation: Presentation): Promise<Blob> {
  const zip = new JSZip();
  const slides: Slide[] = presentation.slides.length > 0 ? presentation.slides : [
    { kind: "title" as SlideKind, title: presentation.title, bullets: [`${presentation.subject} · ${presentation.grade} класс`] },
  ];
  const count = slides.length;

  zip.file("[Content_Types].xml", contentTypesXml(count));
  zip.folder("_rels")!.file(".rels", rootRelsXml());
  zip.folder("ppt")!.file("presentation.xml", presentationXml(count));
  zip.folder("ppt")!.folder("_rels")!.file("presentation.xml.rels", presentationRelsXml(count));
  zip.folder("ppt")!.folder("slideMasters")!.file("slideMaster1.xml", SLIDE_MASTER_XML);
  zip.folder("ppt")!.folder("slideMasters")!.folder("_rels")!.file("slideMaster1.xml.rels", SLIDE_MASTER_RELS);

  const slidesFolder = zip.folder("ppt")!.folder("slides")!;
  slides.forEach((slide, i) => {
    slidesFolder.file(`slide${i + 1}.xml`, slideXml(slide, i + 1));
  });

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export function pptxFilename(presentation: Presentation): string {
  return `${presentation.subject}-${presentation.grade}kl-${presentation.topic}.pptx`
    .toLowerCase()
    .replace(/\s+/g, "-");
}

// re-export для удобства UI
export { downloadBlob } from "./docx";
