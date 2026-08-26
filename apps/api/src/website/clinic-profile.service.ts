import { Injectable } from '@nestjs/common';
import type { PublicClinicProfile, UpdateClinicProfileRequest } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { isCheckViolation } from '../common/pg-error';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { actorContext, canonicalOptionalText } from '../catalog/catalog-support';
import { PublicSiteService } from './public-site.service';

/**
 * The clinic's own public facts, written by the manager who owns them.
 *
 * Milestone 9, checkpoint A2. A1 created this row EMPTY and gave it no writer;
 * this is that writer. After it, changing the address, the telephone number or
 * the opening-hours line on a live website is a form submission rather than
 * SQL, a seed or a deployment — which is the rule the checkpoint plan exists to
 * enforce.
 *
 * THIRTEEN FIELDS, ALL OF THEM, EVERY TIME. A partial update would have to
 * distinguish "leave the second number alone" from "clear it", and this is one
 * screen with thirteen boxes on it: what the manager submits is what the clinic
 * says.
 *
 * THE READ IS THE PUBLIC PROJECTION ITSELF, reused rather than reimplemented.
 * This is the one place in the milestone where that is right: every column on
 * this row is a public fact, so there is nothing to project away, and a second
 * identical query would be a second thing to keep in step. It still sits behind
 * `clinic_profile.read`, because seeing what the site publishes is internal
 * administration even when the facts are not secret.
 *
 * NOTHING IS INVENTED HERE, and no fixture in this repository fills these
 * columns with anything but obviously synthetic values. The real name, address,
 * hours and links are owner-supplied (PROJECT_SPEC.md 17).
 */
@Injectable()
export class ClinicProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly site: PublicSiteService,
  ) {}

  read(): Promise<PublicClinicProfile> {
    return this.site.getClinicProfile();
  }

  async update(
    input: UpdateClinicProfileRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PublicClinicProfile> {
    const next = {
      displayName: canonicalOptionalText(input.displayName),
      tagline: canonicalOptionalText(input.tagline),
      about: canonicalOptionalText(input.about),
      addressLine: canonicalOptionalText(input.addressLine),
      cityLabel: canonicalOptionalText(input.cityLabel),
      phonePrimary: canonicalOptionalText(input.phonePrimary),
      phoneSecondary: canonicalOptionalText(input.phoneSecondary),
      email: canonicalOptionalText(input.email),
      workingHoursNote: canonicalOptionalText(input.workingHoursNote),
      instagramUrl: canonicalOptionalText(input.instagramUrl),
      telegramUrl: canonicalOptionalText(input.telegramUrl),
    };

    return this.prisma.$transaction(async (tx) => {
      // Locked for the length of the transaction. Two managers saving the form
      // at once would otherwise interleave a read and a write, and the audit
      // row of the second would claim a `before` the first had already
      // replaced.
      await tx.$queryRaw`SELECT singleton_key FROM clinic_public_profile WHERE singleton_key = 1 FOR UPDATE`;

      const before = await this.site.getClinicProfile(tx);

      try {
        await tx.$executeRaw`
          UPDATE clinic_public_profile
          SET display_name = ${next.displayName},
              tagline = ${next.tagline},
              about = ${next.about},
              address_line = ${next.addressLine},
              city_label = ${next.cityLabel},
              phone_primary = ${next.phonePrimary},
              phone_secondary = ${next.phoneSecondary},
              email = ${next.email},
              working_hours_note = ${next.workingHoursNote},
              map_latitude = ${input.mapLatitude},
              map_longitude = ${input.mapLongitude},
              instagram_url = ${next.instagramUrl},
              telegram_url = ${next.telegramUrl}
          WHERE singleton_key = 1
        `;
      } catch (error) {
        // The four CHECKs on this table restate rules the request schema
        // already enforces, so reaching one means the two tiers disagree — a
        // defect, not a user mistake. It is reported as `VALIDATION_FAILED`
        // rather than as a 500 because the caller's next move is the same
        // either way: look at what was typed.
        if (isCheckViolation(error)) throw new AppError('VALIDATION_FAILED');
        throw error;
      }

      const after = await this.site.getClinicProfile(tx);

      // ONE ACTION AND NO PUBLICATION ACT TO SEPARATE FROM IT. There is one
      // profile, it is always live, and editing it IS publishing — unlike a
      // service, a therapist or an article, none of which is visible until
      // somebody decides it should be.
      //
      // ELEVEN OF THE THIRTEEN FACTS ARE RECORDED IN FULL. They are short
      // public facts about a business — not personal data and not prose — so
      // recording them is what makes the trail answer "what did the website say
      // last month?".
      //
      // THE TWO TELEPHONE NUMBERS ARE NOT AMONG THEM, AND THIS IS THE
      // DELIBERATE PART. `audit_log` refuses an unmasked value under any key
      // named like a telephone number, in the application guard AND in
      // `audit_identifiers_masked()` in the database (Milestone 3). That rule
      // is about a PERSON'S number, and the clinic's own published number is
      // genuinely not one — but the two ways of getting the value in here are
      // both worse than leaving it out:
      //
      //   * relaxing the rule for this entity type would weaken a permanent
      //     privacy guarantee, in both tiers, so that a future call site
      //     labelling family data as a clinic profile would slip through;
      //   * masking the value would produce `*******0000`, which is lossy, and
      //     would fail outright on a number typed in Persian digits — a defect
      //     reaching a manager for a number the website prints in the clear.
      //
      // So the trail records THAT the published numbers changed, with the actor
      // and the instant, and the numbers themselves stay where they are already
      // readable: on the row, and on the website.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'clinic_public_profile.updated',
        entityType: 'clinic_public_profile',
        // NULL, and it has to be: the row's primary key is the integer 1 and
        // `audit_log.entity_id` is a UUID column. There is only ever one
        // profile, so the entity type names it exactly.
        entityId: null,
        before: auditableProfile(before),
        after: auditableProfile(after),
        metadata: {
          contactNumbersChanged:
            before.phonePrimary !== after.phonePrimary ||
            before.phoneSecondary !== after.phoneSecondary,
        },
      });

      return after;
    });
  }
}

/**
 * The profile as an audit payload: everything except the two telephone
 * numbers.
 *
 * Written as an explicit destructure rather than a `delete`, so a column added
 * to the profile tomorrow arrives in the trail by default and a column that
 * must be withheld has to be withheld HERE, visibly, with a reason beside it.
 */
function auditableProfile(profile: PublicClinicProfile): Record<string, string | number | null> {
  const { phonePrimary: _primary, phoneSecondary: _secondary, ...auditable } = profile;
  return auditable;
}
