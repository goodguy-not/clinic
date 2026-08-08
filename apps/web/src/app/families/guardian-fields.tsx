import type { Guardian } from '@clinic/contracts';
import { GUARDIAN_RELATIONSHIPS } from '@clinic/contracts';
import { CONTROL_CLASS, FOCUS_RING } from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { GUARDIAN_SLOTS } from '@/server/family-forms';
import { GUARDIAN_RELATIONSHIP_LABEL } from './relationship-labels';

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
            className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3"
          >
            <legend className="px-1 text-sm font-semibold text-slate-900">
              {COPY.guardianSlotLabel} {slot}
            </legend>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label htmlFor={`guardian-${slot}-fullName`} className="flex flex-col gap-1 text-sm">
                {COPY.guardianFullNameLabel}
                <input
                  id={`guardian-${slot}-fullName`}
                  type="text"
                  name={`guardian-${slot}-fullName`}
                  maxLength={120}
                  defaultValue={guardian?.fullName ?? ''}
                  className={CONTROL_CLASS}
                />
              </label>

              <label
                htmlFor={`guardian-${slot}-relationship`}
                className="flex flex-col gap-1 text-sm"
              >
                {COPY.guardianRelationshipLabel}
                <select
                  id={`guardian-${slot}-relationship`}
                  name={`guardian-${slot}-relationship`}
                  defaultValue={guardian?.relationship ?? 'MOTHER'}
                  className={CONTROL_CLASS}
                >
                  {GUARDIAN_RELATIONSHIPS.map((relationship) => (
                    <option key={relationship} value={relationship}>
                      {GUARDIAN_RELATIONSHIP_LABEL[relationship]}
                    </option>
                  ))}
                </select>
              </label>

              <label
                htmlFor={`guardian-${slot}-relationshipNote`}
                className="flex flex-col gap-1 text-sm"
              >
                {COPY.guardianRelationshipNoteLabel}
                <input
                  id={`guardian-${slot}-relationshipNote`}
                  type="text"
                  name={`guardian-${slot}-relationshipNote`}
                  maxLength={120}
                  defaultValue={guardian?.relationshipNote ?? ''}
                  aria-describedby={`guardian-${slot}-relationship-note-help`}
                  className={CONTROL_CLASS}
                />
                <span
                  id={`guardian-${slot}-relationship-note-help`}
                  className="text-xs text-slate-600"
                >
                  {COPY.guardianRelationshipNoteHelp}
                </span>
              </label>

              <label htmlFor={`guardian-${slot}-mobile`} className="flex flex-col gap-1 text-sm">
                {COPY.guardianMobileLabel}
                <input
                  id={`guardian-${slot}-mobile`}
                  type="tel"
                  dir="ltr"
                  name={`guardian-${slot}-mobile`}
                  defaultValue={guardian?.mobile ?? ''}
                  className={`${CONTROL_CLASS} text-start`}
                />
              </label>

              <label htmlFor={`guardian-${slot}-landline`} className="flex flex-col gap-1 text-sm">
                {COPY.guardianLandlineLabel}
                <input
                  id={`guardian-${slot}-landline`}
                  type="tel"
                  dir="ltr"
                  name={`guardian-${slot}-landline`}
                  defaultValue={guardian?.landline ?? ''}
                  className={`${CONTROL_CLASS} text-start`}
                />
              </label>
            </div>

            <label
              htmlFor={`guardian-${slot}-primary`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-medium"
            >
              <input
                id={`guardian-${slot}-primary`}
                type="radio"
                name="primaryGuardian"
                value={slot}
                required
                defaultChecked={guardian?.isPrimaryContact ?? false}
                className={`size-4 accent-brand-700 ${FOCUS_RING}`}
              />
              {COPY.guardianPrimaryLabel}
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}
