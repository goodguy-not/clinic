'use client';

import { useState } from 'react';
import type { Therapist } from '@clinic/contracts';
import { ChoiceGroup, ChoiceOption, Field } from '@/components/ui';
import { COPY } from '@/shared/copy-fa';

export function TariffConditionalFields({
  activeTherapists,
  isCorrection,
}: {
  activeTherapists: Therapist[];
  isCorrection: boolean;
}) {
  const [scope, setScope] = useState<'general' | 'therapist'>('general');
  const [priceMode, setPriceMode] = useState<'PAID' | 'FREE' | null>(null);

  return (
    <>
      {!isCorrection ? (
        <>
          <ChoiceGroup legend={COPY.tariffScopeLegend}>
            <ChoiceOption
              id="scope-general"
              name="scope"
              value="general"
              label={COPY.tariffScopeGeneralLabel}
              description={COPY.tariffScopeGeneralDescription}
              defaultChecked
              onChange={() => setScope('general')}
            />
            <ChoiceOption
              id="scope-therapist"
              name="scope"
              value="therapist"
              label={COPY.tariffScopeTherapistLabel}
              description={COPY.tariffScopeTherapistDescription}
              onChange={() => setScope('therapist')}
            />
          </ChoiceGroup>
          {scope === 'therapist' ? (
            <Field
              id="therapistId"
              label={COPY.tariffTherapistLabel}
              help={COPY.tariffTherapistHelp}
              required
            >
              {({ id, className, describedBy }) => (
                <select
                  id={id}
                  name="therapistId"
                  defaultValue=""
                  required
                  aria-describedby={describedBy}
                  className={className}
                >
                  <option value="">انتخاب کنید</option>
                  {activeTherapists.map((therapist) => (
                    <option key={therapist.id} value={therapist.id}>
                      {therapist.fullName}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </>
      ) : null}

      <ChoiceGroup legend={COPY.tariffPriceModeLegend}>
        <ChoiceOption
          id="priceMode-paid"
          name="priceMode"
          value="PAID"
          label={COPY.tariffPaidLabel}
          description={COPY.tariffPaidDescription}
          onChange={() => setPriceMode('PAID')}
          required
        />
        <ChoiceOption
          id="priceMode-free"
          name="priceMode"
          value="FREE"
          label={COPY.tariffFreeLabel}
          description={COPY.tariffFreeDescription}
          onChange={() => setPriceMode('FREE')}
          required
        />
      </ChoiceGroup>
      {priceMode === 'PAID' ? (
        <Field id="priceToman" label={COPY.tariffPriceLabel} help={COPY.tariffPriceHelp} required>
          {({ id, className, describedBy }) => (
            <input
              id={id}
              name="priceToman"
              type="text"
              inputMode="numeric"
              dir="ltr"
              maxLength={10}
              required
              aria-describedby={describedBy}
              className={`${className} text-start`}
            />
          )}
        </Field>
      ) : null}
      {priceMode === 'FREE' ? (
        <>
          <Field
            id="freeReason"
            label={COPY.tariffFreeReasonLabel}
            help={COPY.tariffFreeReasonHelp}
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="freeReason"
                type="text"
                maxLength={500}
                required
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <input
              id="confirmFreePrice"
              name="confirmFreePrice"
              type="checkbox"
              value="true"
              required
              className="mt-1 size-4 shrink-0 accent-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            />
            <label htmlFor="confirmFreePrice" className="text-sm text-slate-900">
              {COPY.tariffFreeConfirmLabel}
            </label>
          </div>
        </>
      ) : null}
    </>
  );
}
