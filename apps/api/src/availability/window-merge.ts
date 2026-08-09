/**
 * Combining working windows into one reading of a day.
 *
 * `HH:MM` strings are compared and sorted directly. The format is fixed-width
 * and zero-padded, so lexicographic order is chronological order and no parsing
 * — and therefore no timezone, no `Date`, no arithmetic — is involved at all.
 * That is the whole reason availability is stored as wall-clock text rather than
 * as an instant.
 */

export type ClockWindow = { readonly startTime: string; readonly endTime: string };

/**
 * Sorts windows and merges the ones that touch.
 *
 * ADJACENT WINDOWS ARE MERGED, not only overlapping ones: a recurring block
 * ending at 13:00 and an extra window starting at 13:00 describe one unbroken
 * stretch of availability, and reporting them as two would invite a caller to
 * conclude there is a gap between them. The database keeps them as two rows
 * because they are two decisions somebody made; this is the resolved answer,
 * which is a different question.
 *
 * Recurring windows and dated extra windows are merged together and are not
 * distinguishable in the result. They are equally available time, and a booking
 * check that treated them differently would be inventing a rule nobody approved.
 */
export function mergeWindows(windows: readonly ClockWindow[]): ClockWindow[] {
  const sorted = [...windows].sort(
    (left, right) =>
      left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime),
  );

  const merged: ClockWindow[] = [];

  for (const window of sorted) {
    const last = merged[merged.length - 1];

    if (last !== undefined && window.startTime <= last.endTime) {
      // `>` rather than an unconditional assignment: a window wholly contained
      // in the previous one must not shorten it.
      if (window.endTime > last.endTime) {
        merged[merged.length - 1] = { startTime: last.startTime, endTime: window.endTime };
      }
      continue;
    }

    merged.push({ startTime: window.startTime, endTime: window.endTime });
  }

  return merged;
}

/**
 * The first pair of submitted windows that the database would refuse.
 *
 * Two windows conflict when they name the same weekday and their hours overlap.
 * Half-open, so back-to-back blocks do not conflict — the same bounds as
 * `therapist_availability_no_overlap_excl`.
 *
 * There is no date term, because a recurring window has no dates: it is current
 * configuration and applies whenever it is asked about.
 *
 * This exists so a submission that contradicts ITSELF is refused with the same
 * error a submission that contradicts a stored row gets, rather than as
 * whichever insert happened to land second. The constraint is still the
 * authority — this check runs before the writes, and the constraint runs during
 * them.
 */
export type WeeklyWindow = ClockWindow & { readonly weekday: number };

export function findOverlappingPair(
  windows: readonly WeeklyWindow[],
): [WeeklyWindow, WeeklyWindow] | null {
  for (let index = 0; index < windows.length; index += 1) {
    for (let other = index + 1; other < windows.length; other += 1) {
      const left = windows[index] as WeeklyWindow;
      const right = windows[other] as WeeklyWindow;

      if (left.weekday !== right.weekday) continue;
      if (left.startTime >= right.endTime || right.startTime >= left.endTime) continue;

      return [left, right];
    }
  }

  return null;
}
