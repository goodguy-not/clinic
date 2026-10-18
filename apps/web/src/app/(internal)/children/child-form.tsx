import type { Child, Family } from '@clinic/contracts';
import { CHILD_SEXES } from '@clinic/contracts';
import {
  Alert,
  ChoiceOption,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY, type CopyKey } from '@/server/copy-fa';
import { isoDateToJalali } from '@/server/jalali';
import { BirthDateField } from '../families/birth-date-field';

const SEX_LABEL: Record<(typeof CHILD_SEXES)[number], CopyKey> = {
  FEMALE: 'sexFemale',
  MALE: 'sexMale',
  UNSPECIFIED: 'sexUnspecified',
};

/** The create and edit form for a child, registered under one family. */
export function ChildForm({
  family,
  child,
  csrfToken,
  errorMessage,
}: {
  family: Family;
  child?: Child;
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = child !== undefined;
  const birthDate = child !== undefined ? isoDateToJalali(child.birthDate) : null;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? COPY.childEditTitle : COPY.childNewTitle}
        description={family.familyName}
        backHref={`/families/${family.id}`}
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/children/update' : '/api/children/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={child.id} /> : null}
          {!isEdit ? <input type="hidden" name="familyId" value={family.id} /> : null}

          {isEdit ? (
            <p className="text-sm text-slate-600">
              {COPY.childFileNumberLabel}: <span dir="ltr">{child.fileNumber}</span>
            </p>
          ) : null}

          <Field id="firstName" label={COPY.childFirstNameLabel} required>
            {({ id, className }) => (
              <input
                id={id}
                name="firstName"
                type="text"
                required
                maxLength={120}
                defaultValue={child?.firstName ?? ''}
                className={className}
              />
            )}
          </Field>

          <Field id="lastName" label={COPY.childLastNameLabel} required>
            {({ id, className }) => (
              <input
                id={id}
                name="lastName"
                type="text"
                required
                maxLength={120}
                defaultValue={child?.lastName ?? family.familyName}
                className={className}
              />
            )}
          </Field>

          <BirthDateField value={birthDate} />

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-medium text-slate-900">
              {COPY.childSexLabel}
            </legend>
            <div className="flex flex-col gap-2">
              {CHILD_SEXES.map((sex) => (
                <ChoiceOption
                  key={sex}
                  id={`sex-${sex}`}
                  name="sex"
                  value={sex}
                  label={COPY[SEX_LABEL[sex]]}
                  defaultChecked={(child?.sex ?? 'UNSPECIFIED') === sex}
                />
              ))}
            </div>
          </fieldset>

          <Field id="nationalId" label={COPY.childNationalIdLabel} help={COPY.childNationalIdHelp}>
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="nationalId"
                type="text"
                dir="ltr"
                inputMode="numeric"
                maxLength={10}
                defaultValue={child?.nationalId ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="legacyPaperFileNumber"
            label={COPY.childLegacyFileNumberLabel}
            help={COPY.childLegacyFileNumberHelp}
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="legacyPaperFileNumber"
                type="text"
                maxLength={40}
                defaultValue={child?.legacyPaperFileNumber ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="referralSource"
            label={COPY.childReferralSourceLabel}
            help={COPY.childReferralSourceHelp}
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="referralSource"
                type="text"
                maxLength={200}
                defaultValue={child?.referralSource ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field id="note" label={COPY.familyNoteLabel} help={COPY.familyNoteHelp}>
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="note"
                rows={3}
                maxLength={2000}
                defaultValue={child?.note ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <FormActions>
            <SubmitButton>{COPY.save}</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
