'use client';

import { useActionState } from 'react';
import {
  Alert,
  ChoiceOption,
  EmptyState,
  Field,
  FormActions,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { searchFamiliesForWebsiteRequestAction } from './family-search-action';
import type { WebsiteRequestFamilySearchState } from './family-search-state';

export function WebsiteRequestFamilySearch({
  requestId,
  csrfToken,
  initial,
}: {
  requestId: string;
  csrfToken: string;
  initial: WebsiteRequestFamilySearchState;
}) {
  const [state, formAction] = useActionState(searchFamiliesForWebsiteRequestAction, initial);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction}>
        <Panel title="جست‌وجوی خانوادهٔ موجود">
          <Field
            id="website-request-family-query"
            label="نام، شماره تماس، نام کودک یا شماره پرونده"
            help="حداقل دو نویسه وارد کنید؛ نتیجه به‌طور خودکار پیوند نمی‌خورد."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="q"
                type="search"
                maxLength={60}
                defaultValue={state.q}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <FormActions>
            <SubmitButton>جست‌وجو</SubmitButton>
          </FormActions>
        </Panel>
      </form>

      {state.errorMessage !== null ? <Alert>{state.errorMessage}</Alert> : null}
      {state.searched && state.families.length === 0 ? (
        <EmptyState message="خانوادهٔ فعالی با این مشخصات پیدا نشد." />
      ) : null}
      {state.families.length > 0 ? (
        <form
          method="post"
          action="/api/website-requests/link"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            if (
              !window.confirm('پیوند این درخواست به خانوادهٔ انتخاب‌شده قطعی است. ادامه می‌دهید؟')
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="requestId" value={requestId} />
          <Panel title="انتخاب خانواده">
            {state.truncated ? (
              <p className="text-sm text-slate-600">نتیجه‌ها کامل نیست؛ عبارت دقیق‌تری بنویسید.</p>
            ) : null}
            {state.families.map((family) => {
              const contact = family.primaryGuardian;
              const children = family.children
                .map((child) => `${child.firstName} ${child.lastName}`)
                .join('، ');
              return (
                <ChoiceOption
                  key={family.id}
                  id={`website-request-family-${family.id}`}
                  name="familyId"
                  value={family.id}
                  required
                  label={family.familyName}
                  description={[
                    contact === null
                      ? null
                      : `${contact.fullName}${contact.mobile !== null ? ` — ${contact.mobile}` : contact.landline !== null ? ` — ${contact.landline}` : ''}`,
                    children === '' ? 'در انتظار ثبت نخستین کودک' : children,
                  ]
                    .filter((value): value is string => value !== null)
                    .join(' · ')}
                />
              );
            })}
            <FormActions>
              <SubmitButton>تأیید پیوند و تبدیل</SubmitButton>
            </FormActions>
          </Panel>
        </form>
      ) : null}
    </div>
  );
}
