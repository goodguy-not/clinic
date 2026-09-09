import 'server-only';
import type { SubmittedBody } from './handler-support';

const optionalText = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

export function servicePublicCopyForm(body: SubmittedBody) {
  return { description: optionalText(body['description']) };
}

export function therapistProfileCopyForm(body: SubmittedBody) {
  return {
    displayName: optionalText(body['displayName']),
    title: optionalText(body['title']),
    bio: optionalText(body['bio']),
  };
}

export function clinicProfileForm(body: SubmittedBody) {
  const optionalNumber = (value: string | undefined): number | null => {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? null : Number(trimmed);
  };

  return {
    displayName: optionalText(body['displayName']),
    tagline: optionalText(body['tagline']),
    about: optionalText(body['about']),
    addressLine: optionalText(body['addressLine']),
    cityLabel: optionalText(body['cityLabel']),
    phonePrimary: optionalText(body['phonePrimary']),
    phoneSecondary: optionalText(body['phoneSecondary']),
    email: optionalText(body['email']),
    workingHoursNote: optionalText(body['workingHoursNote']),
    mapLatitude: optionalNumber(body['mapLatitude']),
    mapLongitude: optionalNumber(body['mapLongitude']),
    instagramUrl: optionalText(body['instagramUrl']),
    telegramUrl: optionalText(body['telegramUrl']),
  };
}
