import type { Metadata } from "next";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/vazirmatn/800.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "پاک‌ساز | پاک‌سازی فایل‌های Excel و CSV فارسی",
  description: "مشکلات رایج فایل‌های اکسل و CSV را روی دستگاه خودتان پیدا و اصلاح کنید؛ از شماره موبایل تا حروف فارسی و ردیف‌های تکراری.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
