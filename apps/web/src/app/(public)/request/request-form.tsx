'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { submitPublicRequestAction } from './action';

type Tray = 'age' | 'sex' | 'time';
type Sex = 'FEMALE' | 'MALE' | 'UNSPECIFIED' | '';
type ContactTime = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NO_PREFERENCE' | '';

const INITIAL_STATE = {
  status: 'idle' as const,
  fieldErrors: {},
  formError: null,
  values: {
    contactName: '',
    contactMobile: '',
    childAgeYears: '',
    childSex: '',
    childName: '',
    preferredContactTime: '',
    note: '',
    consent: '',
  },
};

const SEX_OPTIONS: { value: Exclude<Sex, ''>; label: string }[] = [
  { value: 'FEMALE', label: 'دختر' },
  { value: 'MALE', label: 'پسر' },
  { value: 'UNSPECIFIED', label: 'ترجیح می‌دهم مشخص نکنم' },
];

const TIME_OPTIONS: { value: Exclude<ContactTime, ''>; label: string }[] = [
  { value: 'MORNING', label: 'صبح' },
  { value: 'AFTERNOON', label: 'بعدازظهر' },
  { value: 'EVENING', label: 'عصر' },
  { value: 'NO_PREFERENCE', label: 'فرقی نمی‌کند' },
];

export function RequestForm({
  serviceSlug,
  serviceName,
}: {
  serviceSlug: string | null;
  serviceName: string | null;
}) {
  const action = submitPublicRequestAction.bind(null, serviceSlug);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [tray, setTray] = useState<Tray | null>(null);
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>('');
  const [time, setTime] = useState<ContactTime>('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<Tray, HTMLButtonElement | null>>({
    age: null,
    sex: null,
    time: null,
  });
  const returnFocus = useRef<Tray | null>(null);

  useEffect(() => {
    if (tray === null) return;
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>('[data-tray-focus]')?.focus();
    });
  }, [tray]);

  useEffect(() => {
    if (state.status === 'error') errorRef.current?.focus();
  }, [state]);

  const openTray = (next: Tray) => {
    returnFocus.current = next;
    setTray(next);
  };

  const closeTray = () => dialogRef.current?.close();

  const trayClosed = () => {
    setTray(null);
    const trigger = returnFocus.current;
    if (trigger !== null) triggerRefs.current[trigger]?.focus();
  };

  const sexLabel = SEX_OPTIONS.find((option) => option.value === sex)?.label;
  const timeLabel = TIME_OPTIONS.find((option) => option.value === time)?.label;

  return (
    <form action={formAction} className="request-form" noValidate>
      <input type="hidden" name="childAgeYears" value={age} />
      <input type="hidden" name="childSex" value={sex} />
      <input type="hidden" name="preferredContactTime" value={time} />

      {serviceName ? (
        <p className="request-context" role="status">
          این درخواست از صفحهٔ «{serviceName}» شروع شده و همان زمینه همراه آن ثبت می‌شود.
        </p>
      ) : null}

      {state.formError ? (
        <div ref={errorRef} className="request-error-summary" role="alert" tabIndex={-1}>
          <strong>درخواست ارسال نشد</strong>
          <p>{state.formError}</p>
        </div>
      ) : null}

      <div className="request-sentence" aria-label="اطلاعات اصلی درخواست">
        <span>سلام، من</span>
        <FieldInput
          id="contactName"
          name="contactName"
          label="نام و نام خانوادگی والد یا فرد تماس"
          placeholder="نام و نام خانوادگی"
          autoComplete="name"
          defaultValue={state.values.contactName}
          error={state.fieldErrors.contactName}
          required
        />
        <span>هستم. شمارهٔ همراه من</span>
        <FieldInput
          id="contactMobile"
          name="contactMobile"
          label="شمارهٔ همراه"
          placeholder="۰۹۱۲۱۲۳۴۵۶۷"
          autoComplete="tel"
          inputMode="tel"
          dir="ltr"
          defaultValue={state.values.contactMobile}
          error={state.fieldErrors.contactMobile}
          required
        />
        <span>است و فرزندم</span>
        <SelectionButton
          ref={(node) => {
            triggerRefs.current.age = node;
          }}
          label={age === '' ? 'انتخاب سن' : `${age} سال`}
          onClick={() => openTray('age')}
          expanded={tray === 'age'}
          controls="request-selection-tray"
          invalid={Boolean(state.fieldErrors.childAgeYears)}
          describedBy="childAgeYears-help childAgeYears-error"
        />
        <span>و</span>
        <SelectionButton
          ref={(node) => {
            triggerRefs.current.sex = node;
          }}
          label={sexLabel ?? 'انتخاب جنسیت'}
          onClick={() => openTray('sex')}
          expanded={tray === 'sex'}
          controls="request-selection-tray"
          invalid={Boolean(state.fieldErrors.childSex)}
          describedBy="childSex-help childSex-error"
        />
        <span>است.</span>
      </div>

      <p id="childAgeYears-help" className="request-helper">
        سن به سال کامل و فقط برای زمینهٔ پیگیری است؛ بازهٔ فرم ۰ تا ۱۲۰ است و شرط پذیرش نیست.
      </p>
      <FieldError id="childAgeYears-error" message={state.fieldErrors.childAgeYears} />
      <p id="childSex-help" className="request-helper">
        جنسیت فقط برای رسیدن درخواست به تیم مرتبط پرسیده می‌شود و می‌توانید آن را مشخص نکنید.
      </p>
      <FieldError id="childSex-error" message={state.fieldErrors.childSex} />

      <fieldset className="request-optional">
        <legend>اطلاعات اختیاری</legend>
        <p>اگر مایلید، این اطلاعات می‌تواند گفت‌وگوی بعدی را ساده‌تر کند.</p>
        <div className="request-optional__row">
          <FieldInput
            id="childName"
            name="childName"
            label="نام فرزند (اختیاری)"
            placeholder="نام فرزند"
            defaultValue={state.values.childName}
            error={state.fieldErrors.childName}
          />
          <div className="request-optional__time">
            <span id="preferredContactTime-label">زمان ترجیحی تماس (اختیاری)</span>
            <SelectionButton
              ref={(node) => {
                triggerRefs.current.time = node;
              }}
              label={timeLabel ?? 'انتخاب زمان'}
              onClick={() => openTray('time')}
              expanded={tray === 'time'}
              controls="request-selection-tray"
              invalid={Boolean(state.fieldErrors.preferredContactTime)}
              describedBy="preferredContactTime-label preferredContactTime-error"
            />
            <FieldError
              id="preferredContactTime-error"
              message={state.fieldErrors.preferredContactTime}
            />
          </div>
        </div>
        <label className="request-textarea" htmlFor="note">
          <span>اگر دوست دارید، کمی بیشتر برایمان بنویسید (اختیاری)</span>
          <textarea
            id="note"
            name="note"
            rows={5}
            maxLength={2000}
            defaultValue={state.values.note}
            aria-invalid={Boolean(state.fieldErrors.note)}
            aria-describedby="note-help note-error"
            placeholder="هر نکته‌ای که فکر می‌کنید بهتر است بدانیم."
          />
        </label>
        <p id="note-help" className="request-helper">
          این بخش برای توضیح آزاد است و جای تشخیص یا غربالگری نیست.
        </p>
        <FieldError id="note-error" message={state.fieldErrors.note} />
      </fieldset>

      <div className="request-consent">
        <input
          id="consent"
          name="consent"
          type="checkbox"
          value="true"
          required
          defaultChecked={state.values.consent === 'true'}
          aria-invalid={Boolean(state.fieldErrors.consent)}
          aria-describedby="consent-error"
        />
        <label htmlFor="consent">
          موافقم که والا برای هماهنگی ارزیابی با من تماس بگیرد و اطلاعات این فرم را نگه دارد.{' '}
          <Link href="/privacy" className="public-focus">
            حریم خصوصی
          </Link>
        </label>
      </div>
      <FieldError id="consent-error" message={state.fieldErrors.consent} />

      <div className="request-submit-row">
        <button
          type="submit"
          className="public-focus public-button public-button--gold request-submit"
          disabled={pending}
          aria-describedby="request-submit-note"
        >
          {pending ? 'در حال ثبت درخواست…' : 'ارسال درخواست ارزیابی'}
          <span aria-hidden="true">←</span>
        </button>
        <p id="request-submit-note">با ارسال فرم، نوبتی رزرو یا تأیید نمی‌شود.</p>
      </div>

      <dialog
        ref={dialogRef}
        id="request-selection-tray"
        className="request-tray"
        aria-labelledby="request-tray-title"
        onClose={trayClosed}
        onCancel={(event) => {
          event.preventDefault();
          closeTray();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeTray();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeTray();
        }}
      >
        <div className="request-tray__surface">
          <div className="request-tray__header">
            <div>
              <strong id="request-tray-title">
                {tray === 'age'
                  ? 'سن فرزند (سال کامل)'
                  : tray === 'sex'
                    ? 'جنسیت فرزند'
                    : 'زمان ترجیحی تماس (اختیاری)'}
              </strong>
              <p>
                {tray === 'time'
                  ? 'این فقط یک ترجیح است و زمان تماس را تضمین نمی‌کند.'
                  : 'فقط برای اینکه درخواست به تیم مرتبط برسد.'}
              </p>
            </div>
            <button type="button" onClick={closeTray} className="public-focus" aria-label="بستن">
              ×
            </button>
          </div>

          {tray === 'age' ? (
            <fieldset className="request-tray__age">
              <legend>یک عدد از ۰ تا ۱۲۰ وارد کنید</legend>
              <input
                data-tray-focus
                type="text"
                inputMode="numeric"
                pattern="[0-9۰-۹٠-٩]*"
                value={age}
                onChange={(event) => setAge(event.target.value)}
                aria-label="سن فرزند به سال کامل"
                placeholder="مثلاً ۱۳"
              />
              <button type="button" className="public-focus" onClick={closeTray}>
                تأیید سن
              </button>
            </fieldset>
          ) : null}

          {tray === 'sex' ? (
            <fieldset className="request-tray__options">
              <legend className="request-sr-only">انتخاب جنسیت فرزند</legend>
              {SEX_OPTIONS.map((option, index) => (
                <label key={option.value} className="public-focus">
                  <input
                    data-tray-focus={index === 0 ? '' : undefined}
                    type="radio"
                    checked={sex === option.value}
                    onChange={() => {
                      setSex(option.value);
                      closeTray();
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {tray === 'time' ? (
            <fieldset className="request-tray__options">
              <legend className="request-sr-only">انتخاب زمان ترجیحی تماس</legend>
              {TIME_OPTIONS.map((option, index) => (
                <label key={option.value} className="public-focus">
                  <input
                    data-tray-focus={index === 0 ? '' : undefined}
                    type="radio"
                    checked={time === option.value}
                    onChange={() => {
                      setTime(option.value);
                      closeTray();
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              {time !== '' ? (
                <button
                  type="button"
                  className="public-focus request-tray__clear"
                  onClick={() => {
                    setTime('');
                    closeTray();
                  }}
                >
                  پاک‌کردن انتخاب
                </button>
              ) : null}
            </fieldset>
          ) : null}
        </div>
      </dialog>
    </form>
  );
}

function FieldInput({
  id,
  name,
  label,
  error,
  ...props
}: {
  id: string;
  name: string;
  label: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="request-inline-input" htmlFor={id}>
      <span className="request-sr-only">{label}</span>
      <input
        id={id}
        name={name}
        {...props}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <FieldError id={`${id}-error`} message={error} />
    </label>
  );
}

const SelectionButton = ({
  ref,
  label,
  expanded,
  controls,
  invalid,
  describedBy,
  onClick,
}: {
  ref: React.Ref<HTMLButtonElement>;
  label: string;
  expanded: boolean;
  controls: string;
  invalid: boolean;
  describedBy: string;
  onClick: () => void;
}) => (
  <button
    ref={ref}
    type="button"
    className="public-focus request-selection"
    aria-expanded={expanded}
    aria-controls={controls}
    aria-invalid={invalid}
    aria-describedby={describedBy}
    onClick={onClick}
  >
    {label}
    <span aria-hidden="true">▾</span>
  </button>
);

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <span id={id} className="request-field-error" role={message ? 'alert' : undefined}>
      {message ?? ''}
    </span>
  );
}
