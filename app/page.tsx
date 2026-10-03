"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpLeft, Check, CheckCircle2, ChevronDown, Download, FileSpreadsheet, Info, LockKeyhole, RotateCcw, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, UploadCloud, X } from "lucide-react";
import {
  analyzeFile,
  cleanFile,
  CleanerError,
  DEFAULT_OPTIONS,
  getDigitIssueCount,
  getDigitIssueExamples,
  MAX_FILE_BYTES,
  previewCleaning,
  type Analysis,
  type CleanOptions,
  type CleanResult,
  type CleaningPreview,
  type IssueSummary,
} from "../src/lib/cleaner";

type Stage = "upload" | "analyzing" | "results" | "preview" | "cleaning" | "done";
type FeedbackState = "idle" | "sending" | "sent" | "error";
type WebTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};
type WebModelContext = { registerTool: (tool: WebTool, options: { signal: AbortSignal }) => void | Promise<void> };

const formatNumber = (value: number) => value.toLocaleString("fa-IR");
const feedbackRepository = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "";
const usesGitHubFeedback = Boolean(feedbackRepository);
const formatBytes = (value: number) => value < 1024 * 1024
  ? formatNumber(Math.max(1, Math.round(value / 1024))) + " کیلوبایت"
  : (value / 1024 / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " مگابایت";

function track(event: string, detail: Record<string, string | number | boolean> = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("paksaz:analytics", { detail: { event, ...detail } }));
}

function issueCount(analysis: Analysis, issue: IssueSummary, mode: CleanOptions["digitMode"]) {
  return issue.id === "digits" ? getDigitIssueCount(analysis, mode) : issue.count;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof CleanerError ? error.message : fallback;
}

function Stepper({ stage }: { stage: Stage }) {
  const active = stage === "analyzing" ? 1 : stage === "results" ? 2 : stage === "preview" || stage === "cleaning" ? 3 : 4;
  const steps = ["انتخاب فایل", "بررسی", "پیش‌نمایش", "دریافت"];
  return <ol className="stepper" aria-label="مراحل پاک‌سازی">{steps.map((label, index) => {
    const step = index + 1;
    return <li key={label} className={step === active ? "active" : step < active ? "complete" : ""} aria-current={step === active ? "step" : undefined}><span>{step < active ? <Check size={16} /> : formatNumber(step)}</span><b>{label}</b></li>;
  })}</ol>;
}

export default function Home() {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [options, setOptions] = useState<CleanOptions>({ ...DEFAULT_OPTIONS });
  const [preview, setPreview] = useState<CleaningPreview | null>(null);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stage !== "upload") contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [stage]);
  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  function reset(fileToKeep: File | null = null) {
    setFile(fileToKeep);
    setStage("upload");
    setAnalysis(null);
    setPreview(null);
    setResult(null);
    setDownloadUrl("");
    setOptions({ ...DEFAULT_OPTIONS });
    setDownloaded(false);
    setRating(null);
    setFeedbackText("");
    setFeedbackState("idle");
    setError("");
  }

  function chooseFile(candidate?: File) {
    setError("");
    if (!candidate) return;
    if (!/\.(xlsx|csv)$/i.test(candidate.name)) {
      reset();
      setError("فقط فایل‌های XLSX و CSV پشتیبانی می‌شوند.");
      return;
    }
    if (candidate.size === 0) {
      reset();
      setError("این فایل خالی است. یک فایل دیگر انتخاب کن.");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      reset();
      setError("حجم فایل باید کمتر از ۱۰ مگابایت باشد.");
      return;
    }
    reset(candidate);
    track("file_selected", { format: candidate.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx", size_bytes: candidate.size });
  }

  const startAnalysis = useCallback(async (): Promise<Analysis | null> => {
    if (!file) return null;
    setError("");
    setStage("analyzing");
    track("analysis_started", { format: file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx" });
    try {
      const data = await analyzeFile(file);
      setAnalysis(data);
      setOptions({ ...DEFAULT_OPTIONS });
      track("analysis_completed", { rows: data.totalRows, sheets: data.sheets.length, issue_types: data.issues.filter((issue) => issue.count > 0).length });
      for (const issue of data.issues) {
        if (issue.count > 0) track("issue_detected_" + issue.id.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()), { count: issue.count });
      }
      setStage("results");
      return data;
    } catch (cause) {
      setError(errorMessage(cause, "نتونستیم فایل رو بخونیم. دوباره از Excel ذخیره‌اش کن و امتحان کن."));
      setStage("upload");
      return null;
    }
  }, [file]);

  function makePreview() {
    if (!analysis) return;
    try {
      const next = previewCleaning(analysis, options);
      setPreview(next);
      setError("");
      setStage("preview");
    } catch (cause) {
      setError(errorMessage(cause, "نتونستیم پیش‌نمایش تغییرها رو آماده کنیم. دوباره امتحان کن."));
    }
  }

  const startCleaning = useCallback(async (): Promise<CleanResult | null> => {
    if (!analysis) return null;
    setError("");
    setStage("cleaning");
    track("clean_started", { rows: analysis.totalRows, selected_fixes: Object.entries(options).filter(([key, value]) => key !== "digitMode" && value === true).length });
    try {
      const next = await cleanFile(analysis, options);
      setResult(next);
      setDownloadUrl(URL.createObjectURL(next.blob));
      track("clean_completed", { changed_cells: next.preview.changedCells, removed_rows: next.preview.removedRows });
      setStage("done");
      return next;
    } catch (cause) {
      setError(errorMessage(cause, "پاک‌سازی کامل نشد. انتخاب‌هایت حفظ شده‌اند؛ دوباره امتحان کن."));
      setStage("preview");
      return null;
    }
  }, [analysis, options]);

  function updateOption(id: IssueSummary["id"], checked: boolean) {
    setOptions((current) => ({ ...current, [id]: checked }));
  }

  async function sendFeedback() {
    if (!rating || feedbackState === "sending") return;
    setFeedbackState("sending");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, note: feedbackText.trim() }),
      });
      if (!response.ok) throw new Error("Feedback failed");
      setFeedbackState("sent");
      track(rating === "positive" ? "feedback_positive" : "feedback_negative", { has_note: Boolean(feedbackText.trim()) });
    } catch {
      setFeedbackState("error");
    }
  }

  function githubFeedbackUrl() {
    const title = rating === "positive" ? "بازخورد مثبت دربارهٔ پاک‌ساز" : "پیشنهاد برای بهتر شدن پاک‌ساز";
    const body = [
      rating === "positive" ? "پاک‌ساز به دردم خورد." : "پاک‌ساز هنوز جای بهتر شدن دارد.",
      feedbackText.trim(),
      "این بازخورد از نسخهٔ GitHub Pages ارسال شده؛ هیچ فایل یا محتوای سلولی پیوست نشده است.",
    ].filter(Boolean).join("\n\n");
    return `https://github.com/${feedbackRepository}/issues/new?${new URLSearchParams({ title, body })}`;
  }

  const effectiveIssues = analysis?.issues.filter((issue) => issueCount(analysis, issue, options.digitMode) > 0) ?? [];
  const selectedCount = effectiveIssues.filter((issue) => options[issue.id]).length;
  const displayNoIssues = analysis && effectiveIssues.length === 0;

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: WebTool) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
      } catch { /* Browsers without WebMCP still use the visible interface. */ }
    };
    register({
      name: "get_cleaning_state",
      title: "Get cleaner state",
      description: "Read the current file-cleaning stage, detected issue counts, and selected fixes without revealing file contents.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({
        stage,
        hasFile: Boolean(file),
        rows: analysis?.totalRows ?? null,
        sheets: analysis?.sheets.length ?? null,
        issues: analysis?.issues.map((issue) => ({ id: issue.id, count: issueCount(analysis, issue, options.digitMode), selected: options[issue.id] })) ?? [],
      }),
    });
    register({
      name: "analyze_selected_file",
      title: "Analyze selected file",
      description: "Analyze the file already selected by the visitor and show detected issues.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async () => {
        if (!file || stage !== "upload") throw new Error("Select a file in the page first.");
        const data = await startAnalysis();
        if (!data) throw new Error("File analysis failed. Read the visible error and select another file.");
        return { stage: "results", rows: data.totalRows, issues: data.issues.length };
      },
    });
    register({
      name: "configure_cleaning",
      title: "Choose cleaning fixes",
      description: "Set one or more visible cleaning options for the analyzed file; row deletion remains opt-in.",
      inputSchema: {
        type: "object",
        properties: {
          mobileNumbers: { type: "boolean" }, invalidMobileRows: { type: "boolean" },
          persianLetters: { type: "boolean" }, whitespace: { type: "boolean" },
          digits: { type: "boolean" }, emptyRows: { type: "boolean" },
          duplicateRows: { type: "boolean" }, digitMode: { enum: ["latin", "persian"] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        if (!analysis || (stage !== "results" && stage !== "preview")) throw new Error("Analyze a file first.");
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Options must be an object.");
        const patch = input as Record<string, unknown>;
        const keys = ["mobileNumbers", "invalidMobileRows", "persianLetters", "whitespace", "digits", "emptyRows", "duplicateRows"];
        for (const [key, value] of Object.entries(patch)) {
          if (key === "digitMode" ? value !== "latin" && value !== "persian" : !keys.includes(key) || typeof value !== "boolean") throw new Error("Invalid cleaning option.");
        }
        const next = { ...options, ...patch } as CleanOptions;
        setOptions(next);
        if (stage === "preview") setStage("results");
        return { stage: "results", selected: keys.filter((key) => next[key as keyof CleanOptions] === true), digitMode: next.digitMode };
      },
    });
    register({
      name: "preview_cleaning",
      title: "Preview selected changes",
      description: "Show the local before-and-after summary for the selected fixes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        if (!analysis || stage !== "results") throw new Error("Analyze a file and choose fixes first.");
        const next = previewCleaning(analysis, options);
        if (next.changedCells === 0 && next.removedRows === 0) throw new Error("No effective fixes are selected.");
        setPreview(next);
        setStage("preview");
        return { stage: "preview", changedCells: next.changedCells, removedRows: next.removedRows, remainingRows: next.remainingRows };
      },
    });
    register({
      name: "clean_selected_file",
      title: "Create cleaned file",
      description: "Apply the visitor's confirmed fixes in the browser and prepare the download.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async () => {
        if (!analysis || stage !== "preview" || !preview) throw new Error("Review the change preview first.");
        const next = await startCleaning();
        if (!next) throw new Error("Cleaning failed. Read the visible error and try again.");
        return { stage: "done", changedCells: next.preview.changedCells, removedRows: next.preview.removedRows, downloadReady: true };
      },
    });
    return () => lifecycle.abort();
  }, [stage, file, analysis, options, preview, startAnalysis, startCleaning]);

  return (
    <main id="top" className="site-shell" dir="rtl">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="site-header wrap">
        <a className="brand" href="#top" onClick={() => { if (stage !== "upload") reset(); }} aria-label="پاک‌ساز، صفحه اصلی"><span className="brand-mark"><FileSpreadsheet size={21} strokeWidth={2.15} /></span><span>پاک‌ساز</span></a>
        <nav aria-label="پیوندهای صفحه"><a href="#how-it-works">چطور کار می‌کند؟</a><a href="#privacy">حریم خصوصی</a></nav>
      </header>

      {stage === "upload" ? (
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-main">
            <div className="eyebrow"><Sparkles size={16} /> ابزار رایگانِ مرتب‌سازی فایل</div>
            <h1 id="hero-title">فایل اکسل به‌هم‌ریخته داری؟</h1>
            <p className="hero-lead">فایل رو بده، مشکلات رایجش رو پیدا می‌کنیم. خودت انتخاب کن چه چیزهایی اصلاح بشن، بعد فایل تمیز رو تحویل بگیر.</p>
            <div className="upload-card">
              <div className="upload-card-heading"><span className="upload-icon"><UploadCloud size={25} strokeWidth={1.85} /></span><div><h2>فایلت رو اینجا شروع کن</h2><p>Excel یا CSV، تا ۱۰ مگابایت</p></div></div>
              <input ref={pickerRef} id="file-picker" className="visually-hidden" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
              <div className={"dropzone" + (dragging ? " is-dragging" : "")} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
                {file ? <div className="selected-file"><span className="selected-file-icon"><FileSpreadsheet size={23} /></span><span className="selected-file-name"><bdi dir="auto">{file.name}</bdi><small>{formatBytes(file.size)}</small></span><button className="remove-file" type="button" onClick={() => reset()} aria-label="حذف فایل انتخاب شده"><X size={19} /></button></div> : <><span className="dropzone-art"><FileSpreadsheet size={30} strokeWidth={1.5} /></span><p>فایل را اینجا رها کن</p><span>یا</span><button type="button" className="choose-button" onClick={() => pickerRef.current?.click()}>انتخاب فایل <ArrowUpLeft size={17} /></button></>}
              </div>
              {file && <button type="button" className="change-file" onClick={() => pickerRef.current?.click()}>انتخاب فایل دیگر</button>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" type="button" disabled={!file} onClick={startAnalysis}>بررسی فایل <ArrowLeft size={19} /></button>
              <p className="local-note"><LockKeyhole size={15} /> فایل روی همین دستگاه بررسی می‌شود و جایی آپلود نمی‌شود.</p>
            </div>
          </div>
          <aside className="hero-visual" aria-label="نمونه‌ای از اصلاح شماره‌ها و متن">
            <div className="visual-orbit orbit-one" aria-hidden="true" /><div className="visual-orbit orbit-two" aria-hidden="true" />
            <div className="sample-card"><div className="sample-top"><span className="sample-dots"><i /><i /><i /></span><span>پیش‌نمایش یک تغییر</span><span className="sample-table-icon"><FileSpreadsheet size={18} /></span></div><div className="sample-body"><span className="sample-caption">شماره موبایل</span><div className="sample-value before" dir="ltr">+98 912 123 4567 <span>قبل</span></div><div className="sample-arrow" aria-hidden="true"><ArrowLeft size={19} /></div><div className="sample-value after" dir="ltr">09121234567 <span>بعد</span></div><div className="sample-rule" /><span className="sample-caption">حروف فارسی</span><div className="sample-text" dir="rtl"><span>شركت پارسي</span><ArrowLeft size={16} /><strong>شرکت پارسی</strong></div></div></div>
            <div className="floating-proof"><span><Check size={17} /></span> تغییرها قبل از دانلود، دست خودته</div>
          </aside>
        </section>
      ) : (
        <div className="workspace wrap" ref={contentRef}>
          <p className="visually-hidden" role="status" aria-live="polite">{stage === "analyzing" ? "بررسی فایل شروع شد." : stage === "results" ? "بررسی فایل کامل شد و موارد پیدا شده نمایش داده می‌شوند." : stage === "preview" ? "پیش‌نمایش تغییرها آماده است." : stage === "cleaning" ? "پاک‌سازی فایل در حال انجام است." : "فایل پاک‌سازی شد و آمادهٔ دانلود است."}</p>
          <Stepper stage={stage} />
          {stage === "analyzing" || stage === "cleaning" ? <section className="waiting-card" role="status" aria-live="polite"><div className="waiting-spinner" /><h1>{stage === "analyzing" ? "داریم فایل رو بررسی می‌کنیم…" : "داریم نسخهٔ تمیز رو آماده می‌کنیم…"}</h1><p>{stage === "analyzing" ? "بسته به اندازهٔ فایل، ممکنه چند لحظه طول بکشه." : "فقط تغییرهایی که تأیید کردی اعمال می‌شن."}</p></section> : null}

          {stage === "results" && analysis && <div className="workflow">
            <div className="workflow-heading"><div><span className="eyebrow small"><CheckCircle2 size={15} /> بررسی انجام شد</span><h1>این موارد رو در فایلت پیدا کردیم</h1><p>اصلاح‌هایی که می‌خوای رو انتخاب کن. ردیفی بدون اجازهٔ تو حذف نمی‌شه.</p></div><button className="text-button" type="button" onClick={() => reset()}><RotateCcw size={17} /> فایل دیگر</button></div>
            <div className="workflow-grid">
              <aside className="file-summary"><span className="summary-icon"><FileSpreadsheet size={22} /></span><h2><bdi dir="auto">{analysis.fileName}</bdi></h2><p>{analysis.fileType.toUpperCase()} <span>•</span> {formatNumber(analysis.totalRows)} ردیف <span>•</span> {formatNumber(analysis.sheets.length)} برگه</p><div className="summary-line" /><div className="summary-stat"><strong>{formatNumber(effectiveIssues.length)}</strong><span>نوع مورد پیدا شده</span></div><div className="summary-stat"><strong>{formatNumber(selectedCount)}</strong><span>اصلاح انتخاب شده</span></div><p className="summary-privacy"><LockKeyhole size={15} /> فایل فقط روی دستگاه توست.</p></aside>
              <section className="issues-panel" aria-label="موارد پیدا شده">
                {analysis.warnings.map((warning, index) => <div className="warning-banner" key={index}><Info size={18} /><p>{warning}</p></div>)}
                {displayNoIssues ? <div className="no-issues"><span><CheckCircle2 size={31} /></span><h2>فایل خیلی تمیزه!</h2><p>مشکل خاصی برای اصلاح پیدا نکردیم. می‌تونی فایل دیگه‌ای رو بررسی کنی.</p><button className="secondary-button" type="button" onClick={() => reset()}>بررسی فایل دیگر</button></div> : <>
                  <div className="issues-heading"><h2>اصلاح‌های پیشنهادی</h2><span>{formatNumber(effectiveIssues.length)} مورد</span></div>
                  <div className="issues-list">{analysis.issues.map((issue) => {
                    const count = issueCount(analysis, issue, options.digitMode);
                    const examples = issue.id === "digits" ? getDigitIssueExamples(analysis, options.digitMode) : issue.examples;
                    if (!count && issue.id !== "digits") return null;
                    return <article className={"issue-card" + (options[issue.id] && count ? " checked" : "")} key={issue.id}>
                      <label className="issue-row"><input type="checkbox" checked={options[issue.id]} onChange={(event) => updateOption(issue.id, event.target.checked)} disabled={count === 0} /><span className="fake-check"><Check size={14} /></span><span className="issue-title"><strong>{issue.label}</strong><small>{issue.description}</small></span><span className="issue-count">{formatNumber(count)} {issue.id === "emptyRows" || issue.id === "duplicateRows" || issue.id === "invalidMobileRows" ? "ردیف" : "سلول"}</span></label>
                      {issue.destructive && <p className="destructive-note">حذف ردیف‌ها فقط با انتخاب تو انجام می‌شه.</p>}
                      {issue.id === "digits" && <div className="digit-choice"><label htmlFor="digit-mode">جهت یکسان‌سازی</label><div className="select-wrap"><select id="digit-mode" value={options.digitMode} onChange={(event) => setOptions((current) => ({ ...current, digitMode: event.target.value as CleanOptions["digitMode"] }))}><option value="latin">به اعداد انگلیسی: ۱۲۳ ← 123</option><option value="persian">به اعداد فارسی: 123 ← ۱۲۳</option></select><ChevronDown size={17} /></div><small>شماره موبایل‌ها همیشه با رقم انگلیسی ذخیره می‌شن.</small></div>}
                      {examples.length > 0 && count > 0 && <div className="issue-examples">{examples.slice(0, 2).map((example, index) => <div className="example-line" key={index}><span className="example-locator">{example.sheet}، ردیف {formatNumber(example.row)}</span><span className="example-values"><bdi dir="auto">{example.before || "ردیف خالی"}</bdi>{example.after && <><ArrowLeft size={16} /><bdi dir="auto">{example.after}</bdi></>}</span></div>)}</div>}
                    </article>;
                  })}</div>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <div className="workflow-actions"><button className="primary-button" type="button" disabled={selectedCount === 0} onClick={makePreview}>دیدن پیش‌نمایش تغییرها <ArrowLeft size={18} /></button>{selectedCount === 0 && <p>برای ادامه، دست‌کم یک اصلاح را انتخاب کن.</p>}</div>
                </>}
              </section>
            </div>
          </div>}

          {stage === "preview" && analysis && preview && <div className="workflow">
            <div className="workflow-heading"><div><span className="eyebrow small"><Sparkles size={15} /> قبل از پاک‌سازی</span><h1>مرور آخرِ تغییرها</h1><p>این خلاصه دقیقاً بر اساس انتخاب‌های توست. اگر خواستی، برگرد و اصلاح‌ها رو عوض کن.</p></div><button className="text-button" type="button" onClick={() => setStage("results")}><ArrowRight size={17} /> ویرایش انتخاب‌ها</button></div>
            <div className="preview-stats"><div><strong>{formatNumber(preview.changedCells)}</strong><span>سلول تغییر می‌کند</span></div><div><strong>{formatNumber(preview.removedRows)}</strong><span>ردیف حذف می‌شود</span></div><div><strong>{formatNumber(preview.remainingRows)}</strong><span>ردیف باقی می‌ماند</span></div></div>
            {preview.removedRows > 0 && <div className="warning-banner prominent"><Info size={19} /><p>با تأیید تو، {formatNumber(preview.removalBreakdown.emptyRows)} ردیف خالی، {formatNumber(preview.removalBreakdown.duplicateRows)} ردیف تکراری و {formatNumber(preview.removalBreakdown.invalidMobileRows)} ردیف با شماره نامعتبر حذف می‌شود.</p></div>}
            <section className="preview-panel"><div className="panel-heading"><h2>چند نمونه از تغییرها</h2><span>قبل ← بعد</span></div>{preview.changes.length ? <div className="change-list">{preview.changes.map((change, index) => <div className="change-row" key={index}><span className="change-location">{change.sheet} · ردیف {formatNumber(change.row)}</span><div><bdi dir="auto">{change.before}</bdi><ArrowLeft size={17} /><bdi dir="auto">{change.after}</bdi></div></div>)}</div> : <p className="empty-preview">تغییر سلولی انتخاب نشده؛ فقط ردیف‌های مشخص‌شده حذف می‌شن.</p>}{preview.removedSamples.length > 0 && <p className="removed-preview">نمونهٔ ردیف‌های حذف‌شونده: {preview.removedSamples.slice(0, 2).map((row) => row.sheet + "، ردیف " + formatNumber(row.row)).join(" • ")}</p>}</section>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="preview-actions"><button className="primary-button" type="button" onClick={startCleaning}>پاک‌سازی فایل <ArrowLeft size={18} /></button><button className="secondary-button" type="button" onClick={() => setStage("results")}>بازگشت به انتخاب‌ها</button></div>
          </div>}

          {stage === "done" && result && <div className="done-layout"><div className="done-icon"><Check size={35} /></div><span className="eyebrow small">فایل آماده‌ست</span><h1>فایلت مرتب شد!</h1><p>تغییرهایی که انتخاب کردی اعمال شدن. نسخهٔ تمیز آمادهٔ دریافت است.</p><div className="download-card"><span className="selected-file-icon"><FileSpreadsheet size={24} /></span><span><bdi dir="auto">{result.fileName}</bdi><small>{formatBytes(result.blob.size)} · {formatNumber(result.preview.changedCells)} سلول اصلاح‌شده · {formatNumber(result.preview.removedRows)} ردیف حذف‌شده</small></span></div><a className="primary-button download-button" href={downloadUrl} download={result.fileName} onClick={() => { setDownloaded(true); track("file_downloaded", { format: result.fileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx" }); }}><Download size={19} /> دانلود فایل تمیز</a><button className="text-button start-over" type="button" onClick={() => reset()}><RotateCcw size={17} /> بررسی یک فایل دیگر</button>
            {downloaded && <section className="feedback-card" aria-labelledby="feedback-title">
              <h2 id="feedback-title">پاک‌ساز به دردت خورد؟</h2>
              <p>نظرت کمک می‌کنه نسخهٔ بعدی بهتر بشه.</p>
              {feedbackState === "sent" ? <div className="feedback-thanks" role="status"><CheckCircle2 size={20} /> ممنون! بازخوردت ثبت شد.</div> : <>
                <div className="rating-actions">
                  <button className={rating === "positive" ? "selected" : ""} type="button" aria-pressed={rating === "positive"} onClick={() => { setRating("positive"); setFeedbackState("idle"); }}><ThumbsUp size={18} /> آره</button>
                  <button className={rating === "negative" ? "selected" : ""} type="button" aria-pressed={rating === "negative"} onClick={() => { setRating("negative"); setFeedbackState("idle"); }}><ThumbsDown size={18} /> نه، هنوز جا داره</button>
                </div>
                {rating && <div className="feedback-form">
                  <label htmlFor="feedback-note">چه چیزی کم بود؟ <span>اختیاری</span></label>
                  <textarea id="feedback-note" maxLength={600} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="مثلاً اصلاح تاریخ‌ها یا کد ملی…" rows={3} />
                  {usesGitHubFeedback ? <>
                    <small>بازخورد در GitHub عمومی می‌شه و حساب GitHub لازم داره. اطلاعات شخصی ننویس؛ فایلت پیوست نمی‌شه.</small>
                    <a className="secondary-button" href={githubFeedbackUrl()} target="_blank" rel="noopener noreferrer" onClick={() => track(rating === "positive" ? "feedback_positive" : "feedback_negative", { has_note: Boolean(feedbackText.trim()), destination: "github_issue" })}>ادامه در GitHub <ArrowUpLeft size={16} aria-hidden="true" /></a>
                    <small>فرم بازخورد در یک زبانهٔ تازه باز می‌شه؛ برای ثبت نهایی، دکمهٔ Create رو در GitHub بزن.</small>
                  </> : <>
                    <small>فقط همین پیام فرستاده می‌شه؛ محتوای فایل نه.</small>
                    <button type="button" className="secondary-button" disabled={feedbackState === "sending"} onClick={sendFeedback}>{feedbackState === "sending" ? "در حال ثبت…" : "ثبت بازخورد"}</button>
                    {feedbackState === "error" && <p className="form-error" role="alert">بازخورد ثبت نشد. اتصال رو بررسی کن و دوباره بزن.</p>}
                  </>}
                </div>}
              </>}
            </section>}
          </div>}
        </div>
      )}

      <section id="how-it-works" className="info-section wrap"><div className="section-heading"><span>یک کار ساده، در سه قدم</span><h2>فایل‌هات رو با خیال راحت مرتب کن</h2></div><div className="info-grid"><article><span className="step-number">۰۱</span><h3>فایل را انتخاب کن</h3><p>فایل Excel یا CSV را بده تا ایرادهای رایجش پیدا شود.</p></article><article><span className="step-number">۰۲</span><h3>تغییرها را بررسی کن</h3><p>ببین چه چیزهایی پیدا شده و فقط اصلاح‌های دلخواهت را روشن بگذار.</p></article><article><span className="step-number">۰۳</span><h3>نسخهٔ تمیز را بگیر</h3><p>خلاصهٔ تغییرها را ببین و فایل مرتب‌شده را دانلود کن.</p></article></div></section>
      <section id="privacy" className="privacy-strip wrap"><div className="privacy-icon"><ShieldCheck size={26} /></div><div><h2>فایلت برای خودت می‌ماند</h2><p>پردازش در مرورگر خودت انجام می‌شود. محتوای فایل به سرور فرستاده یا ذخیره نمی‌شود.</p></div></section>
      <footer className="site-footer wrap"><span>پاک‌ساز <span className="footer-dot">•</span> ابزاری ساده برای فایل‌های مرتب‌تر</span><a href="#top">بازگشت به بالا ↑</a></footer>
    </main>
  );
}
