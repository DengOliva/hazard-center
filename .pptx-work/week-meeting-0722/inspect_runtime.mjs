import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = "C:/Users/Yucon/Documents/数据库/.pptx-work/week-meeting-0722/source.pptx";
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const slide = presentation.slides.getItem(2);
console.log("slides", presentation.slides.items.length);
console.log("masters", presentation.masters.items.length, "layouts", presentation.layouts.items.length);
for (const [index, shape] of slide.shapes.items.entries()) {
  const position = shape.position ?? shape.frame;
  const text = shape.text ? String(shape.text).slice(0, 80) : "";
  console.log(index, shape.constructor?.name, shape.name, JSON.stringify(position), text, JSON.stringify(shape.text?.style), JSON.stringify(shape.toProto?.()));
}
const dense = presentation.slides.getItem(7);
console.log("slide8 tables", dense.tables?.items?.length);
for (const [index, table] of (dense.tables?.items ?? []).entries()) {
  console.log("table", index, JSON.stringify(table.position), table.name);
}
