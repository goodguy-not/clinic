'use client';

import { useState } from 'react';
import { toPersianDigits, toWesternDigits } from '@/shared/numerals-fa';

/** Locale-independent 24-hour clock entry. The form sends ASCII HH:mm to the API. */
export function TimeInput({
  id,
  name,
  className,
  value,
  defaultValue = '',
  onChange,
  required = false,
}: {
  id?: string;
  name: string;
  className?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
}) {
  const [localValue, setLocalValue] = useState(defaultValue);
  const current = value ?? localValue;

  return (
    <>
      <input type="hidden" name={name} value={current} />
      <input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        placeholder="۰۹:۰۰"
        title="ساعت را با قالب ۲۴ ساعته وارد کنید؛ مانند ۰۹:۰۰"
        pattern="([۰-۱][۰-۹]|۲[۰-۳]):[۰-۵][۰-۹]"
        maxLength={5}
        required={required}
        value={toPersianDigits(current)}
        onChange={(event) => {
          const raw = toWesternDigits(event.target.value);
          const explicit = /^(\d):/.exec(raw);
          const digits = raw.replace(/\D/g, '').slice(0, 4);
          const next = explicit
            ? `0${explicit[1]}:${digits.slice(1, 3)}`
            : digits.length > 2
              ? `${digits.slice(0, 2)}:${digits.slice(2)}`
              : digits;
          if (onChange) onChange(next);
          else setLocalValue(next);
        }}
        className={className}
      />
    </>
  );
}
