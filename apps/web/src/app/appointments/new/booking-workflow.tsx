'use client';

import { useActionState } from 'react';
import type { Room, Service, Therapist } from '@clinic/contracts';
import { bookingAction } from './booking-action';
import { BookingPanel } from './booking-panel';
import type { BookingState } from './booking-state';

export function BookingWorkflow({
  initialState,
  services,
  therapists,
  rooms,
  canOverrideAvailability,
}: {
  initialState: BookingState;
  services: Service[];
  therapists: Therapist[];
  rooms: Room[];
  canOverrideAvailability: boolean;
}) {
  const [state, action, pending] = useActionState(bookingAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-6">
      <BookingPanel
        key={JSON.stringify(state.intent)}
        state={state}
        services={services}
        therapists={therapists}
        rooms={rooms}
        canOverrideAvailability={canOverrideAvailability}
        pending={pending}
      />
    </form>
  );
}
