import Link from 'next/link';
import { WEBSITE_REQUEST_LEGAL_TRANSITIONS, type WebsiteRequestDetail } from '@clinic/contracts';
import {
  Alert,
  Badge,
  ButtonLink,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { toPersianDigits } from '@/server/numerals-fa';
import { ConfirmedSubmitButton } from './confirmed-submit-button';
import { INITIAL_WEBSITE_REQUEST_FAMILY_SEARCH } from './family-search-state';
import {
  CHILD_SEX_LABEL,
  CONTACT_TIME_LABEL,
  WEBSITE_REQUEST_STATUS_ACTION,
  WEBSITE_REQUEST_STATUS_LABEL,
  WEBSITE_REQUEST_STATUS_TONE,
  formatWebsiteRequestInstant,
} from './presentation';
import { WebsiteRequestFamilySearch } from './website-request-family-search';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function WebsiteRequestDetailView({
  request,
  csrfToken,
  canProcess,
  canLink,
  canCreateFamily,
  errorMessage,
  successMessage,
}: {
  request: WebsiteRequestDetail;
  csrfToken: string;
  canProcess: boolean;
  canLink: boolean;
  canCreateFamily: boolean;
  errorMessage: string | null;
  successMessage: string | null;
}) {
  const legal = WEBSITE_REQUEST_LEGAL_TRANSITIONS[request.status];
  const statusActions = legal.filter(
    (status): status is 'CONTACTED' | 'FOLLOW_UP_NEEDED' | 'CLOSED' =>
      status !== 'CONVERTED_TO_FAMILY' && status !== 'NEW',
  );
  const conversionAvailable =
    !request.contentPurged &&
    request.linkedFamily === null &&
    legal.includes('CONVERTED_TO_FAMILY');

  return (
    <PageShell wide>
      <PageHeader
        title="جزئیات درخواست ارزیابی"
        description={`دریافت در ${formatWebsiteRequestInstant(request.receivedAt)}`}
        backHref="/website-requests"
        backLabel="بازگشت به درخواست‌ها"
        action={
          <Badge tone={WEBSITE_REQUEST_STATUS_TONE[request.status]}>
            {WEBSITE_REQUEST_STATUS_LABEL[request.status]}
          </Badge>
        }
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {successMessage !== null ? <Alert tone="info">{successMessage}</Alert> : null}

      {request.contentPurged ? (
        <Alert tone="info">
          اطلاعات شخصی این درخواست طبق سیاست نگهداری حذف شده است. وضعیت و زمان‌های چرخهٔ درخواست
          برای سابقه باقی مانده‌اند.
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="اطلاعات درخواست">
          <dl className="grid gap-3">
            {request.contentPurged ? (
              <>
                <Fact label="زمان دریافت">{formatWebsiteRequestInstant(request.receivedAt)}</Fact>
                <Fact label="وضعیت">{WEBSITE_REQUEST_STATUS_LABEL[request.status]}</Fact>
                <Fact label="زمان حذف اطلاعات">
                  {formatWebsiteRequestInstant(request.purgedAt)}
                </Fact>
              </>
            ) : (
              <>
                <Fact label="نام تماس‌گیرنده">{request.contactName}</Fact>
                <Fact label="شماره همراه">
                  <bdi dir="ltr">{request.contactMobile}</bdi>
                </Fact>
                <Fact label="نام کودک">{request.childName ?? 'ثبت نشده'}</Fact>
                <Fact label="سن اعلام‌شدهٔ کودک">
                  {toPersianDigits(String(request.childAgeYears))} سال
                </Fact>
                <Fact label="جنسیت کودک">{CHILD_SEX_LABEL[request.childSex]}</Fact>
                <Fact label="خدمت درخواستی">{request.requestedService?.name ?? 'ثبت نشده'}</Fact>
                <Fact label="زمان ترجیحی تماس">
                  {request.preferredContactTime === null
                    ? 'ثبت نشده'
                    : CONTACT_TIME_LABEL[request.preferredContactTime]}
                </Fact>
                <Fact label="یادداشت">{request.note ?? 'یادداشتی ثبت نشده است.'}</Fact>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="وضعیت و پیوند">
          <dl className="grid gap-3">
            <Fact label="وضعیت کنونی">{WEBSITE_REQUEST_STATUS_LABEL[request.status]}</Fact>
            <Fact label="آخرین تغییر وضعیت">
              {request.statusChangedAt === null
                ? 'هنوز تغییری ثبت نشده است.'
                : formatWebsiteRequestInstant(request.statusChangedAt)}
            </Fact>
            <Fact label="خانوادهٔ پیوندشده">
              {request.linkedFamily === null ? (
                'پیوندی ثبت نشده است.'
              ) : (
                <Link
                  href={`/families/${request.linkedFamily.id}`}
                  className="font-semibold text-brand-800 underline underline-offset-4"
                >
                  {request.linkedFamily.familyName}
                </Link>
              )}
            </Fact>
          </dl>

          {canProcess && statusActions.length > 0 ? (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">اقدام بعدی</h3>
              <div className="flex flex-wrap gap-2">
                {statusActions.map((status) => (
                  <form key={status} method="post" action="/api/website-requests/status">
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="status" value={status} />
                    {status === 'CLOSED' ? (
                      <ConfirmedSubmitButton confirmation="بستن درخواست قطعی است و امکان بازگشایی ندارد. ادامه می‌دهید؟">
                        {WEBSITE_REQUEST_STATUS_ACTION[status]}
                      </ConfirmedSubmitButton>
                    ) : (
                      <SubmitButton tone="secondary">
                        {WEBSITE_REQUEST_STATUS_ACTION[status]}
                      </SubmitButton>
                    )}
                  </form>
                ))}
              </div>
            </div>
          ) : request.status === 'CLOSED' || request.status === 'CONVERTED_TO_FAMILY' ? (
            <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
              این وضعیت نهایی است و اقدام دیگری برای چرخهٔ درخواست ندارد.
            </p>
          ) : null}
        </Panel>
      </div>

      {conversionAvailable && canLink ? (
        <section aria-labelledby="website-request-conversion" className="flex flex-col gap-4">
          <div>
            <h2 id="website-request-conversion" className="text-lg font-bold text-slate-900">
              تبدیل به خانواده
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              ابتدا خانوادهٔ موجود را جست‌وجو کنید؛ پیوند فقط پس از انتخاب و تأیید شما انجام می‌شود.
            </p>
          </div>
          <WebsiteRequestFamilySearch
            requestId={request.id}
            csrfToken={csrfToken}
            initial={INITIAL_WEBSITE_REQUEST_FAMILY_SEARCH}
          />
          {canCreateFamily ? (
            <Panel title="خانوادهٔ تازه">
              <p className="text-sm leading-7 text-slate-600">
                اگر خانوادهٔ مناسبی پیدا نشد، مسیر عادی ثبت خانواده را باز کنید. اطلاعات تماس همین
                درخواست در فرم مشخص می‌شود و کنترل تکراری بودن همچنان اجرا خواهد شد.
              </p>
              <FormActions>
                <ButtonLink href={`/families/new?fromWebsiteRequest=${request.id}`}>
                  شروع ثبت عادی خانواده
                </ButtonLink>
              </FormActions>
            </Panel>
          ) : null}
        </section>
      ) : null}
    </PageShell>
  );
}
