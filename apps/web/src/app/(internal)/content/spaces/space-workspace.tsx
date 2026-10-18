import type { Space } from '@clinic/contracts';
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  RecordItem,
  RecordList,
  SubmitButton,
} from '@/components/ui';

export function SpaceWorkspace({
  spaces,
  csrfToken,
  errorMessage,
  successMessage,
  canDraft,
  canPublish,
}: {
  spaces: Space[];
  csrfToken: string;
  errorMessage: string | null;
  successMessage: string | null;
  canDraft: boolean;
  canPublish: boolean;
}) {
  return (
    <PageShell wide>
      <PageHeader
        title="معرفی فضاهای کلینیک"
        description="فضاهایی را که خانواده‌ها در وب‌سایت می‌بینند آماده و مرتب کنید. این بخش از اتاق‌های نوبت‌دهی جداست."
        action={
          canDraft ? <ButtonLink href="/content/spaces/new">فضای تازه</ButtonLink> : undefined
        }
      />

      <Alert tone="info">
        {canPublish
          ? 'عکس‌ها و متن هرکدام جداگانه بررسی می‌شوند. پس از آماده‌شدن عکس‌ها، نسخهٔ فضا را روی سایت قرار دهید.'
          : 'هر تغییری که اینجا ذخیره می‌کنید پیش‌نویس است و تا تأیید مدیر روی سایت دیده نمی‌شود.'}
      </Alert>
      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {successMessage !== null ? <Alert tone="info">{successMessage}</Alert> : null}

      <Panel>
        {spaces.length === 0 ? (
          <EmptyState
            message="هنوز فضایی برای معرفی در وب‌سایت آماده نشده است."
            action={
              canDraft ? (
                <ButtonLink href="/content/spaces/new">ساخت نخستین پیش‌نویس</ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <RecordList>
            {spaces.map((space) => (
              <RecordItem
                key={space.id}
                title={space.name}
                badge={
                  <>
                    <Badge tone={space.isPublic ? 'success' : 'neutral'}>
                      {space.isPublic ? 'اکنون روی سایت' : 'پیش‌نویس؛ منتشر نشده'}
                    </Badge>
                    {space.hasUnpublishedChanges ? (
                      <Badge tone="warning">تغییرات منتشرنشده</Badge>
                    ) : null}
                  </>
                }
                details={
                  <>
                    <span>
                      {space.hasUnpublishedChanges
                        ? 'خانواده‌ها هنوز نسخهٔ پیشین را می‌بینند.'
                        : space.isPublic
                          ? 'نسخهٔ عمومی به‌روز است.'
                          : 'خانواده‌ها این فضا را در سایت نمی‌بینند.'}
                    </span>
                    {space.description ? (
                      <span className="line-clamp-2 whitespace-pre-line">{space.description}</span>
                    ) : null}
                  </>
                }
                actions={
                  <>
                    {canDraft ? (
                      <ButtonLink href={`/content/spaces/${space.id}/edit`} tone="secondary">
                        متن و عکس‌ها
                      </ButtonLink>
                    ) : null}
                    {canPublish && (!space.isPublic || space.hasUnpublishedChanges) ? (
                      <form method="post" action="/api/content/spaces/publication">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="id" value={space.id} />
                        <input type="hidden" name="isPublic" value="true" />
                        <SubmitButton>
                          {space.hasUnpublishedChanges ? 'انتشار تغییرات' : 'قرار دادن روی سایت'}
                        </SubmitButton>
                      </form>
                    ) : null}
                    {canPublish && space.isPublic ? (
                      <form method="post" action="/api/content/spaces/publication">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="id" value={space.id} />
                        <input type="hidden" name="isPublic" value="false" />
                        <SubmitButton tone="danger">برداشتن از سایت</SubmitButton>
                      </form>
                    ) : null}
                  </>
                }
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </PageShell>
  );
}
