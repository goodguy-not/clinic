import type { Family, Guardian } from '@clinic/contracts';
import {
  Alert,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { GuardianFields } from './guardian-fields';

/** The create and edit form for a family and its guardians. */
export function FamilyForm({
  family,
  guardians,
  csrfToken,
  errorMessage,
}: {
  family?: Family;
  guardians?: Guardian[];
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = family !== undefined;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? COPY.familyEditTitle : COPY.familyNewTitle}
        backHref={isEdit ? `/families/${family.id}` : '/families'}
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/families/update' : '/api/families/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={family.id} /> : null}

          <Field id="familyName" label={COPY.familyNameLabel} help={COPY.familyNameHelp} required>
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="familyName"
                type="text"
                required
                maxLength={120}
                defaultValue={family?.familyName ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field id="address" label={COPY.familyAddressLabel} help={COPY.familyAddressHelp}>
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="address"
                rows={2}
                maxLength={500}
                defaultValue={family?.address ?? ''}
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
                defaultValue={family?.note ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-medium text-slate-900">
              {COPY.familyGuardiansLegend}
            </legend>
            <p className="mb-1 text-xs text-slate-600">{COPY.familyGuardiansHelp}</p>
            <GuardianFields guardians={guardians} />
          </fieldset>

          <FormActions>
            <SubmitButton>{COPY.save}</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
