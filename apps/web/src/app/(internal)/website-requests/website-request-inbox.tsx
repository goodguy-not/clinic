import Link from 'next/link';
import {
  WEBSITE_REQUEST_STATUSES,
  type WebsiteRequestInboxResponse,
  type WebsiteRequestStatus,
} from '@clinic/contracts';
import {
  Badge,
  ButtonLink,
  EmptyState,
  FOCUS_RING,
  PageHeader,
  PageShell,
  RecordItem,
  RecordList,
} from '@/components/ui';
import { toPersianDigits } from '@/server/numerals-fa';
import {
  CHILD_SEX_LABEL,
  CONTACT_TIME_LABEL,
  WEBSITE_REQUEST_STATUS_LABEL,
  WEBSITE_REQUEST_STATUS_TONE,
  formatWebsiteRequestInstant,
} from './presentation';

function inboxHref(statuses: readonly WebsiteRequestStatus[], page = 1): string {
  const search = new URLSearchParams();
  for (const status of statuses) search.append('statuses', status);
  if (page > 1) search.set('page', String(page));
  const suffix = search.toString();
  return suffix === '' ? '/website-requests' : `/website-requests?${suffix}`;
}

export function WebsiteRequestInbox({
  inbox,
  selectedStatuses,
}: {
  inbox: WebsiteRequestInboxResponse;
  selectedStatuses: readonly WebsiteRequestStatus[];
}) {
  const counts = new Map(inbox.statusCounts.map((row) => [row.status, row.count]));
  const allSelected = selectedStatuses.length === 0;

  return (
    <PageShell wide>
      <PageHeader
        title="درخواست‌های ارزیابی وب‌سایت"
        description="برای تماس و تعیین قدم بعد، درخواست‌ها را مرور کنید."
      />

      <nav aria-label="فیلتر وضعیت درخواست‌ها" className="flex flex-wrap gap-2">
        <Link
          href="/website-requests"
          aria-current={allSelected ? 'page' : undefined}
          className={`rounded-full border px-3 py-2 text-sm font-semibold ${allSelected ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'} ${FOCUS_RING}`}
        >
          همه
        </Link>
        {WEBSITE_REQUEST_STATUSES.map((status) => {
          const active = selectedStatuses.length === 1 && selectedStatuses[0] === status;
          return (
            <Link
              key={status}
              href={inboxHref([status])}
              aria-current={active ? 'page' : undefined}
              className={`rounded-full border px-3 py-2 text-sm font-semibold ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'} ${FOCUS_RING}`}
            >
              {WEBSITE_REQUEST_STATUS_LABEL[status]} ·{' '}
              {toPersianDigits(String(counts.get(status) ?? 0))}
            </Link>
          );
        })}
      </nav>

      {inbox.requests.length === 0 ? (
        <EmptyState message="در این وضعیت درخواستی وجود ندارد." />
      ) : (
        <RecordList>
          {inbox.requests.map((request) => (
            <RecordItem
              key={request.id}
              title={request.contentPurged ? 'درخواست با محتوای حذف‌شده' : request.contactName}
              badge={
                <Badge tone={WEBSITE_REQUEST_STATUS_TONE[request.status]}>
                  {WEBSITE_REQUEST_STATUS_LABEL[request.status]}
                </Badge>
              }
              details={
                <>
                  <span>دریافت: {formatWebsiteRequestInstant(request.receivedAt)}</span>
                  {request.contentPurged ? (
                    <span className="text-slate-700">
                      اطلاعات شخصی طبق سیاست نگهداری حذف شده است.
                    </span>
                  ) : (
                    <>
                      <span dir="ltr" className="text-start">
                        {request.contactMobile}
                      </span>
                      <span>
                        سن کودک: {toPersianDigits(String(request.childAgeYears))} سال ·{' '}
                        {CHILD_SEX_LABEL[request.childSex]}
                      </span>
                      {request.requestedService !== null ? (
                        <span>خدمت درخواستی: {request.requestedService.name}</span>
                      ) : null}
                      {request.preferredContactTime !== null ? (
                        <span>
                          زمان ترجیحی تماس: {CONTACT_TIME_LABEL[request.preferredContactTime]}
                        </span>
                      ) : null}
                      <span>{request.hasNote ? 'یادداشت دارد' : 'بدون یادداشت'}</span>
                    </>
                  )}
                  {request.linkedFamily !== null ? (
                    <span>خانوادهٔ پیوندشده: {request.linkedFamily.familyName}</span>
                  ) : null}
                </>
              }
              actions={<ButtonLink href={`/website-requests/${request.id}`}>مشاهده</ButtonLink>}
            />
          ))}
        </RecordList>
      )}

      {inbox.page.total > inbox.page.pageSize ? (
        <nav aria-label="صفحه‌بندی درخواست‌ها" className="flex items-center justify-between gap-3">
          {inbox.page.page > 1 ? (
            <ButtonLink href={inboxHref(selectedStatuses, inbox.page.page - 1)} tone="secondary">
              صفحهٔ قبل
            </ButtonLink>
          ) : (
            <span />
          )}
          <span className="text-sm text-slate-600">
            صفحهٔ {toPersianDigits(String(inbox.page.page))}
          </span>
          {inbox.page.hasMore ? (
            <ButtonLink href={inboxHref(selectedStatuses, inbox.page.page + 1)} tone="secondary">
              صفحهٔ بعد
            </ButtonLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </PageShell>
  );
}
