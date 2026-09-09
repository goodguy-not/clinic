import type { ServicePublicCopy, Therapist, TherapistProfileCopy } from '@clinic/contracts';
import { Badge, ButtonLink, EmptyState, Panel, RecordItem, RecordList } from '@/components/ui';

export function CatalogEditorialWorkspace({
  services,
  therapistCopies,
  therapists,
  canManageServices,
  canPublishTherapists,
  canManageClinic,
}: {
  services: ServicePublicCopy[];
  therapistCopies: TherapistProfileCopy[];
  therapists: Therapist[];
  canManageServices: boolean;
  canPublishTherapists: boolean;
  canManageClinic: boolean;
}) {
  const therapistNames = new Map(therapists.map((item) => [item.id, item.fullName]));

  return (
    <section aria-labelledby="catalog-editorial-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="catalog-editorial-heading" className="text-lg font-bold text-slate-900">
            معرفی خدمات و درمانگران
          </h2>
          <p className="mt-1 max-w-prose text-sm text-slate-600">
            پذیرش متن را آماده می‌کند؛ تا زمانی که مدیر انتشار را انجام ندهد، نسخهٔ روی سایت تغییر
            نمی‌کند.
          </p>
        </div>
        {canManageClinic ? (
          <ButtonLink href="/content/clinic-profile" tone="secondary">
            مشخصات عمومی کلینیک
          </ButtonLink>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="خدمات">
          {services.length === 0 ? (
            <EmptyState message="هنوز خدمتی برای آماده‌سازی متن وجود ندارد." />
          ) : (
            <RecordList>
              {services.map((service) => (
                <RecordItem
                  key={service.serviceId}
                  title={service.name}
                  badge={
                    <>
                      <Badge tone={service.publishedDescription === null ? 'neutral' : 'success'}>
                        {service.publishedDescription === null
                          ? 'هنوز منتشر نشده'
                          : 'نسخهٔ منتشرشده'}
                      </Badge>
                      {service.hasUnpublishedChanges ? (
                        <Badge tone="warning">تغییرات آمادهٔ انتشار</Badge>
                      ) : null}
                    </>
                  }
                  details={
                    <span>
                      {service.hasUnpublishedChanges
                        ? 'نسخهٔ منتشرشده هنوز بدون تغییر باقی مانده است.'
                        : 'متن آماده‌شده و نسخهٔ منتشرشده یکسان‌اند.'}
                    </span>
                  }
                  actions={
                    <ButtonLink href={`/content/services/${service.serviceId}`} tone="secondary">
                      {canManageServices ? 'بررسی و انتشار' : 'آماده‌سازی متن'}
                    </ButtonLink>
                  }
                />
              ))}
            </RecordList>
          )}
        </Panel>

        <Panel title="درمانگران">
          {therapistCopies.length === 0 ? (
            <EmptyState message="هنوز درمانگری برای آماده‌سازی معرفی وجود ندارد." />
          ) : (
            <RecordList>
              {therapistCopies.map((copy) => (
                <RecordItem
                  key={copy.therapistId}
                  title={
                    copy.displayName ??
                    copy.publishedDisplayName ??
                    therapistNames.get(copy.therapistId) ??
                    'درمانگر'
                  }
                  badge={
                    <>
                      <Badge tone={copy.isPublic ? 'success' : 'neutral'}>
                        {copy.isPublic ? 'نسخهٔ منتشرشده' : 'هنوز منتشر نشده'}
                      </Badge>
                      {copy.hasUnpublishedChanges ? (
                        <Badge tone="warning">تغییرات آمادهٔ انتشار</Badge>
                      ) : null}
                    </>
                  }
                  details={
                    <span>
                      {copy.hasUnpublishedChanges
                        ? 'تغییرهای آماده‌شده هنوز روی سایت دیده نمی‌شوند.'
                        : copy.isPublic
                          ? 'نسخهٔ روی سایت به‌روز است.'
                          : 'این همکار هنوز برای نمایش عمومی فعال نشده است.'}
                    </span>
                  }
                  actions={
                    <ButtonLink href={`/content/therapists/${copy.therapistId}`} tone="secondary">
                      {canPublishTherapists ? 'بررسی نمایهٔ عمومی' : 'آماده‌سازی معرفی'}
                    </ButtonLink>
                  }
                />
              ))}
            </RecordList>
          )}
        </Panel>
      </div>
    </section>
  );
}
