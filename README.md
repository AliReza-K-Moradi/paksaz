# پاک‌ساز

یک ابزار فارسی و راست‌به‌چپ برای پیدا کردن و اصلاح مشکلات رایج فایل‌های `.xlsx` و `.csv`. فایل در مرورگر خوانده، بررسی و خروجی گرفته می‌شود؛ محتوای آن به سرور فرستاده نمی‌شود.

[باز کردن پاک‌ساز](https://alireza-k-moradi.github.io/paksaz/) · [مخزن GitHub](https://github.com/AliReza-K-Moradi/paksaz)

## فارسی و English

تمام مسیر پاک‌سازی به فارسی و انگلیسی در دسترس است. کلید زبان در بالای هر صفحه دیده می‌شود؛ تغییر زبان، فایل انتخاب‌شده و تنظیمات پاک‌سازی را حفظ می‌کند. فارسی راست‌به‌چپ و انگلیسی چپ‌به‌راست نمایش داده می‌شود. انتخاب زبان فقط روی دستگاه ذخیره می‌شود و با `?lang=fa` یا `?lang=en` می‌توان پیوند مستقیم هر زبان را به اشتراک گذاشت.

[English version](https://alireza-k-moradi.github.io/paksaz/?lang=en) · [نسخهٔ فارسی](https://alireza-k-moradi.github.io/paksaz/?lang=fa)

Copy lives in `src/lib/i18n.ts`. The language switch changes the interface, number formatting and download suffix; it does not translate spreadsheet contents or change the selected digit normalization rule.

## GitHub Pages

نسخهٔ عمومی روی GitHub Pages یک برنامهٔ کاملاً ایستا است. برای اجرا و ساخت همین نسخه:

```bash
pnpm install --frozen-lockfile
pnpm dev:pages
pnpm build:pages
pnpm preview:pages
```

خروجی در `dist-pages/` قرار می‌گیرد. مسیر پیش‌فرض `/paksaz/` است؛ برای دامنهٔ اختصاصی یا مسیر متفاوت، متغیر `PAGES_BASE_PATH` را تنظیم کنید. `PAGES_GITHUB_REPO` مقصد بازخورد را به شکل `owner/repo` مشخص می‌کند.

گردش‌کار `.github/workflows/pages.yml` با هر تغییر در شاخهٔ `main`، بررسی نوع‌ها و آزمون‌های پاک‌سازی را اجرا می‌کند، برنامه را می‌سازد و به Pages می‌فرستد. در تنظیمات مخزن، مسیر **Settings → Pages → Source** باید **GitHub Actions** باشد.

در این نسخه، انتخاب رأی و پیام اختیاری، فرم آمادهٔ GitHub Issue را در زبانهٔ تازه باز می‌کند. کاربر پیام را بررسی و در GitHub ثبت می‌کند؛ حساب GitHub لازم است و بازخورد عمومی خواهد بود. هیچ فایل یا محتوای سلولی همراه آن فرستاده نمی‌شود. رویدادهای رأی در این حالت فقط کلیک برای ادامه در GitHub را نشان می‌دهند، نه تأیید ثبت Issue.

## اجرای نسخهٔ دارای سرور Sites

Node.js نسخهٔ 22.13 یا بالاتر و pnpm نسخهٔ 11 لازم است.

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

آدرس محلی در خروجی فرمان دوم نمایش داده می‌شود (معمولاً `http://localhost:5173/`). برای ساخت نسخهٔ قابل انتشار:

```bash
pnpm run build
```

نمونه‌فایل برای امتحان کردن مسیر کامل در `samples/sample-contacts.csv` قرار دارد.

## امکانات نسخهٔ اول

- تشخیص و یکسان‌سازی شماره موبایل ایران به شکل `09xxxxxxxxx` با رقم انگلیسی
- تبدیل `ي/ك` عربی به `ی/ک` فارسی و اصلاح فاصله‌های اضافی
- انتخاب جهت تبدیل ارقام در متن: فارسی به انگلیسی یا انگلیسی به فارسی
- پیدا کردن ردیف‌های خالی و ردیف‌های *دقیقاً* تکراری
- پیدا کردن شماره موبایل نامعتبر در ستون‌های تشخیص‌داده‌شده
- نمایش تعداد موارد و نمونه‌ها، انتخاب اصلاح‌ها، پیش‌نمایش و دریافت فایل
- روشن بودن اصلاح‌های متنی و شماره‌های معتبر؛ خاموش بودن تمام گزینه‌های حذف ردیف
- پردازش همهٔ برگه‌های XLSX و نگه‌داشتن برگه‌های پنهان در خروجی
- بازخورد مثبت/منفی و متن اختیاری: GitHub Issues در Pages، یا پایگاه داده در نسخهٔ Sites

## محدودیت‌های آگاهانه

- سقف حجم فایل ۱۰ مگابایت است؛ فایل‌های بسیار بزرگ‌تر از ۱۵۰ هزار ردیف یا ۲ میلیون سلول پذیرفته نمی‌شوند.
- فایل XLSX دارای فرمول رد می‌شود تا خروجی به‌اشتباه فرمول‌ها را حذف یا به مقدار ثابت تبدیل نکند.
- هنگام بازنویسی XLSX، قالب‌بندی پیچیدهٔ Excel ممکن است تغییر کند. این هشدار پیش از پاک‌سازی نمایش داده می‌شود.
- تشخیص ستون موبایل از عنوان ستون و الگوی مقادیر کمک می‌گیرد. حذف شماره‌های نامعتبر فقط با انتخاب کاربر انجام می‌شود.
- خروجی CSV با UTF-8 و BOM ساخته می‌شود تا در Excel فارسی بهتر باز شود.

## بازخورد و پایگاه دادهٔ اختیاری Sites

پیکربندی Sites در `.openai/hosting.json` یک اتصال D1 با نام `DB` تعریف می‌کند. تعریف جدول در `db/schema.ts` و مهاجرت آن در `drizzle/0000_mute_phalanx.sql` است. برای آماده کردن پایگاه دادهٔ محلی، پس از نخستین ساخت:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mute_phalanx.sql
```

مسیر `POST /api/feedback` فقط `rating` (`positive` یا `negative`) و `note` تا ۶۰۰ نویسه می‌پذیرد. نام و محتوای فایل به این مسیر ارسال نمی‌شود.

این مسیر در GitHub Pages اجرا نمی‌شود؛ نسخهٔ ایستا از پیوند Issues استفاده می‌کند.

## رویدادهای تحلیل

رابط کاربری `CustomEvent`هایی با نام `paksaz:analytics` روی `window` منتشر می‌کند. در `event.detail.event` این نام‌ها ممکن است بیایند: `file_selected`، `analysis_started`، `analysis_completed`، `issue_detected_*`، `clean_started`، `clean_completed`، `file_downloaded`، `feedback_positive` و `feedback_negative`. فقط نوع فایل، اندازه و شمارنده‌های کلی در رویدادها هستند؛ نام فایل، شماره تلفن و محتوای سلول‌ها هرگز در آن‌ها قرار نمی‌گیرند. هیچ سرویس تحلیلی خارجی در این نسخه نصب نشده است.

## بررسی

```bash
pnpm exec tsc --noEmit
node --experimental-strip-types --test src/lib/cleaner.test.mjs
```
