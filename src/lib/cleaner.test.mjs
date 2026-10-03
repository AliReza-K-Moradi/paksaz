import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  analyzeFile,
  cleanFile,
  CleanerError,
  getDigitIssueCount,
  getDigitIssueExamples,
  previewCleaning,
} from "./cleaner.ts";

const csvFile = (content, name = "contacts.csv") =>
  new File([content], name, { type: "text/csv" });

test("CSV analysis finds safe fixes and keeps row deletion opt-in", async () => {
  const file = csvFile(
    "نام,موبایل,کد\n" +
      '" علي  كريمي ",+98 912 345 6789,۱۲۳\n' +
      '" علي  كريمي ",+98 912 345 6789,۱۲۳\n' +
      ",,\n" +
      "خراب,123,۴۵۶",
  );
  const analysis = await analyzeFile(file);
  const counts = Object.fromEntries(analysis.issues.map((issue) => [issue.id, issue.count]));
  assert.equal(counts.mobileNumbers, 2);
  assert.equal(counts.invalidMobileRows, 1);
  assert.equal(counts.emptyRows, 1);
  assert.equal(counts.duplicateRows, 1);
  assert.equal(getDigitIssueCount(analysis, "latin"), 3);

  const defaultPreview = previewCleaning(analysis);
  assert.equal(defaultPreview.removedRows, 0);
  assert.equal(defaultPreview.remainingRows, 5);
  assert.ok(defaultPreview.changedCells >= 6);

  const clean = await cleanFile(analysis);
  const output = await clean.blob.text();
  assert.match(output, /علی کریمی,09123456789,123/);
  assert.match(output, /خراب,123,456/);
  assert.equal((output.match(/علی کریمی/g) ?? []).length, 2);
});

test("destructive choices remove only identified rows", async () => {
  const analysis = await analyzeFile(
    csvFile("نام;موبایل\nعلی;09123456789\nعلی;09123456789\n;\nناقص;123"),
  );
  const options = { emptyRows: true, duplicateRows: true, invalidMobileRows: true };
  const preview = previewCleaning(analysis, options);
  assert.equal(preview.removedRows, 3);
  assert.deepEqual(preview.removalBreakdown, {
    emptyRows: 1,
    duplicateRows: 1,
    invalidMobileRows: 1,
  });
  const result = await cleanFile(analysis, options);
  const output = await result.blob.text();
  assert.match(output, /نام;موبایل\r\nعلی;09123456789/);
  assert.doesNotMatch(output, /ناقص/);
});

test("Persian digit direction leaves mobile columns in Latin digits", async () => {
  const analysis = await analyzeFile(csvFile("موبایل,کد\n+989123456789,123"));
  const result = await cleanFile(analysis, { digitMode: "persian" });
  assert.equal(getDigitIssueCount(analysis, "persian"), 1);
  assert.equal(getDigitIssueCount(analysis, "latin"), 0);
  assert.equal(getDigitIssueExamples(analysis, "persian")[0].before, "123");
  assert.equal(getDigitIssueExamples(analysis, "persian")[0].after, "۱۲۳");
  assert.match(await result.blob.text(), /09123456789,۱۲۳/);
});

test("Arabic digits have examples in either conversion direction", async () => {
  const analysis = await analyzeFile(csvFile("کد\n١٢٣"));
  assert.equal(getDigitIssueCount(analysis, "latin"), 1);
  assert.equal(getDigitIssueCount(analysis, "persian"), 1);
  assert.equal(getDigitIssueExamples(analysis, "latin")[0].after, "123");
  assert.equal(getDigitIssueExamples(analysis, "persian")[0].after, "۱۲۳");
});

test("XLSX round trip includes all sheets", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["موبایل"], [9123456789]]), "مشتریان");
  const salesSheet = XLSX.utils.aoa_to_sheet([["نام", "تاریخ"], ["علي", 45123]]);
  salesSheet.B2.z = "yyyy-mm-dd";
  XLSX.utils.book_append_sheet(book, salesSheet, "فروش");
  book.Workbook = { Sheets: [{ name: "مشتریان", Hidden: 0 }, { name: "فروش", Hidden: 1 }] };
  const source = XLSX.write(book, { bookType: "xlsx", type: "array" });
  const analysis = await analyzeFile(new File([source], "sample.xlsx"));
  assert.equal(analysis.sheets.length, 2);
  const result = await cleanFile(analysis);
  const exported = XLSX.read(await result.blob.arrayBuffer(), { type: "array", cellNF: true });
  assert.deepEqual(exported.SheetNames, ["مشتریان", "فروش"]);
  assert.equal(exported.Sheets["مشتریان"].A2.v, "09123456789");
  assert.equal(exported.Sheets["فروش"].A2.v, "علی");
  assert.equal(exported.Sheets["فروش"].B2.z, "yyyy-mm-dd");
  assert.equal(exported.Workbook.Sheets[1].Hidden, 1);
});

test("invalid files produce actionable errors", async () => {
  await assert.rejects(() => analyzeFile(csvFile("abc", "notes.txt")), {
    code: "INVALID_TYPE",
  });
  await assert.rejects(() => analyzeFile(csvFile("")), { code: "EMPTY_FILE" });
  await assert.rejects(() => analyzeFile(csvFile("\"broken")), { code: "PARSE_ERROR" });
  await assert.rejects(() => analyzeFile(csvFile(",\n,\n")), { code: "NO_DATA" });
  await assert.rejects(() => analyzeFile(new File(["not a workbook"], "broken.xlsx")), {
    code: "PARSE_ERROR",
  });
  assert.equal(new CleanerError("NO_DATA", "message").name, "CleanerError");
});

test("formula workbooks are stopped before a lossy export", async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["مقدار", "نتیجه"], [2, 4]]);
  sheet.B2 = { t: "n", f: "A2*2", v: 4 };
  XLSX.utils.book_append_sheet(book, sheet, "فرمول");
  const source = XLSX.write(book, { bookType: "xlsx", type: "array" });
  await assert.rejects(() => analyzeFile(new File([source], "formulas.xlsx")), {
    code: "UNSUPPORTED_FORMULAS",
  });
});
