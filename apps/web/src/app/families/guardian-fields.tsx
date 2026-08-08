import type { Guardian } from '@clinic/contracts';
import { GUARDIAN_RELATIONSHIPS } from '@clinic/contracts';
import { COPY } from '@/server/copy-fa';
import { GUARDIAN_SLOTS } from '@/server/family-forms';
import { GUARDIAN_RELATIONSHIP_LABEL } from './relationship-labels';

const CONTROL =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

/**
 * A fixed set of guardian slots — no client JavaScript exists to add a row on
 * demand, so the form offers the contract's own maximum of six and a slot
 * counts as used only when its name is filled in (`family-forms.ts`).
 *
 * The primary-contact radio group spans every slot by sharing one `name`, so
 * exactly one can be checked across the whole form, and `required` on each
 * option enforces that one is chosen without any script.
 */
export function GuardianFields({ guardians }: { guardians?: Guardian[] }) {
  const slots = Array.from({ length: GUARDIAN_SLOTS }, (_unused, index) => guardians?.[index]);

  return (
    <div className="flex flex-col gap-4">
      {slots.map((guardian, index) => {
        const slot = index + 1;

        return (
          <fieldset
            key={slot}
            className="flex flex-col gap-3 rounded-md border border-slate-200 p-3"
          >
            <legend className="px-1 text-sm font-medium text-slate-900">
              {COPY.guardianSlotLabel} {slot}
            </legend>

            <label className="flex flex-col gap-1 text-sm">
              {COPY.guardianFullNameLabel}
              <input
                type="text"
                name={`guardian-${slot}-fullName`}
                maxLength={120}
                defaultValue={guardian?.fullName ?? ''}
                className={CONTROL}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {COPY.guardianRelationshipLabel}
              <select
                name={`guardian-${slot}-relationship`}
                defaultValue={guardian?.relationship ?? 'MOTHER'}
                className={CONTROL}
              >
                {GUARDIAN_RELATIONSHIPS.map((relationship) => (
                  <option key={relationship} value={relationship}>
                    {GUARDIAN_RELATIONSHIP_LABEL[relationship]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {COPY.guardianRelationshipNoteLabel}
              <input
                type="text"
                name={`guardian-${slot}-relationshipNote`}
                maxLength={120}
                defaultValue={guardian?.relationshipNote ?? ''}
                aria-describedby={`guardian-${slot}-relationship-note-help`}
                className={CONTROL}
              />
              <span
                id={`guardian-${slot}-relationship-note-help`}
                className="text-xs text-slate-600"
              >
                {COPY.guardianRelationshipNoteHelp}
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {COPY.guardianMobileLabel}
              <input
                type="tel"
                dir="ltr"
                name={`guardian-${slot}-mobile`}
                defaultValue={guardian?.mobile ?? ''}
                className={CONTROL}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {COPY.guardianLandlineLabel}
              <input
                type="tel"
                dir="ltr"
                name={`guardian-${slot}-landline`}
                defaultValue={guardian?.landline ?? ''}
                className={CONTROL}
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="primaryGuardian"
                value={slot}
                required
                defaultChecked={guardian?.isPrimaryContact ?? false}
                className="size-4"
              />
              {COPY.guardianPrimaryLabel}
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}
