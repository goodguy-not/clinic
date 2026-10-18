'use client';

import { useEffect, useState } from 'react';
import type { Service } from '@clinic/contracts';
import {
  Alert,
  ChoiceGroup,
  ChoiceOption,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/shared/copy-fa';

/**
 * The create and edit form for a service.
 *
 * One component for both, because the fields are identical and two copies would
 * drift. `service` being present is what makes it an edit: it supplies the
 * defaults and the hidden id.
 *
 * No client JavaScript. This is an ordinary form that posts to a Route Handler,
 * which validates, calls NestJS and redirects — the same shape the Milestone 1
 * staff screens use.
 *
 * Activation is deliberately absent. Turning a service off is a different
 * decision from correcting its description, and it lives on the list page so it
 * cannot happen as a side effect of saving an edit.
 */
export function ServiceForm({
  service,
  csrfToken,
  errorMessage,
}: {
  service?: Service;
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = service !== undefined;
  const [isPublic, setIsPublic] = useState(service?.isPublic ?? false);
  const [origin, setOrigin] = useState('');
  const published = service?.publicFirstPublishedAt != null;

  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? COPY.serviceEditTitle : COPY.serviceNewTitle}
        backHref="/catalog/services"
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/catalog/services/update' : '/api/catalog/services/create'}
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            if (isPublic && !published) {
              if (
                !window.confirm(
                  `نشانی عمومی این خدمت ${service?.publicSlug ? `${window.location.origin}/services/${service.publicSlug}` : 'هنگام ساخت به‌طور خودکار تعیین می‌شود'} و پس از نخستین انتشار دائمی است. انتشار را تأیید می‌کنید؟`,
                )
              ) {
                event.preventDefault();
              }
            }
          }}
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={service.id} /> : null}

          <Field id="name" label={COPY.serviceNameLabel} help={COPY.serviceNameHelp} required>
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="name"
                type="text"
                required
                maxLength={120}
                defaultValue={service?.name ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="publicDescription"
            label={COPY.servicePublicDescriptionLabel}
            help={COPY.servicePublicDescriptionHelp}
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="publicDescription"
                rows={4}
                maxLength={2000}
                defaultValue={service?.publicDescription ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <ChoiceGroup legend={COPY.serviceVisibilityLegend} help={COPY.serviceVisibilityHelp}>
            <ChoiceOption
              id="isPublic-false"
              name="isPublic"
              value="false"
              label={COPY.servicePrivateLabel}
              description={COPY.servicePrivateDescription}
              defaultChecked={service === undefined || !service.isPublic}
              onChange={() => setIsPublic(false)}
            />
            <ChoiceOption
              id="isPublic-true"
              name="isPublic"
              value="true"
              label={COPY.servicePublicLabel}
              description={COPY.servicePublicDescription2}
              defaultChecked={service?.isPublic === true}
              onChange={() => setIsPublic(true)}
            />
          </ChoiceGroup>

          <Alert tone="info">
            انتخاب «در وب‌سایت عمومی معرفی شود» و زدن دکمهٔ ذخیره، خدمت را همان لحظه روی سایت
            می‌گذارد. توضیح عمومی اختیاری است؛ اگر خالی باشد، نام و صفحهٔ خدمت بدون توضیح منتشر
            می‌شود.
          </Alert>

          {service?.publicSlug ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-slate-900">نشانی صفحهٔ عمومی</span>
              <span
                dir="ltr"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-start text-sm text-slate-700"
              >
                {origin}/services/{service.publicSlug}
              </span>
              <p className="text-xs text-slate-600">
                این نشانی به‌طور خودکار تعیین شده و تغییر نمی‌کند.
              </p>
            </div>
          ) : (
            <Alert tone="info">
              نشانی عمومی این خدمت هنگام ساخت به‌طور خودکار تعیین می‌شود و پس از نخستین انتشار دائمی
              است.
            </Alert>
          )}

          <Field
            id="durations"
            label={COPY.serviceDurationsLabel}
            help={COPY.serviceDurationsHelp}
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="durations"
                type="text"
                required
                inputMode="numeric"
                dir="ltr"
                defaultValue={service?.allowedDurationsMinutes.join('، ') ?? ''}
                aria-describedby={describedBy}
                className={`${className} text-start`}
              />
            )}
          </Field>

          {isEdit ? <Alert tone="info">{COPY.serviceDurationRemovalWarning}</Alert> : null}

          <FormActions>
            <SubmitButton>{COPY.save}</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
