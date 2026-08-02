import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const sourcePath = "C:/Users/Yucon/Documents/数据库/.pptx-work/week-meeting-0722/template-starter.pptx";
const outputPath = "C:/Users/Yucon/Documents/数据库/体系部门会议材料7.22_美化版.pptx";

function addText(slide, name, text, position, style) {
  const box = slide.shapes.add({
    geometry: "textbox",
    name,
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  box.text = text;
  box.text.style = style;
  return box;
}

const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));

function sectionTitle(pageNumber) {
  if (pageNumber === 2) return "目录";
  if (pageNumber >= 3 && pageNumber <= 14) return "一、部门任务跟踪";
  if (pageNumber >= 15 && pageNumber <= 17) return "二、上周主要工作";
  if (pageNumber === 18) return "三、下周主要工作";
  if (pageNumber === 19) return "四、近期典型事件经验反馈";
  if (pageNumber >= 20 && pageNumber <= 21) return "五、其他任务项及宣贯";
  return "";
}

for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.getItem(index);
  const isCover = index === 0;
  const isClosing = index === presentation.slides.items.length - 1;

  slide.background.fill = {
    type: "gradient",
    gradientKind: "linear",
    angleDeg: 90,
    stops: [
      { offset: 0, color: "#F7FAFD" },
      { offset: 100000, color: "#EAF1F8" },
    ],
  };

  if (index === 7 && slide.tables?.items?.length === 3) {
    const [leftTable, rightTable, summaryTable] = slide.tables.items;
    for (let rowIndex = 0; rowIndex < leftTable.rows.length; rowIndex += 1) {
      leftTable.rows[rowIndex].height = rowIndex === 0 ? 34 : 19;
      for (let columnIndex = 0; columnIndex < leftTable.columns.length; columnIndex += 1) {
        const cell = leftTable.getCell(rowIndex, columnIndex);
        const value = String(cell.text);
        cell.text = value;
        cell.text.style = {
          fontSize: rowIndex === 0 ? 14 : 11,
          bold: true,
          color: value.trim() === "否" ? "#FF0000" : "#000000",
          alignment: "center",
          verticalAlignment: "middle",
          autoFit: "shrinkText",
          typeface: "Microsoft YaHei",
        };
      }
    }
    for (let rowIndex = 0; rowIndex < rightTable.rows.length; rowIndex += 1) {
      rightTable.rows[rowIndex].height = rowIndex === 0 ? 34 : 54;
      for (let columnIndex = 0; columnIndex < rightTable.columns.length; columnIndex += 1) {
        const cell = rightTable.getCell(rowIndex, columnIndex);
        const value = String(cell.text);
        cell.text = value;
        cell.text.style = {
          fontSize: rowIndex === 0 ? 14 : 12,
          bold: true,
          color: value.trim() === "否" ? "#FF0000" : "#000000",
          alignment: "center",
          verticalAlignment: "middle",
          autoFit: "shrinkText",
          typeface: "Microsoft YaHei",
        };
      }
    }
    summaryTable.rows[0].height = 20;
    for (let columnIndex = 0; columnIndex < summaryTable.columns.length; columnIndex += 1) {
      const cell = summaryTable.getCell(0, columnIndex);
      const value = String(cell.text);
      cell.text = value;
      cell.text.style = {
        fontSize: 12,
        bold: true,
        color: ["24", "1010"].includes(value.trim()) ? "#FF0000" : "#000000",
        alignment: "center",
        verticalAlignment: "middle",
        typeface: "Microsoft YaHei",
      };
    }
    leftTable.position = { ...leftTable.position, top: 150, height: 414 };
    rightTable.position = { ...rightTable.position, top: 150, height: 412 };
    summaryTable.position = { ...summaryTable.position, top: 626, height: 20 };
  }

  if (isCover || isClosing) {
    const topRail = slide.shapes.add({
      geometry: "rect",
      name: "Template top rail",
      position: { left: 0, top: 0, width: 1280, height: 12 },
      fill: "#123B63",
      line: { style: "solid", fill: "none", width: 0 },
    });
    topRail.bringToFront();

    const cornerMark = slide.shapes.add({
      geometry: "rect",
      name: "Meeting identity",
      position: { left: 1004, top: 34, width: 224, height: 42 },
      fill: "#123B63",
      line: { style: "solid", fill: "none", width: 0 },
    });
    cornerMark.text = "WEEKLY REVIEW  ·  2026.07.22";
    cornerMark.text.style = {
      fontSize: 14,
      bold: true,
      color: "#FFFFFF",
      alignment: "center",
      verticalAlignment: "middle",
      typeface: "Microsoft YaHei",
    };
    cornerMark.bringToFront();
    continue;
  }

  const header = slide.shapes.add({
    geometry: "rect",
    name: "Unified header background",
    position: { left: 0, top: 0, width: 1280, height: 104 },
    fill: {
      type: "gradient",
      gradientKind: "linear",
      angleDeg: 0,
      stops: [
        { offset: 0, color: "#123B63" },
        { offset: 100000, color: "#1B5A86" },
      ],
    },
    line: { style: "solid", fill: "none", width: 0 },
  });
  header.sendToBack();

  const accent = slide.shapes.add({
    geometry: "rect",
    name: "Header accent line",
    position: { left: 0, top: 104, width: 1280, height: 6 },
    fill: "#13B5D1",
    line: { style: "solid", fill: "none", width: 0 },
  });
  accent.bringToFront();

  const leftRail = slide.shapes.add({
    geometry: "rect",
    name: "Section rail",
    position: { left: 0, top: 0, width: 12, height: 104 },
    fill: "#13B5D1",
    line: { style: "solid", fill: "none", width: 0 },
  });
  leftRail.bringToFront();

  for (const shape of slide.shapes.items) {
    const position = shape.position;
    if (!shape.text || !position || position.top >= 100 || position.top < 20) continue;
    shape.text.color = "#FFFFFF";
  }

  addText(
    slide,
    "Unified section title",
    sectionTitle(index + 1),
    { left: 46, top: 28, width: 700, height: 50 },
    {
      fontSize: 27,
      bold: true,
      color: "#FFFFFF",
      alignment: "left",
      verticalAlignment: "middle",
      typeface: "Microsoft YaHei",
    },
  ).bringToFront();

  addText(
    slide,
    "Header English marker",
    "WEEKLY REVIEW",
    { left: 1014, top: 36, width: 210, height: 24 },
    {
      fontSize: 14,
      bold: true,
      color: "#9EDBE8",
      alignment: "right",
      verticalAlignment: "middle",
      typeface: "Arial",
    },
  ).bringToFront();

  addText(
    slide,
    "Header date",
    "2026.07.22  ·  安监部部门会议",
    { left: 896, top: 62, width: 328, height: 22 },
    {
      fontSize: 13,
      color: "#FFFFFF",
      alignment: "right",
      verticalAlignment: "middle",
      typeface: "Microsoft YaHei",
    },
  ).bringToFront();

  addText(
    slide,
    "Footer identity",
    "CGN ENGINEERING  ·  安监部",
    { left: 36, top: 691, width: 330, height: 18 },
    {
      fontSize: 11,
      bold: true,
      color: "#5B7187",
      alignment: "left",
      verticalAlignment: "middle",
      typeface: "Arial",
    },
  ).bringToFront();

  addText(
    slide,
    "Footer page number",
    `${String(index + 1).padStart(2, "0")}  /  ${presentation.slides.items.length}`,
    { left: 1090, top: 689, width: 148, height: 20 },
    {
      fontSize: 12,
      bold: true,
      color: "#123B63",
      alignment: "right",
      verticalAlignment: "middle",
      typeface: "Arial",
    },
  ).bringToFront();
}

const exported = await PresentationFile.exportPptx(presentation);
await exported.save(outputPath);
console.log(outputPath);
