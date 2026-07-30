# روند اجرای پروژه با Claude Code

## 1. ساخت Repository

ساختار اولیه:

```text
repo/
  CLAUDE.md
  docs/
    PROJECT_SPEC.md
    CLAUDE_CODE_WORKFLOW.md
  .gitignore
  README.md
```

ابتدا اسناد را Commit کنید:

```bash
git init
git add CLAUDE.md docs/
git commit -m "docs: add clinic MVP specification"
```

## 2. شروع Plan Mode

```bash
claude --permission-mode plan
```

## 3. Prompt اول

Prompt بخش 38 فایل `PROJECT_SPEC.md` را ارسال کنید. در این مرحله Claude Code حق ویرایش، نصب Package یا اجرای Migration ندارد.

## 4. خروجی لازم از Plan

- Scope و Non-goal
- تصمیم‌های باز
- اعتبارسنجی معماری Next.js + NestJS و مقایسهٔ Selective BFF با Direct API و Proxy-all
- مرز مسئولیت Web/BFF و API
- مقایسه Prisma و TypeORM
- Auth/Session Flow و OpenAPI Client Generation
- برنامهٔ SEO و Rendering
- ERD
- State Transition نوبت
- Ledger و Payment Design
- Permission Matrix
- Security و Backup
- Test Plan
- Milestoneهای کوچک
- فایل‌های مورد انتظار دو مرحلهٔ اول
- ریسک‌ها

خروجی کامل را قبل از تأیید برای بازبینی خارجی ارسال کنید.

موارد معماری که باید صریح باشند:

- Next.js هیچ دسترسی مستقیمی به PostgreSQL ندارد.
- NestJS منبع حقیقت تمام قواعد مالی و مجوزها است.
- Server Componentها NestJS را از Server-only API Client صدا می‌زنند، نه Route Handler داخلی Next.js.
- BFF فقط Endpointهای صریح دارد و Catch-all Proxy پیش‌فرض ممنوع است.
- قرارداد API از OpenAPI و Client تولیدشده کنترل می‌شود.
- تمام Mutationها در NestJS دوباره Validation و Authorization می‌شوند.

## 5. اجرای مرحله‌ای

بعد از تأیید، فقط یک Milestone اجرا شود. در پایان:

```bash
git status
git diff --stat
git diff
```

همراه این موارد بررسی شود:

- Migration
- Test Output
- دستورات اجرا
- اثر امنیتی
- انحراف از Plan
- تصمیم‌های باز

## 6. Commitهای کوچک

نمونه:

```text
chore: initialize project and local environment
feat: add Nest auth and manager receptionist roles
feat: add family API and Next admin screens
feat: add reference-data API and admin screens
feat: add appointment API and Next scheduling UI
feat: create idempotent charges from completed appointments
feat: add payments and family balances
feat: add payment promises and debt dashboard
```

Refactor، Format، Dependency و Feature نامرتبط را در یک Commit مخلوط نکنید.

## 7. ایمنی Migration

قبل از هر Migration:

1. توضیح Schema Change
2. بررسی فایل Migration
3. اطمینان از عدم حذف یا بازنویسی داده
4. اجرا روی دیتابیس Development
5. اجرای Test
6. Commit بعد از تأیید

## 8. Pilot

1. Seed ساختگی
2. اجرای سناریوهای پذیرش
3. شبیه‌سازی کار منشی
4. رفع مشکل Workflow
5. تست Backup و Restore
6. آموزش با دادهٔ ساختگی
7. Pilot محدود
8. تطبیق مجموع سیستم با روش قبلی
9. توسعه پس از تطبیق

## 9. چیزهایی که برای بازبینی ارسال می‌شوند

- Plan کامل یا Summary اجرا
- `git diff --stat`
- Diff مرتبط
- Migrationها
- Model/Schema Changes
- Test Output
- Error و Warning
- Screenshot صفحات هنگام UI
- تمام سؤال‌های Claude دربارهٔ قواعد کسب‌وکار

اطلاعات واقعی خانواده یا کودک ارسال نشود.
