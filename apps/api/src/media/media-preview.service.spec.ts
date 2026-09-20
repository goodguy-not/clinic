import { MEDIA_ATTACHMENT_OWNERS, PERMISSIONS } from '@clinic/contracts';
import { ROLE_PERMISSIONS } from '../auth/permissions';
import { MEDIA_PREVIEW_OWNER_PERMISSION, previewableOwnerTypes } from './media-preview.service';

/**
 * Who may preview a draft photograph where. The map is authorization, so it is
 * pinned value by value: a change here is a decision, and should fail a build.
 */
describe('media preview authority', () => {
  it('names an existing permission for every owner type, and no media authority', () => {
    for (const owner of MEDIA_ATTACHMENT_OWNERS) {
      const permission = MEDIA_PREVIEW_OWNER_PERMISSION[owner];
      expect(PERMISSIONS).toContain(permission);
      expect(permission.startsWith('media.')).toBe(false);
    }
  });

  it('reuses the owner’s own draft-read permission', () => {
    expect(MEDIA_PREVIEW_OWNER_PERMISSION).toEqual({
      THERAPIST_PROFILE: 'therapist.draft_public_profile',
      PUBLIC_ARTICLE: 'article.read',
      PUBLIC_TESTIMONIAL: 'testimonial.read',
      PUBLIC_SPACE: 'public_space.read',
      PUBLIC_SERVICE: 'service.draft_public_copy',
      CLINIC_CONTENT_ENTRY: 'clinic_profile.read',
      CLINIC_OPEN_GRAPH: 'clinic_profile.read',
      CLINIC_SPACE: 'clinic_profile.read',
    });
  });

  it('gives a manager every owner type', () => {
    expect(previewableOwnerTypes(ROLE_PERMISSIONS.MANAGER)).toEqual([...MEDIA_ATTACHMENT_OWNERS]);
  });

  it('gives a receptionist the drafts they can read, and none of the clinic profile', () => {
    // `PUBLIC_SERVICE` joins the list in Milestone 9.5 checkpoint A9 and adds
    // no authority: the receptionist already holds `service.draft_public_copy`,
    // which is the editorial read of a service's public copy, and a draft
    // photograph for that service is part of the same draft. Nothing
    // operational and nothing publishing comes with it.
    expect(new Set(previewableOwnerTypes(ROLE_PERMISSIONS.RECEPTIONIST))).toEqual(
      new Set([
        'THERAPIST_PROFILE',
        'PUBLIC_ARTICLE',
        'PUBLIC_TESTIMONIAL',
        'PUBLIC_SPACE',
        'PUBLIC_SERVICE',
      ]),
    );
  });

  it('grants nothing for media.read alone', () => {
    expect(previewableOwnerTypes(['media.read', 'media.upload', 'media.attach'])).toEqual([]);
  });

  it('grants exactly the owners whose read is held', () => {
    expect(previewableOwnerTypes(['media.read', 'testimonial.read'])).toEqual([
      'PUBLIC_TESTIMONIAL',
    ]);
  });
});
