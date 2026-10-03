import * as XLSX from "xlsx";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 150_000;
const MAX_CELLS = 2_000_000;
const SAMPLE_LIMIT = 4;

export type FileType = "xlsx" | "csv";
export type DigitMode = "latin" | "persian";
export type IssueId =
  | "mobileNumbers"
  | "invalidMobileRows"
  | "persianLetters"
  | "whitespace"
  | "digits"
  | "emptyRows"
  | "duplicateRows";

export interface CleanOptions {
  mobileNumbers: boolean;
  invalidMobileRows: boolean;
  persianLetters: boolean;
  whitespace: boolean;
  digits: boolean;
  emptyRows: boolean;
  duplicateRows: boolean;
  digitMode: DigitMode;
}

export const DEFAULT_OPTIONS: Readonly<CleanOptions> = Object.freeze({
  mobileNumbers: true,
  invalidMobileRows: false,
  persianLetters: true,
  whitespace: true,
  digits: true,
  emptyRows: false,
  duplicateRows: false,
  digitMode: "latin",
});

export type CellValue = string | number | boolean | Date | null;

export interface IssueExample {
  sheet: string;
  row: number;
  column?: number;
  before: string;
  after?: string;
}

export interface IssueSummary {
  id: IssueId;
  label: string;
  description: string;
  count: number;
  defaultEnabled: boolean;
  destructive: boolean;
  examples: IssueExample[];
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  phoneColumns: number[];
  hidden: boolean;
}

interface ParsedSheet {
  name: string;
  rows: CellValue[][];
  worksheet?: XLSX.WorkSheet;
  hidden: 0 | 1 | 2;
  phoneColumns: Set<number>;
  emptyRows: Set<number>;
  duplicateRows: Set<number>;
  invalidMobileRows: Set<number>;
}

interface ParsedWorkbook {
  sheets: ParsedSheet[];
  delimiter: string;
}

export interface Analysis {
  fileName: string;
  fileType: FileType;
  totalRows: number;
  sheets: SheetSummary[];
  issues: IssueSummary[];
  digitCounts: { latin: number; persian: number };
  digitExamples: { latin: IssueExample[]; persian: IssueExample[] };
  warnings: string[];
  /** Internal snapshot used by previewCleaning and cleanFile. */
  source: ParsedWorkbook;
}

export interface CellChange {
  sheet: string;
  row: number;
  column: number;
  before: string;
  after: string;
}

export interface RemovedRow {
  sheet: string;
  row: number;
  reason: "emptyRows" | "duplicateRows" | "invalidMobileRows";
  preview: string;
}

export interface CleaningPreview {
  changedCells: number;
  removedRows: number;
  remainingRows: number;
  affectedSheets: number;
  changes: CellChange[];
  removedSamples: RemovedRow[];
  removalBreakdown: {
    emptyRows: number;
    duplicateRows: number;
    invalidMobileRows: number;
  };
}

export interface CleanResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  preview: CleaningPreview;
}

export type CleanerErrorCode =
  | "INVALID_TYPE"
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "NO_DATA"
  | "TOO_MANY_ROWS"
  | "PARSE_ERROR"
  | "UNSUPPORTED_FORMULAS";

export class CleanerError extends Error {
  readonly code: CleanerErrorCode;

  constructor(code: CleanerErrorCode, message: string) {
    super(message);
    this.name = "CleanerError";
    this.code = code;
  }
}

const DEFINITIONS: Record<IssueId, Omit<IssueSummary, "id" | "count" | "examples">> = {
  mobileNumbers: {
    label: "شماره موبایل ناهماهنگ",
    description: "شماره‌های معتبر را با ارقام لاتین و پیش‌شماره 09 یکسان می‌کند.",
    defaultEnabled: true,
    destructive: false,
  },
  invalidMobileRows: {
    label: "شماره موبایل نامعتبر",
    description: "ردیف‌های دارای شماره نامعتبر را فقط با انتخاب شما حذف می‌کند.",
    defaultEnabled: false,
    destructive: true,
  },
  persianLetters: {
    label: "حروف عربی در متن",
    description: "ي و ك عربی را به ی و ک فارسی تبدیل می‌کند.",
    defaultEnabled: true,
    destructive: false,
  },
  whitespace: {
    label: "فاصله‌های اضافی",
    description: "فاصله‌های ابتدا، انتها و فاصله‌های پشت‌سرهم را اصلاح می‌کند.",
    defaultEnabled: true,
    destructive: false,
  },
  digits: {
    label: "شکل اعداد",
    description: "شکل اعداد را در متن یکسان می‌کند؛ جهت تبدیل را خودتان انتخاب می‌کنید.",
    defaultEnabled: true,
    destructive: false,
  },
  emptyRows: {
    label: "ردیف خالی",
    description: "ردیف‌هایی را که هیچ داده‌ای ندارند حذف می‌کند.",
    defaultEnabled: false,
    destructive: true,
  },
  duplicateRows: {
    label: "ردیف دقیقاً تکراری",
    description: "از هر ردیف کاملاً یکسان، اولین نمونه را نگه می‌دارد.",
    defaultEnabled: false,
    destructive: true,
  },
};

const ISSUE_ORDER: IssueId[] = [
  "mobileNumbers",
  "invalidMobileRows",
  "persianLetters",
  "whitespace",
  "digits",
  "emptyRows",
  "duplicateRows",
];

const HEADER_MOBILE_PATTERN =
  /(موبایل|موبايل|شماره\s*همراه|تلفن\s*همراه|شماره\s*موبایل|شماره\s*موبايل|mobile|cell\s*phone|cellphone)/i;
const SPACE_PATTERN = /[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g;
const ARABIC_LETTERS_PATTERN = /[يك]/;

function display(value: CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizePersianLetters(value: string): string {
  return value.replace(/ي/g, "ی").replace(/ك/g, "ک");
}

function normalizeWhitespace(value: string): string {
  // Preserve intentional line breaks in addresses and notes.
  return value
    .split(/(\r\n|\r|\n)/)
    .map((part) => (part === "\r\n" || part === "\r" || part === "\n" ? part : part.replace(SPACE_PATTERN, " ").trim()))
    .join("");
}

function toLatinDigits(value: string): string {
  return value.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function toPersianDigits(value: string): string {
  return value.replace(/[0-9\u0660-\u0669]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const value = code >= 0x0660 ? code - 0x0660 : code - 0x30;
    return String.fromCharCode(0x06f0 + value);
  });
}

function normalizeMobile(value: CellValue): string | null {
  const original = toLatinDigits(display(value)).trim();
  if (!original || !/^[+\d\s().\-\u00a0]+$/.test(original)) return null;
  const digits = original.replace(/\D/g, "");
  let canonical: string;
  if (/^09\d{9}$/.test(digits)) canonical = digits;
  else if (/^9\d{9}$/.test(digits)) canonical = `0${digits}`;
  else if (/^989\d{9}$/.test(digits)) canonical = `0${digits.slice(2)}`;
  else if (/^00989\d{9}$/.test(digits)) canonical = `0${digits.slice(4)}`;
  else return null;
  return canonical;
}

function isEmpty(value: CellValue): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isEmptyRow(row: CellValue[]): boolean {
  return row.every(isEmpty);
}

function exactRowKey(row: CellValue[]): string {
  const cells = [...row];
  while (cells.length && isEmpty(cells[cells.length - 1])) cells.pop();
  return JSON.stringify(
    cells.map((cell) =>
      cell instanceof Date ? ["date", cell.toISOString()] : [typeof cell, cell],
    ),
  );
}

function inferPhoneColumns(rows: CellValue[][]): Set<number> {
  const columns = new Set<number>();
  const width = Math.max(0, ...rows.slice(0, 100).map((row) => row.length));
  for (let column = 0; column < width; column++) {
    const header = normalizePersianLetters(display(rows[0]?.[column] ?? ""));
    if (HEADER_MOBILE_PATTERN.test(header)) {
      columns.add(column);
      continue;
    }
    let nonEmpty = 0;
    let valid = 0;
    let explicitlyMobile = 0;
    const firstValue = rows[0]?.[column];
    const hasTextHeader = typeof firstValue === "string" &&
      /[^+\d\s().\-\u00a0\u06f0-\u06f9\u0660-\u0669]/.test(firstValue);
    for (const row of rows.slice(hasTextHeader ? 1 : 0, 101)) {
      const value = row[column];
      if (isEmpty(value)) continue;
      nonEmpty++;
      if (normalizeMobile(value)) {
        valid++;
        const raw = toLatinDigits(display(value)).trim().replace(/[^+\d]/g, "");
        if (/^(?:\+98|0098|98|09)/.test(raw)) explicitlyMobile++;
      }
    }
    if (nonEmpty > 0 && valid / nonEmpty >= 0.6 &&
      (valid >= 2 || width === 1 || (valid === 1 && explicitlyMobile === 1))) {
      columns.add(column);
    }
  }
  return columns;
}

function makeSheet(name: string, rows: CellValue[][], worksheet?: XLSX.WorkSheet, hidden: 0 | 1 | 2 = 0): ParsedSheet {
  const phoneColumns = inferPhoneColumns(rows);
  const emptyRows = new Set<number>();
  const duplicateRows = new Set<number>();
  const invalidMobileRows = new Set<number>();
  const seen = new Set<string>();

  rows.forEach((row, rowIndex) => {
    if (isEmptyRow(row)) {
      emptyRows.add(rowIndex);
      return;
    }
    const key = exactRowKey(row);
    if (seen.has(key)) duplicateRows.add(rowIndex);
    else seen.add(key);
    for (const column of phoneColumns) {
      const value = row[column];
      if (rowIndex === 0 && HEADER_MOBILE_PATTERN.test(normalizePersianLetters(display(value)))) continue;
      if (!isEmpty(value) && !normalizeMobile(value)) {
        invalidMobileRows.add(rowIndex);
        break;
      }
    }
  });

  return { name, rows, worksheet, hidden, phoneColumns, emptyRows, duplicateRows, invalidMobileRows };
}

function checkCapacity(sheets: { rows: CellValue[][] }[]): void {
  const rowCount = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  const cellCount = sheets.reduce(
    (total, sheet) => total + sheet.rows.reduce((sum, row) => sum + row.length, 0),
    0,
  );
  if (rowCount > MAX_ROWS || cellCount > MAX_CELLS) {
    throw new CleanerError(
      "TOO_MANY_ROWS",
      "این فایل برای نسخه فعلی خیلی بزرگ است. لطفاً فایل را به بخش‌های کوچک‌تر تقسیم کنید.",
    );
  }
}

function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  let records = 0;
  for (let index = 0; index < text.length && records < 10; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && Object.prototype.hasOwnProperty.call(counts, char)) {
      counts[char]++;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      records++;
      if (char === "\r" && text[index + 1] === "\n") index++;
    }
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] ? ranked[0][0] : ",";
}

function parseCsv(text: string, delimiter: string): CellValue[][] {
  const rows: CellValue[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
      if (char === "\r" && text[index + 1] === "\n") index++;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) {
    throw new CleanerError("PARSE_ERROR", "ساختار فایل CSV درست نیست؛ یک نقل‌قول بسته نشده است.");
  }
  if (fieldStarted || field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function decodeCsv(buffer: ArrayBuffer): { text: string; warning?: string } {
  const bytes = new Uint8Array(buffer);
  const utf16le = bytes[0] === 0xff && bytes[1] === 0xfe;
  const utf16be = bytes[0] === 0xfe && bytes[1] === 0xff;
  if (bytes.some((byte) => byte === 0) && !utf16le && !utf16be) {
    throw new CleanerError("PARSE_ERROR", "فایل CSV قابل خواندن نیست یا کدگذاری آن پشتیبانی نمی‌شود.");
  }
  if (utf16le) {
    return { text: new TextDecoder("utf-16le").decode(bytes).replace(/^\ufeff/, "") };
  }
  if (utf16be) {
    return { text: new TextDecoder("utf-16be").decode(bytes).replace(/^\ufeff/, "") };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\ufeff/, "") };
  } catch {
    try {
      return {
        text: new TextDecoder("windows-1256").decode(bytes),
        warning: "این CSV با کدگذاری قدیمی خوانده شد و خروجی به UTF-8 تبدیل می‌شود.",
      };
    } catch {
      throw new CleanerError("PARSE_ERROR", "کدگذاری این فایل CSV پشتیبانی نمی‌شود.");
    }
  }
}

function readXlsx(buffer: ArrayBuffer): ParsedSheet[] {
  const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new CleanerError("PARSE_ERROR", "ساختار فایل اکسل درست نیست. لطفاً یک فایل XLSX معتبر انتخاب کنید.");
  }
  try {
    const workbook = XLSX.read(buffer, { type: "array", cellFormula: true, cellNF: true, cellStyles: true });
    const sheets: ParsedSheet[] = [];
    for (const [sheetIndex, name] of workbook.SheetNames.entries()) {
      const worksheet = workbook.Sheets[name];
      if (!worksheet) continue;
      if (Object.entries(worksheet).some(([address, cell]) => !address.startsWith("!") && typeof cell === "object" && cell !== null && "f" in cell)) {
        throw new CleanerError(
          "UNSUPPORTED_FORMULAS",
          "این فایل فرمول دارد. برای جلوگیری از تغییر ناخواسته فرمول‌ها، فعلاً یک نسخه فقط‌داده از آن وارد کنید.",
        );
      }
      const range = worksheet["!ref"];
      if (range) {
        const decoded = XLSX.utils.decode_range(range);
        if (decoded.e.r + 1 > MAX_ROWS || (decoded.e.r + 1) * (decoded.e.c + 1) > MAX_CELLS) {
          throw new CleanerError(
            "TOO_MANY_ROWS",
            "این فایل برای نسخه فعلی خیلی بزرگ است. لطفاً فایل را به بخش‌های کوچک‌تر تقسیم کنید.",
          );
        }
      }
      const rows = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
        header: 1,
        blankrows: true,
        defval: "",
        raw: true,
        range: 0,
      });
      while (rows.length && isEmptyRow(rows[rows.length - 1])) rows.pop();
      const hidden = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden ?? 0;
      sheets.push(makeSheet(name, rows, worksheet, hidden));
    }
    return sheets;
  } catch (error) {
    if (error instanceof CleanerError) throw error;
    throw new CleanerError("PARSE_ERROR", "خواندن فایل اکسل ممکن نشد. لطفاً از سالم بودن فایل مطمئن شوید.");
  }
}

function issueExample(sheet: string, row: number, column: number | undefined, before: CellValue, after?: string): IssueExample {
  return { sheet, row: row + 1, column: column === undefined ? undefined : column + 1, before: display(before), after };
}

function collectIssues(sheets: ParsedSheet[]): {
  issues: IssueSummary[];
  digitCounts: Analysis["digitCounts"];
  digitExamples: Analysis["digitExamples"];
} {
  const counts = Object.fromEntries(ISSUE_ORDER.map((id) => [id, 0])) as Record<IssueId, number>;
  const examples = {} as Record<IssueId, IssueExample[]>;
  for (const id of ISSUE_ORDER) examples[id] = [];
  const digitCounts = { latin: 0, persian: 0 };
  const digitExamples = { latin: examples.digits, persian: [] as IssueExample[] };
  const add = (id: IssueId, example: IssueExample) => {
    counts[id]++;
    if (examples[id].length < SAMPLE_LIMIT) examples[id].push(example);
  };

  for (const sheet of sheets) {
    sheet.rows.forEach((row, rowIndex) => {
      if (sheet.emptyRows.has(rowIndex)) {
        add("emptyRows", issueExample(sheet.name, rowIndex, undefined, "ردیف خالی"));
      }
      if (sheet.duplicateRows.has(rowIndex)) {
        add("duplicateRows", issueExample(sheet.name, rowIndex, undefined, row.slice(0, 3).map(display).join(" | ")));
      }
      if (sheet.invalidMobileRows.has(rowIndex)) {
        const column = [...sheet.phoneColumns].find((column) => !isEmpty(row[column]) && !normalizeMobile(row[column]));
        add("invalidMobileRows", issueExample(sheet.name, rowIndex, column, column === undefined ? "" : row[column]));
      }
      row.forEach((cell, column) => {
        if (sheet.phoneColumns.has(column) && !isEmpty(cell)) {
          const mobile = normalizeMobile(cell);
          if (mobile && mobile !== display(cell)) {
            add("mobileNumbers", issueExample(sheet.name, rowIndex, column, cell, mobile));
          }
        }
        if (typeof cell !== "string") return;
        if (ARABIC_LETTERS_PATTERN.test(cell)) {
          add("persianLetters", issueExample(sheet.name, rowIndex, column, cell, normalizePersianLetters(cell)));
        }
        const spaced = normalizeWhitespace(cell);
        if (spaced !== cell) {
          add("whitespace", issueExample(sheet.name, rowIndex, column, cell, spaced));
        }
        if (!sheet.phoneColumns.has(column)) {
          const asLatin = toLatinDigits(cell);
          if (asLatin !== cell) {
            digitCounts.latin++;
            if (digitExamples.latin.length < SAMPLE_LIMIT) {
              digitExamples.latin.push(issueExample(sheet.name, rowIndex, column, cell, asLatin));
            }
          }
          const asPersian = toPersianDigits(cell);
          if (asPersian !== cell) {
            digitCounts.persian++;
            if (digitExamples.persian.length < SAMPLE_LIMIT) {
              digitExamples.persian.push(issueExample(sheet.name, rowIndex, column, cell, asPersian));
            }
          }
        }
      });
    });
  }
  counts.digits = digitCounts.latin;
  const issues = ISSUE_ORDER.filter((id) => counts[id] > 0 || (id === "digits" && digitCounts.persian > 0)).map((id) => ({
    id,
    ...DEFINITIONS[id],
    count: counts[id],
    examples: examples[id],
  }));
  return { issues, digitCounts, digitExamples };
}

export function getDigitIssueCount(analysis: Analysis, mode: DigitMode): number {
  return analysis.digitCounts[mode];
}

export function getDigitIssueExamples(analysis: Analysis, mode: DigitMode): IssueExample[] {
  return analysis.digitExamples[mode];
}

export async function analyzeFile(file: File): Promise<Analysis> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "xlsx" && extension !== "csv") {
    throw new CleanerError("INVALID_TYPE", "فقط فایل‌های XLSX و CSV پشتیبانی می‌شوند.");
  }
  if (file.size === 0) throw new CleanerError("EMPTY_FILE", "این فایل خالی است. لطفاً فایل دیگری انتخاب کنید.");
  if (file.size > MAX_FILE_BYTES) {
    throw new CleanerError("TOO_LARGE", "حجم فایل باید حداکثر ۱۰ مگابایت باشد.");
  }

  const warnings: string[] = [];
  const buffer = await file.arrayBuffer();
  let sheets: ParsedSheet[];
  let delimiter = ",";
  if (extension === "csv") {
    const decoded = decodeCsv(buffer);
    if (decoded.warning) warnings.push(decoded.warning);
    delimiter = detectDelimiter(decoded.text);
    sheets = [makeSheet(file.name.replace(/\.csv$/i, ""), parseCsv(decoded.text, delimiter))];
  } else {
    sheets = readXlsx(buffer);
    warnings.push("در خروجی اکسل، قالب‌بندی دیداری و تنظیمات پیشرفته ممکن است حفظ نشوند.");
    if (sheets.some((sheet) => sheet.hidden)) {
      warnings.push("برگه‌های پنهان این فایل هم بررسی و پاک‌سازی می‌شوند و در خروجی پنهان می‌مانند.");
    }
  }
  checkCapacity(sheets);
  if (!sheets.some((sheet) => sheet.rows.some((row) => !isEmptyRow(row)))) {
    throw new CleanerError("NO_DATA", "داده‌ای در این فایل پیدا نشد. لطفاً محتوای فایل را بررسی کنید.");
  }
  const { issues, digitCounts, digitExamples } = collectIssues(sheets);
  return {
    fileName: file.name,
    fileType: extension,
    totalRows: sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rows.length,
      columnCount: sheet.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0),
      phoneColumns: [...sheet.phoneColumns].map((column) => column + 1),
      hidden: Boolean(sheet.hidden),
    })),
    issues,
    digitCounts,
    digitExamples,
    warnings,
    source: { sheets, delimiter },
  };
}

function resolvedOptions(options: Partial<CleanOptions>): CleanOptions {
  return { ...DEFAULT_OPTIONS, ...options };
}

function transformedCell(cell: CellValue, column: number, phoneColumns: Set<number>, options: CleanOptions): CellValue {
  let value: CellValue = cell;
  if (typeof value === "string") {
    if (options.persianLetters) value = normalizePersianLetters(value);
    if (options.whitespace) value = normalizeWhitespace(value);
    if (options.digits && !phoneColumns.has(column)) {
      value = options.digitMode === "latin" ? toLatinDigits(value) : toPersianDigits(value);
    }
  }
  if (options.mobileNumbers && phoneColumns.has(column) && !isEmpty(value)) {
    value = normalizeMobile(value) ?? value;
  }
  return value;
}

function process(analysis: Analysis, partialOptions: Partial<CleanOptions>) {
  const options = resolvedOptions(partialOptions);
  const output: { sourceSheet: ParsedSheet; rows: CellValue[][]; rowOrigins: number[] }[] = [];
  const preview: CleaningPreview = {
    changedCells: 0,
    removedRows: 0,
    remainingRows: 0,
    affectedSheets: 0,
    changes: [],
    removedSamples: [],
    removalBreakdown: { emptyRows: 0, duplicateRows: 0, invalidMobileRows: 0 },
  };
  for (const sheet of analysis.source.sheets) {
    const rows: CellValue[][] = [];
    const rowOrigins: number[] = [];
    let touched = false;
    sheet.rows.forEach((row, rowIndex) => {
      const reason =
        options.emptyRows && sheet.emptyRows.has(rowIndex)
          ? "emptyRows"
          : options.duplicateRows && sheet.duplicateRows.has(rowIndex)
            ? "duplicateRows"
            : options.invalidMobileRows && sheet.invalidMobileRows.has(rowIndex)
              ? "invalidMobileRows"
              : null;
      if (reason) {
        touched = true;
        preview.removedRows++;
        preview.removalBreakdown[reason]++;
        if (preview.removedSamples.length < 6) {
          preview.removedSamples.push({
            sheet: sheet.name,
            row: rowIndex + 1,
            reason,
            preview: row.slice(0, 3).map(display).filter(Boolean).join(" | ").slice(0, 100),
          });
        }
        return;
      }
      const transformed = row.map((cell, column) => {
        const next = transformedCell(cell, column, sheet.phoneColumns, options);
        if (next !== cell) {
          touched = true;
          preview.changedCells++;
          if (preview.changes.length < 8) {
            preview.changes.push({
              sheet: sheet.name,
              row: rowIndex + 1,
              column: column + 1,
              before: display(cell),
              after: display(next),
            });
          }
        }
        return next;
      });
      rows.push(transformed);
      rowOrigins.push(rowIndex);
    });
    if (touched) preview.affectedSheets++;
    preview.remainingRows += rows.length;
    output.push({ sourceSheet: sheet, rows, rowOrigins });
  }
  return { output, preview };
}

export function previewCleaning(analysis: Analysis, options: Partial<CleanOptions> = {}): CleaningPreview {
  return process(analysis, options).preview;
}

function makeOutputWorksheet(
  sourceSheet: ParsedSheet,
  rows: CellValue[][],
  rowOrigins: number[],
): XLSX.WorkSheet {
  const worksheet = XLSX.utils.aoa_to_sheet(rows.length ? rows : [[]]);
  const original = sourceSheet.worksheet;
  if (!original) return worksheet;

  if (original["!cols"]) worksheet["!cols"] = original["!cols"].map((column) => ({ ...column }));
  if (original["!rows"]) {
    worksheet["!rows"] = rowOrigins.map((row) => original["!rows"]?.[row] ? { ...original["!rows"]?.[row] } : undefined) as XLSX.RowInfo[];
  }
  if (rowOrigins.length === sourceSheet.rows.length) {
    if (original["!merges"]) worksheet["!merges"] = original["!merges"].map((merge) => ({ s: { ...merge.s }, e: { ...merge.e } }));
    if (original["!autofilter"]) worksheet["!autofilter"] = { ...original["!autofilter"] };
  }

  rows.forEach((row, outputRow) => {
    const sourceRow = rowOrigins[outputRow];
    row.forEach((_, column) => {
      const from = original[XLSX.utils.encode_cell({ r: sourceRow, c: column })];
      const to = worksheet[XLSX.utils.encode_cell({ r: outputRow, c: column })];
      if (!from || !to) return;
      if (from.s) to.s = from.s;
      // Keeping the number format stops unchanged Excel dates becoming serial numbers.
      if (from.z && typeof to.v === "number") to.z = from.z;
    });
  });
  return worksheet;
}

function serializeCsv(rows: CellValue[][], delimiter: string): string {
  const escape = (cell: CellValue): string => {
    const value = display(cell);
    return value.includes(delimiter) || /["\r\n]/.test(value)
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  };
  return `\ufeff${rows.map((row) => row.map(escape).join(delimiter)).join("\r\n")}`;
}

export async function cleanFile(analysis: Analysis, options: Partial<CleanOptions> = {}): Promise<CleanResult> {
  const { output, preview } = process(analysis, options);
  const baseName = analysis.fileName.replace(/\.(xlsx|csv)$/i, "");
  if (analysis.fileType === "csv") {
    const mimeType = "text/csv;charset=utf-8";
    return {
      blob: new Blob([serializeCsv(output[0]?.rows ?? [], analysis.source.delimiter)], { type: mimeType }),
      fileName: `${baseName}_پاکسازی‌شده.csv`,
      mimeType,
      preview,
    };
  }
  const workbook = XLSX.utils.book_new();
  for (const sheet of output) {
    XLSX.utils.book_append_sheet(
      workbook,
      makeOutputWorksheet(sheet.sourceSheet, sheet.rows, sheet.rowOrigins),
      sheet.sourceSheet.name,
    );
  }
  workbook.Workbook = {
    ...(workbook.Workbook ?? {}),
    Sheets: output.map((sheet) => ({ name: sheet.sourceSheet.name, Hidden: sheet.sourceSheet.hidden })),
  };
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true, cellStyles: true });
  const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return {
    blob: new Blob([bytes], { type: mimeType }),
    fileName: `${baseName}_پاکسازی‌شده.xlsx`,
    mimeType,
    preview,
  };
}
