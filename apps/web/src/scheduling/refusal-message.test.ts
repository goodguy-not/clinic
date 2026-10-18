import { describe, expect, it } from 'vitest';
import { schedulingRefusalMessage } from './refusal-message';

const id = (tail: string) => `0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a0${tail}`;

describe('scheduling refusals', () => {
  it('names every busy resource returned by the API', () => {
    const message = schedulingRefusalMessage(
      'APPOINTMENT_CHILD_CONFLICT',
      {
        conflicts: ['CHILD', 'THERAPIST', 'ROOM'].map((resource, index) => ({
          resource,
          resourceId: id(String(index + 1)),
          appointmentId: id('4'),
          startsAt: '2026-10-19T07:00:00.000Z',
          endsAt: '2026-10-19T07:45:00.000Z',
        })),
      },
      {
        children: { [id('1')]: 'کودک نمونه' },
        therapists: { [id('2')]: 'درمانگر نمونه' },
        rooms: { [id('3')]: 'اتاق نمونه' },
      },
    );
    expect(message).toContain('کودک نمونه');
    expect(message).toContain('درمانگر نمونه');
    expect(message).toContain('اتاق نمونه');
  });

  it('explains partial closure and points to override only when permitted', () => {
    const details = {
      reason: 'PARTIAL_CLOSURE',
      date: '2026-10-19',
      startTime: '11:00',
      endTime: '11:45',
      availableWindows: [{ startTime: '09:00', endTime: '11:00' }],
      closedRanges: [{ startTime: '11:00', endTime: '12:00' }],
      overridable: false,
    };
    const denied = schedulingRefusalMessage('APPOINTMENT_OUTSIDE_AVAILABILITY', details);
    expect(denied).toContain('بخشی از روز بسته است');
    expect(denied).toContain('ساعت حضور درمانگر');
    expect(denied).not.toContain('دلیل را در بخش');
    const allowed = schedulingRefusalMessage('APPOINTMENT_OUTSIDE_AVAILABILITY', {
      ...details,
      overridable: true,
    });
    expect(allowed).toContain('دلیل را در بخش');
  });
});
