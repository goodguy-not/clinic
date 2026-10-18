import { JalaliDateField } from '@/app/(internal)/tariffs/jalali-date-field';
import { Field, Panel, SubmitButton } from '@/components/ui';
import type { JalaliParts } from '@/server/jalali';
import { COPY } from '@/server/copy-fa';

export function PromiseEntryPanel({
  familyId,
  csrfToken,
  clinicTodayJalali,
}: {
  familyId: string;
  csrfToken: string;
  clinicTodayJalali: JalaliParts;
}) {
  return (
    <Panel title={COPY.promiseCreateTitle}>
      <p className="text-sm leading-6 text-slate-600">{COPY.promiseCreateHelp}</p>
      <form action="/api/promises/create" method="post" className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="familyId" value={familyId} />
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <Field
          id="promise-amount"
          label={COPY.promiseAmount}
          help="ارقام فارسی یا انگلیسی پذیرفته می‌شود."
          required
        >
          {({ id, className, describedBy }) => (
            <input
              id={id}
              name="amountToman"
              type="text"
              inputMode="numeric"
              required
              maxLength={18}
              aria-describedby={describedBy}
              className={`${className} text-lg font-bold tabular-nums`}
            />
          )}
        </Field>
        <JalaliDateField
          legend={COPY.promiseDueOn}
          help={COPY.promiseDueOnHelp}
          namePrefix="dueOn"
          value={clinicTodayJalali}
          required
        />
        <div className="md:col-span-2">
          <Field id="promise-note" label={COPY.promiseNote} help={COPY.promiseNoteHelp}>
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="note"
                rows={2}
                maxLength={2000}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
        </div>
        <div className="md:col-span-2">
          <SubmitButton>{COPY.promiseCreateAction}</SubmitButton>
        </div>
      </form>
    </Panel>
  );
}
