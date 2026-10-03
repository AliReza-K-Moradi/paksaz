"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, Download, FileSpreadsheet, Info, LockKeyhole, RotateCcw, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, UploadCloud, X } from "lucide-react";
import { downloadName, formatBytes as localizeBytes, formatCount, formatNumber as localizeNumber, getCopy, getDirection, interpolate, type ErrorKey, type Language } from "../src/lib/i18n";
import { useLanguage } from "../src/lib/use-language";
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

const feedbackRepository = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "";
const usesGitHubFeedback = Boolean(feedbackRepository);

function track(event: string, detail: Record<string, string | number | boolean> = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("paksaz:analytics", { detail: { event, ...detail } }));
}

function issueCount(analysis: Analysis, issue: IssueSummary, mode: CleanOptions["digitMode"]) {
  return issue.id === "digits" ? getDigitIssueCount(analysis, mode) : issue.count;
}

function errorKey(error: unknown, fallback: ErrorKey): ErrorKey {
  return error instanceof CleanerError ? error.code : fallback;
}

function Stepper({ stage, language }: { stage: Stage; language: Language }) {
  const active = stage === "analyzing" ? 1 : stage === "results" ? 2 : stage === "preview" || stage === "cleaning" ? 3 : 4;
  const copy = getCopy(language);
  return <ol className="stepper" aria-label={copy.stepperLabel}>{copy.steps.map((label, index) => {
    const step = index + 1;
    return <li key={index} className={step === active ? "active" : step < active ? "complete" : ""} aria-current={step === active ? "step" : undefined}><span>{step < active ? <Check size={16} /> : localizeNumber(step, language)}</span><b>{label}</b></li>;
  })}</ol>;
}

export default function Home() {
  const [language, setLanguage] = useLanguage();
  const copy = getCopy(language);
  const direction = getDirection(language);
  const formatNumber = (value: number) => localizeNumber(value, language);
  const formatBytes = (value: number) => localizeBytes(value, language);
  const countLabel = (value: number, unit: "row" | "cell" | "sheet" | "issue") => formatCount(value, unit, language);
  const ForwardArrow = language === "en" ? ArrowRight : ArrowLeft;
  const BackArrow = language === "en" ? ArrowLeft : ArrowRight;
  const ExternalArrow = language === "en" ? ArrowUpRight : ArrowUpLeft;
  const pickerRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<ErrorKey | null>(null);
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
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    document.title = copy.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", copy.description);
  }, [language, direction, copy]);

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
    setError(null);
  }

  function chooseFile(candidate?: File) {
    setError(null);
    if (!candidate) return;
    if (!/\.(xlsx|csv)$/i.test(candidate.name)) {
      reset();
      setError("INVALID_TYPE");
      return;
    }
    if (candidate.size === 0) {
      reset();
      setError("EMPTY_FILE");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      reset();
      setError("TOO_LARGE");
      return;
    }
    reset(candidate);
    track("file_selected", { format: candidate.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx", size_bytes: candidate.size });
  }

  const startAnalysis = useCallback(async (): Promise<Analysis | null> => {
    if (!file) return null;
    setError(null);
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
      setError(errorKey(cause, "ANALYSIS_FAILED"));
      setStage("upload");
      return null;
    }
  }, [file]);

  function makePreview() {
    if (!analysis) return;
    try {
      const next = previewCleaning(analysis, options);
      setPreview(next);
      setError(null);
      setStage("preview");
    } catch (cause) {
      setError(errorKey(cause, "PREVIEW_FAILED"));
    }
  }

  const startCleaning = useCallback(async (): Promise<CleanResult | null> => {
    if (!analysis) return null;
    setError(null);
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
      setError(errorKey(cause, "CLEAN_FAILED"));
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
    const title = rating === "positive" ? copy.positiveIssueTitle : copy.negativeIssueTitle;
    const body = [
      rating === "positive" ? copy.positiveIssueBody : copy.negativeIssueBody,
      feedbackText.trim(),
      copy.issueFooter,
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
        language,
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
  }, [stage, language, file, analysis, options, preview, startAnalysis, startCleaning]);

  return (
    <main id="top" className="site-shell" lang={language} dir={direction}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="site-header wrap">
        <a className="brand" href="#top" onClick={() => { if (stage !== "upload") reset(); }} aria-label={copy.homeLabel}>
          <span className="brand-mark"><FileSpreadsheet size={21} strokeWidth={2.15} /></span><span>{copy.brand}</span>
        </a>
        <div className="header-actions">
          <nav aria-label={copy.navigation}><a href="#how-it-works">{copy.howItWorks}</a><a href="#privacy">{copy.privacy}</a></nav>
          <div className="language-switch" role="group" aria-label={copy.languageLabel} dir="ltr">
            <button type="button" lang="fa" dir="rtl" aria-pressed={language === "fa"} onClick={() => { setLanguage("fa"); track("language_changed", { language: "fa" }); }}>فارسی</button>
            <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => { setLanguage("en"); track("language_changed", { language: "en" }); }}>English</button>
          </div>
        </div>
      </header>

      {stage === "upload" ? (
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-main">
            <div className="eyebrow"><Sparkles size={16} /> {copy.eyebrow}</div>
            <h1 id="hero-title">{copy.heroTitle}</h1>
            <p className="hero-lead">{copy.heroLead}</p>
            <div className="upload-card">
              <div className="upload-card-heading"><span className="upload-icon"><UploadCloud size={25} strokeWidth={1.85} /></span><div><h2>{copy.uploadTitle}</h2><p>{copy.uploadHint}</p></div></div>
              <input ref={pickerRef} id="file-picker" className="visually-hidden" type="file" aria-label={copy.chooseFile} accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
              <div className={"dropzone" + (dragging ? " is-dragging" : "")} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
                {file ? <div className="selected-file">
                  <span className="selected-file-icon"><FileSpreadsheet size={23} /></span>
                  <span className="selected-file-name"><bdi dir="auto">{file.name}</bdi><small>{formatBytes(file.size)}</small></span>
                  <button className="remove-file" type="button" onClick={() => reset()} aria-label={copy.removeFile}><X size={19} /></button>
                </div> : <>
                  <span className="dropzone-art"><FileSpreadsheet size={30} strokeWidth={1.5} /></span><p>{copy.dropFile}</p><span>{copy.or}</span>
                  <button type="button" className="choose-button" onClick={() => pickerRef.current?.click()}>{copy.chooseFile} <ExternalArrow size={17} /></button>
                </>}
              </div>
              {file && <button type="button" className="change-file" onClick={() => pickerRef.current?.click()}>{copy.chooseAnother}</button>}
              {error && <p className="form-error" role="alert">{copy.errors[error]}</p>}
              <button className="primary-button" type="button" disabled={!file} onClick={startAnalysis}>{copy.analyze} <ForwardArrow size={19} /></button>
              <p className="local-note"><LockKeyhole size={15} /> {copy.localNote}</p>
            </div>
          </div>
          <aside className="hero-visual" aria-label={copy.sampleLabel}>
            <div className="visual-orbit orbit-one" aria-hidden="true" /><div className="visual-orbit orbit-two" aria-hidden="true" />
            <div className="sample-card">
              <div className="sample-top"><span className="sample-dots"><i /><i /><i /></span><span>{copy.sampleTitle}</span><span className="sample-table-icon"><FileSpreadsheet size={18} /></span></div>
              <div className="sample-body">
                <span className="sample-caption">{copy.mobileNumber}</span>
                <div className="sample-value before" dir="ltr">+98 912 123 4567 <span>{copy.before}</span></div>
                <div className="sample-arrow" aria-hidden="true"><ArrowLeft size={19} /></div>
                <div className="sample-value after" dir="ltr">09121234567 <span>{copy.after}</span></div>
                <div className="sample-rule" /><span className="sample-caption">{copy.persianLetters}</span>
                <div className="sample-text" dir="rtl" lang="fa"><span>شركت پارسي</span><ArrowLeft size={16} /><strong>شرکت پارسی</strong></div>
              </div>
            </div>
            <div className="floating-proof"><span><Check size={17} /></span> {copy.sampleProof}</div>
          </aside>
        </section>
      ) : (
        <div className="workspace wrap" ref={contentRef}>
          <p className="visually-hidden" role="status" aria-live="polite">{copy.status[stage]}</p>
          <Stepper stage={stage} language={language} />
          {stage === "analyzing" || stage === "cleaning" ? <section className="waiting-card" role="status" aria-live="polite">
            <div className="waiting-spinner" /><h1>{stage === "analyzing" ? copy.analyzingTitle : copy.cleaningTitle}</h1>
            <p>{stage === "analyzing" ? copy.analyzingHint : copy.cleaningHint}</p>
          </section> : null}

          {stage === "results" && analysis && <div className="workflow">
            <div className="workflow-heading">
              <div><span className="eyebrow small"><CheckCircle2 size={15} /> {copy.analysisDone}</span><h1>{copy.resultsTitle}</h1><p>{copy.resultsLead}</p></div>
              <button className="text-button" type="button" onClick={() => reset()}><RotateCcw size={17} /> {copy.anotherFile}</button>
            </div>
            <div className="workflow-grid">
              <aside className="file-summary">
                <span className="summary-icon"><FileSpreadsheet size={22} /></span><h2><bdi dir="auto">{analysis.fileName}</bdi></h2>
                <p>{analysis.fileType.toUpperCase()} <span>•</span> {countLabel(analysis.totalRows, "row")} <span>•</span> {countLabel(analysis.sheets.length, "sheet")}</p>
                <div className="summary-line" />
                <div className="summary-stat"><strong>{formatNumber(effectiveIssues.length)}</strong><span>{copy.issueTypes}</span></div>
                <div className="summary-stat"><strong>{formatNumber(selectedCount)}</strong><span>{copy.selectedFixes}</span></div>
                <p className="summary-privacy"><LockKeyhole size={15} /> {copy.summaryPrivacy}</p>
              </aside>
              <section className="issues-panel" aria-label={copy.detectedIssues}>
                {analysis.warningCodes.map((warning) => <div className="warning-banner" key={warning}><Info size={18} /><p>{copy.warnings[warning]}</p></div>)}
                {displayNoIssues ? <div className="no-issues">
                  <span><CheckCircle2 size={31} /></span><h2>{copy.noIssuesTitle}</h2><p>{copy.noIssuesLead}</p>
                  <button className="secondary-button" type="button" onClick={() => reset()}>{copy.analyzeAnother}</button>
                </div> : <>
                  <div className="issues-heading"><h2>{copy.suggestedFixes}</h2><span>{countLabel(effectiveIssues.length, "issue")}</span></div>
                  <div className="issues-list">{analysis.issues.map((issue) => {
                    const count = issueCount(analysis, issue, options.digitMode);
                    const examples = issue.id === "digits" ? getDigitIssueExamples(analysis, options.digitMode) : issue.examples;
                    if (!count && issue.id !== "digits") return null;
                    return <article className={"issue-card" + (options[issue.id] && count ? " checked" : "")} key={issue.id}>
                      <label className="issue-row">
                        <input type="checkbox" checked={options[issue.id]} onChange={(event) => updateOption(issue.id, event.target.checked)} disabled={count === 0} />
                        <span className="fake-check"><Check size={14} /></span>
                        <span className="issue-title"><strong>{copy.issues[issue.id].label}</strong><small>{copy.issues[issue.id].description}</small></span>
                        <span className="issue-count">{countLabel(count, issue.destructive ? "row" : "cell")}</span>
                      </label>
                      {issue.destructive && <p className="destructive-note">{copy.destructiveNote}</p>}
                      {issue.id === "digits" && <div className="digit-choice">
                        <label htmlFor="digit-mode">{copy.digitDirection}</label>
                        <div className="select-wrap"><select id="digit-mode" value={options.digitMode} onChange={(event) => setOptions((current) => ({ ...current, digitMode: event.target.value as CleanOptions["digitMode"] }))}>
                          <option value="latin">{copy.latinDigits}</option><option value="persian">{copy.persianDigits}</option>
                        </select><ChevronDown size={17} /></div><small>{copy.mobileDigitsNote}</small>
                      </div>}
                      {examples.length > 0 && count > 0 && <div className="issue-examples">{examples.slice(0, 2).map((example, index) => <div className="example-line" key={index}>
                        <span className="example-locator"><bdi dir="auto">{example.sheet}</bdi> · {copy.row} {formatNumber(example.row)}</span>
                        <span className="example-values"><bdi dir="auto">{issue.id === "emptyRows" || !example.before ? copy.emptyRow : example.before}</bdi>{example.after && <><ForwardArrow size={16} /><bdi dir="auto">{example.after}</bdi></>}</span>
                      </div>)}</div>}
                    </article>;
                  })}</div>
                  {error && <p className="form-error" role="alert">{copy.errors[error]}</p>}
                  <div className="workflow-actions"><button className="primary-button" type="button" disabled={selectedCount === 0} onClick={makePreview}>{copy.showPreview} <ForwardArrow size={18} /></button>{selectedCount === 0 && <p>{copy.selectOneFix}</p>}</div>
                </>}
              </section>
            </div>
          </div>}

          {stage === "preview" && analysis && preview && <div className="workflow">
            <div className="workflow-heading"><div><span className="eyebrow small"><Sparkles size={15} /> {copy.beforeCleaning}</span><h1>{copy.previewTitle}</h1><p>{copy.previewLead}</p></div><button className="text-button" type="button" onClick={() => setStage("results")}><BackArrow size={17} /> {copy.editChoices}</button></div>
            <div className="preview-stats"><div><strong>{formatNumber(preview.changedCells)}</strong><span>{copy.cellsToChange}</span></div><div><strong>{formatNumber(preview.removedRows)}</strong><span>{copy.rowsToRemove}</span></div><div><strong>{formatNumber(preview.remainingRows)}</strong><span>{copy.rowsRemaining}</span></div></div>
            {preview.removedRows > 0 && <div className="warning-banner prominent"><Info size={19} /><p>{interpolate(copy.removalSummary, { empty: formatNumber(preview.removalBreakdown.emptyRows), duplicate: formatNumber(preview.removalBreakdown.duplicateRows), invalid: formatNumber(preview.removalBreakdown.invalidMobileRows) })}</p></div>}
            <section className="preview-panel">
              <div className="panel-heading"><h2>{copy.changeExamples}</h2><span>{copy.comparison}</span></div>
              {preview.changes.length ? <div className="change-list">{preview.changes.map((change, index) => <div className="change-row" key={index}><span className="change-location"><bdi dir="auto">{change.sheet}</bdi> · {copy.row} {formatNumber(change.row)}</span><div><bdi dir="auto">{change.before}</bdi><ForwardArrow size={17} /><bdi dir="auto">{change.after}</bdi></div></div>)}</div> : <p className="empty-preview">{copy.emptyPreview}</p>}
              {preview.removedSamples.length > 0 && <p className="removed-preview">{copy.removedExamples} {preview.removedSamples.slice(0, 2).map((row, index) => <span key={index}>{index > 0 && " • "}<bdi dir="auto">{row.sheet}</bdi> · {copy.row} {formatNumber(row.row)}</span>)}</p>}
            </section>
            {error && <p className="form-error" role="alert">{copy.errors[error]}</p>}
            <div className="preview-actions"><button className="primary-button" type="button" onClick={startCleaning}>{copy.clean} <ForwardArrow size={18} /></button><button className="secondary-button" type="button" onClick={() => setStage("results")}>{copy.backToChoices}</button></div>
          </div>}

          {stage === "done" && result && <div className="done-layout">
            <div className="done-icon"><Check size={35} /></div><span className="eyebrow small">{copy.fileReady}</span><h1>{copy.doneTitle}</h1><p>{copy.doneLead}</p>
            <div className="download-card"><span className="selected-file-icon"><FileSpreadsheet size={24} /></span><span><bdi dir="auto">{downloadName(result.fileName, language)}</bdi><small>{formatBytes(result.blob.size)} · {interpolate(copy.downloadSummary, { cells: formatNumber(result.preview.changedCells), rows: formatNumber(result.preview.removedRows) })}</small></span></div>
            <a className="primary-button download-button" href={downloadUrl} download={downloadName(result.fileName, language)} onClick={() => { setDownloaded(true); track("file_downloaded", { format: result.fileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx" }); }}><Download size={19} /> {copy.download}</a>
            <button className="text-button start-over" type="button" onClick={() => reset()}><RotateCcw size={17} /> {copy.startOver}</button>
            {downloaded && <section className="feedback-card" aria-labelledby="feedback-title">
              <h2 id="feedback-title">{copy.feedbackTitle}</h2><p>{copy.feedbackLead}</p>
              {feedbackState === "sent" ? <div className="feedback-thanks" role="status"><CheckCircle2 size={20} /> {copy.feedbackThanks}</div> : <>
                <div className="rating-actions">
                  <button className={rating === "positive" ? "selected" : ""} type="button" aria-pressed={rating === "positive"} onClick={() => { setRating("positive"); setFeedbackState("idle"); }}><ThumbsUp size={18} /> {copy.positive}</button>
                  <button className={rating === "negative" ? "selected" : ""} type="button" aria-pressed={rating === "negative"} onClick={() => { setRating("negative"); setFeedbackState("idle"); }}><ThumbsDown size={18} /> {copy.negative}</button>
                </div>
                {rating && <div className="feedback-form">
                  <label htmlFor="feedback-note">{copy.missingFeature} <span>{copy.optional}</span></label>
                  <textarea id="feedback-note" dir="auto" maxLength={600} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder={copy.feedbackPlaceholder} rows={3} />
                  {usesGitHubFeedback ? <>
                    <small>{copy.githubPrivacy}</small>
                    <a className="secondary-button" href={githubFeedbackUrl()} target="_blank" rel="noopener noreferrer" onClick={() => track(rating === "positive" ? "feedback_positive" : "feedback_negative", { has_note: Boolean(feedbackText.trim()), destination: "github_issue" })}>{copy.continueGithub} <ExternalArrow size={16} aria-hidden="true" /></a>
                    <small>{copy.githubHint}</small>
                  </> : <>
                    <small>{copy.feedbackPrivacy}</small>
                    <button type="button" className="secondary-button" disabled={feedbackState === "sending"} onClick={sendFeedback}>{feedbackState === "sending" ? copy.sendingFeedback : copy.submitFeedback}</button>
                    {feedbackState === "error" && <p className="form-error" role="alert">{copy.feedbackError}</p>}
                  </>}
                </div>}
              </>}
            </section>}
          </div>}
        </div>
      )}

      <section id="how-it-works" className="info-section wrap">
        <div className="section-heading"><span>{copy.infoEyebrow}</span><h2>{copy.infoTitle}</h2></div>
        <div className="info-grid">{copy.infoSteps.map((step, index) => <article key={index}><span className="step-number">{localizeNumber(index + 1, language, { minimumIntegerDigits: 2 })}</span><h3>{step.title}</h3><p>{step.body}</p></article>)}</div>
      </section>
      <section id="privacy" className="privacy-strip wrap"><div className="privacy-icon"><ShieldCheck size={26} /></div><div><h2>{copy.privacyTitle}</h2><p>{copy.privacyBody}</p></div></section>
      <footer className="site-footer wrap"><span>{copy.brand} <span className="footer-dot">•</span> {copy.footer}</span><a href="#top">{copy.backToTop}</a></footer>
    </main>
  );
}
