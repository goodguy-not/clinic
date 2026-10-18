import type { FamilySummary, RecurrencePreviewResponse } from '@clinic/contracts';

export type BookingState = {
  intent: Record<string, string>;
  families: FamilySummary[];
  searchTruncated: boolean;
  searchPerformed: boolean;
  preview: RecurrencePreviewResponse | null;
  errorMessage: string | null;
  finalCreateConflict: boolean;
  resourceNames?: { therapists: Record<string, string>; rooms: Record<string, string> };
};
