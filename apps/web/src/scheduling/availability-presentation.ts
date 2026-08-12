export const WEEKDAYS_FA = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
] as const;

export function windowsOverlap(
  first: { weekday: number; startTime: string; endTime: string },
  second: { weekday: number; startTime: string; endTime: string },
): boolean {
  return (
    first.weekday === second.weekday &&
    first.startTime < second.endTime &&
    second.startTime < first.endTime
  );
}
