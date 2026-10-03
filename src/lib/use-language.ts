"use client";

import { useSyncExternalStore } from "react";
import type { Language } from "./i18n";

const STORAGE_KEY = "paksaz:language";
const CHANGE_EVENT = "paksaz:language-changed";
let sessionLanguage: Language | null = null;
const isLanguage = (value: string | null): value is Language => value === "fa" || value === "en";

function readLanguage(): Language {
  if (typeof window === "undefined") return "fa";
  if (sessionLanguage) return sessionLanguage;
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (isLanguage(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch { /* Language selection still works when browser storage is blocked. */ }
  return "fa";
}

function subscribe(onChange: () => void) {
  const refresh = () => { sessionLanguage = null; onChange(); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("popstate", refresh);
  window.addEventListener("storage", refresh);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", refresh);
    window.removeEventListener("storage", refresh);
  };
}

function changeLanguage(language: Language) {
  sessionLanguage = language;
  try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* Optional persistence. */ }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", language);
    window.history.replaceState(window.history.state, "", url);
  } catch { /* In-memory selection remains usable in restricted browser contexts. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// A stable Persian server snapshot avoids hydration mismatches on the optional Sites build.
export function useLanguage() {
  const language = useSyncExternalStore(subscribe, readLanguage, () => "fa" as Language);
  return [language, changeLanguage] as const;
}
