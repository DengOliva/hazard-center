import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = "C:/Users/Yucon/Documents/数据库/体系部门会议材料7.22_美化版.pptx";
const outDir = "C:/Users/Yucon/Documents/数据库/.pptx-work/week-meeting-0722/final-render";
const layoutDir = "C:/Users/Yucon/Documents/数据库/.pptx-work/week-meeting-0722/final-layout";
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(layoutDir, { recursive: true });

const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
for (let i = 0; i < presentation.slides.items.length; i += 1) {
  const slide = presentation.slides.getItem(i);
  const png = await presentation.export({ slide, format: "png", scale: 1.5 });
  await fs.writeFile(
    `${outDir}/slide-${String(i + 1).padStart(2, "0")}.png`,
    new Uint8Array(await png.arrayBuffer()),
  );
  const layout = await presentation.export({ slide, format: "layout" });
  await fs.writeFile(
    `${layoutDir}/slide-${String(i + 1).padStart(2, "0")}.layout.json`,
    `${JSON.stringify(layout, null, 2)}\n`,
    "utf8",
  );
}
const montage = await presentation.export({ format: "png", montage: true, scale: 0.75 });
await fs.writeFile(
  "C:/Users/Yucon/Documents/数据库/.pptx-work/week-meeting-0722/final-montage.png",
  new Uint8Array(await montage.arrayBuffer()),
);
console.log(`rendered ${presentation.slides.items.length} slides`);
