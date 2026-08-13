'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  createAppointmentRequestSchema,
  createAppointmentSeriesRequestSchema,
} from '@clinic/contracts';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { jalaliToIsoDate } from '@/server/jalali';
import { toWesternDigits } from '@/server/numerals-fa';
import { assertOriginAllowed } from '@/server/origin';
import { clinicWallTimeToIso } from '@/scheduling/appointment-presentation';
import type { BookingState } from './booking-state';

function strings(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

function nullable(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function isoDate(body: Record<string, string>, prefix: string): string | null {
  return jalaliToIsoDate({
    year: Number(toWesternDigits(body[`${prefix}-year`] ?? '')),
    month: Number(toWesternDigits(body[`${prefix}-month`] ?? '')),
    day: Number(toWesternDigits(body[`${prefix}-day`] ?? '')),
  });
}

function schedulingPayload(body: Record<string, string>): Record<string, unknown> | null {
  const date = isoDate(body, 'date');
  const startsAt =
    date === null ? null : clinicWallTimeToIso(date, toWesternDigits(body['startTime'] ?? ''));
  if (startsAt === null) return null;

  const [serviceId = '', duration = ''] = (body['serviceDuration'] ?? '').split(':');
  return {
    serviceId,
    durationMinutes: Number(toWesternDigits(duration)),
    therapistId: body['therapistId'] ?? '',
    roomId: body['roomId'] ?? '',
    childId: body['childId'] ?? '',
    startsAt,
    note: nullable(body['note']),
    availabilityOverrideReason: nullable(body['availabilityOverrideReason']),
  };
}

function seriesPayload(body: Record<string, string>): Record<string, unknown> | null {
  const booking = schedulingPayload(body);
  if (booking === null) return null;
  const intervalWeeks = Number(toWesternDigits(body['intervalWeeks'] ?? '1'));
  if (body['endMode'] === 'END_DATE') {
    const endsOn = isoDate(body, 'endsOn');
    if (endsOn === null) return null;
    return { ...booking, recurrence: { endMode: 'END_DATE', intervalWeeks, endsOn } };
  }
  return {
    ...booking,
    recurrence: {
      endMode: 'OCCURRENCE_COUNT',
      intervalWeeks,
      occurrenceCount: Number(toWesternDigits(body['occurrenceCount'] ?? '')),
    },
  };
}

export async function bookingAction(
  previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  assertOriginAllowed((await headers()).get('origin'));
  await requireSession({ requirePermission: 'appointment.create' });

  const intent = strings(formData);
  const action = intent['action'] ?? 'preview';
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  if (action === 'search') {
    const q = (intent['familySearch'] ?? '').trim();
    const searched = q.length >= 2;
    const result = await api.searchFamilies(
      { ...(searched ? { q } : {}), includeInactive: false },
      context,
    );
    return {
      intent,
      families: result.ok ? result.data.families : [],
      searchTruncated: result.ok ? result.data.truncated : false,
      searchPerformed: searched,
      preview: null,
      errorMessage: result.ok ? null : persianMessage(result.code),
      finalCreateConflict: false,
    };
  }

  const recurring = intent['bookingMode'] === 'recurring';
  const raw = recurring ? seriesPayload(intent) : schedulingPayload(intent);
  if (raw === null) {
    return {
      ...previous,
      intent,
      preview: null,
      errorMessage: persianMessage('APPOINTMENT_TIME_INVALID'),
      finalCreateConflict: false,
    };
  }

  if (!recurring) {
    const parsed = createAppointmentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ...previous,
        intent,
        preview: null,
        errorMessage: persianMessage('VALIDATION_FAILED'),
        finalCreateConflict: false,
      };
    }
    const result = await api.createAppointment(parsed.data, context);
    if (!result.ok) {
      return {
        ...previous,
        intent,
        preview: null,
        errorMessage: persianMessage(result.code),
        finalCreateConflict: false,
      };
    }
    redirect(`/appointments/${result.data.appointment.id}?success=created`);
  }

  const parsed = createAppointmentSeriesRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...previous,
      intent,
      preview: null,
      errorMessage: persianMessage('VALIDATION_FAILED'),
      finalCreateConflict: false,
    };
  }

  if (action !== 'create-series') {
    const result = await api.previewAppointmentSeries(parsed.data, context);
    return result.ok
      ? {
          ...previous,
          intent,
          preview: result.data,
          errorMessage: null,
          finalCreateConflict: false,
        }
      : {
          ...previous,
          intent,
          preview: null,
          errorMessage: persianMessage(result.code),
          finalCreateConflict: false,
        };
  }

  const result = await api.createAppointmentSeries(parsed.data, context);
  if (!result.ok) {
    const schedulingChanged = [
      'APPOINTMENT_CHILD_CONFLICT',
      'APPOINTMENT_THERAPIST_CONFLICT',
      'APPOINTMENT_ROOM_CONFLICT',
      'APPOINTMENT_OUTSIDE_AVAILABILITY',
    ].includes(result.code);
    return {
      ...previous,
      intent,
      errorMessage: persianMessage(result.code),
      finalCreateConflict: schedulingChanged,
    };
  }
  redirect(`/appointment-series/${result.data.series.id}?success=created`);
}
