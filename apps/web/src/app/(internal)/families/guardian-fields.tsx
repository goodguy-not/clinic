'use client';

import { useState } from 'react';
import type { Guardian } from '@clinic/contracts';
import { GUARDIAN_RELATIONSHIPS } from '@clinic/contracts';
import { CONTROL_CLASS, FOCUS_RING } from '@/components/ui';
import { COPY } from '@/shared/copy-fa';
import { GUARDIAN_RELATIONSHIP_LABEL } from './relationship-labels';

const GUARDIAN_SLOTS = 6; // Same cap as the family request contract.

/**
 * Guardian slots appear on demand up to the contract maximum.
 *
 * The primary-contact radio group spans every slot by sharing one `name`, so
 * exactly one can be checked across the whole form, and `required` on each
 * option enforces that one is chosen without any script.
 */
export function GuardianFields({
  guardians,
  websiteContact,
}: {
  guardians?: Guardian[];
  websiteContact?: { fullName: string; mobile: string };
}) {
  const [count, setCount] = useState(Math.max(1, guardians?.length ?? 0));
  const [names, setNames] = useState<Record<number, string>>(() =>
    Object.fromEntries((guardians ?? []).map((guardian, index) => [index + 1, guardian.fullName])),
  );
  const slots = Array.from({ length: count }, (_unused, index) => guardians?.[index]);

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
                  defaultValue={guardian?.fullName ?? (slot === 1 ? websiteContact?.fullName : '')}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [slot]: event.target.value }))
                  }
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
                  defaultValue={guardian?.relationship ?? ''}
                  required={Boolean(names[slot] || (slot === 1 && websiteContact?.fullName))}
                  className={CONTROL_CLASS}
                >
                  <option value="" disabled>
                    انتخاب کنید
                  </option>
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
                  defaultValue={guardian?.mobile ?? (slot === 1 ? websiteContact?.mobile : '')}
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
                defaultChecked={
                  guardian?.isPrimaryContact ?? (slot === 1 && websiteContact !== undefined)
                }
                className={`size-4 accent-brand-700 ${FOCUS_RING}`}
              />
              {COPY.guardianPrimaryLabel}
            </label>
          </fieldset>
        );
      })}
      {count < GUARDIAN_SLOTS ? (
        <button
          type="button"
          onClick={() => setCount((current) => current + 1)}
          className={`self-start rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-900 ${FOCUS_RING}`}
        >
          افزودن سرپرست
        </button>
      ) : null}
    </div>
  );
}
