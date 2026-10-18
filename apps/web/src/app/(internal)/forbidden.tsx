import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-12 text-slate-900">
      <p className="text-sm font-semibold text-amber-800">دسترسی مجاز نیست</p>
      <h1 className="text-2xl font-black">اجازهٔ دیدن این صفحه را ندارید</h1>
      <p className="leading-7 text-slate-700">
        این بخش برای نقش شما در دسترس نیست. برای ادامه به پیشخوان برگردید.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center self-start rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white hover:bg-brand-800"
      >
        بازگشت به پیشخوان
      </Link>
    </main>
  );
}
