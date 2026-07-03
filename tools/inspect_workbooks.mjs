import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = process.argv.slice(2);

for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheets = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 12000,
  });
  console.log(JSON.stringify({ file, sheets: sheets.ndjson }));
  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange();
    const preview = used
      ? await workbook.inspect({
          kind: "table",
          sheetId: sheet.name,
          range: used.address,
          include: "values,formulas",
          tableMaxRows: 12,
          tableMaxCols: 40,
          tableMaxCellChars: 160,
          maxChars: 22000,
        })
      : null;
    console.log(JSON.stringify({
      sheet: sheet.name,
      usedRange: used?.address ?? null,
      preview: preview?.ndjson ?? null,
    }));
  }
}
