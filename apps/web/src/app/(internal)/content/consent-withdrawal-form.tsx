import { SubmitButton } from '@/components/ui';

export const WITHDRAWAL_CONFIRMATION =
  'این نقل‌قول همین حالا از سایت برداشته می‌شود. متن، نام یا عنوان گوینده و همهٔ عکس‌هایی که تا امروز به آن وصل بوده‌اند، در همهٔ جایگاه‌های استفاده از آن عکس‌ها، برای همیشه پاک می‌شوند؛ معمولاً همان شب و در هر صورت حداکثر تا ۷ روز پس از ثبت پس‌گرفتن رضایت. این کار برگشت‌پذیر نیست. آیا رضایت خانواده را پس می‌گیرید؟';

export function ConsentWithdrawalForm({ id, csrfToken }: { id: string; csrfToken: string }) {
  return (
    <details className="rounded-lg border border-red-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-red-900">
        ثبت پس‌گرفتن رضایت خانواده
      </summary>
      <form
        method="post"
        action="/api/content/testimonials/consent-withdrawal"
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="id" value={id} />
        <p className="text-sm leading-7 text-red-950">{WITHDRAWAL_CONFIRMATION}</p>
        <label className="flex items-start gap-2 text-sm text-red-950">
          <input type="checkbox" name="confirmed" value="yes" required />
          پیامدهای پاک‌سازی همیشگی را خواندم و پس‌گرفتن رضایت را تأیید می‌کنم.
        </label>
        <SubmitButton tone="danger">تأیید و ثبت پس‌گرفتن رضایت</SubmitButton>
      </form>
    </details>
  );
}
