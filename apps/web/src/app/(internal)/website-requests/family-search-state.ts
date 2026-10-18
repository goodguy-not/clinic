import type { FamilySummary } from '@clinic/contracts';

export type WebsiteRequestFamilySearchState = {
  q: string;
  families: FamilySummary[];
  truncated: boolean;
  searched: boolean;
  errorMessage: string | null;
};

export const INITIAL_WEBSITE_REQUEST_FAMILY_SEARCH: WebsiteRequestFamilySearchState = {
  q: '',
  families: [],
  truncated: false,
  searched: false,
  errorMessage: null,
};
