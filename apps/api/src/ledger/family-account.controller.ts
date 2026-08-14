import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  familyAccountQuerySchema,
  type FamilyAccountQuery,
  type FamilyAccountResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { FamilyAccountService } from './family-account.service';

/**
 * What one family was charged.
 *
 * A LEDGER CONTROLLER ON THE FAMILY'S PATH, not a method on `FamiliesController`.
 * The URL belongs to the family because that is the resource an operator is
 * looking at, and Nest matches `families/:id/account` here without any effect on
 * `families/:id` next door. The code stays in `LedgerModule` because the money is
 * the ledger's, and `FamiliesModule` reads no financial table.
 *
 * `charge.read`, NOT `family.read`. Reading who a family is and reading what they
 * owe are two authorities, and a permission that conflated them could not later
 * be withheld from a role that maintains records without seeing money. Manager
 * and receptionist both hold it today (`ROLE_PERMISSIONS`); the receptionist
 * still holds neither `charge.void` nor `charge.adjust`, and nothing on this
 * route mutates anything.
 *
 * A GET WITH THE FILTERS IN THE QUERY STRING, unlike `POST /families/search`. The
 * difference is what travels: a search term is a guardian's name or a mobile
 * number typed by an operator, while these parameters are a family id, a child
 * id, two dates and a page number — identifiers already in the path and in every
 * other appointment URL, not personal data. The RESPONSE carries names, which is
 * why nothing caches it.
 *
 * NOTHING HERE IS AUDITED. `audit_log` is append-only and permanent, and copying
 * a financial read into it would build a second, undeletable store of who was
 * treated and for how much, growing with every screen refresh. Audit records
 * financial ACTS — posting, voiding, adjusting — and this route performs none.
 *
 * NOT A LEDGER SEARCH API. It answers for one family, named by the path, with
 * exactly the filters frozen in F1.
 */
@Controller('families')
export class FamilyAccountController {
  constructor(private readonly account: FamilyAccountService) {}

  /**
   * `ZodBodyPipe` on a query string, which is how the appointment day view reads
   * its filters too: one validation system, and a strict schema means an unknown
   * parameter is refused rather than silently ignored — a caller that mistypes
   * `includeVoided` is told, instead of being shown an account that quietly
   * defaults.
   *
   * THE DEFAULTS ARE THE SCHEMA'S. `includeVoided` defaults to TRUE: financial
   * history is visible unless somebody asks to hide it (frozen F1).
   */
  @Get(':id/account')
  @RequirePermissions('charge.read')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodBodyPipe(familyAccountQuerySchema)) query: FamilyAccountQuery,
  ): Promise<FamilyAccountResponse> {
    return this.account.account(id, query);
  }
}
