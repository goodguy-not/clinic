import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SETTLEMENT_EXPORT_PERMISSIONS, type Permission } from '@clinic/contracts';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { readEndpointAccess } from '../../auth/decorators/endpoint-access';
import { setRequestContext, type ResolvedSession } from '../../common/request-context';
import { SettlementStatementController } from './settlement-statement.controller';

/**
 * WHO MAY TAKE A SETTLEMENT STATEMENT OUT OF THE BUILDING (Milestone 8,
 * checkpoint C8).
 *
 * EVERYTHING HERE IS SYNTHETIC.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS NOT AN INTEGRATION TEST. The frozen
 * authority is an AND-LIST — `settlement.read` AND `report.export` — and the
 * claim worth proving is that REVOKING EITHER HALF closes the download. A
 * permission in this system is derived from the caller's ROLE and cannot be
 * revoked one name at a time over HTTP, so the only place the AND can be
 * exercised directly is the guard that enforces it, driven with a session
 * holding one name and then the other. The role-level halves — a manager holds
 * both, a receptionist holds neither, and a receptionist is refused the live
 * route — are proved in `auth/permissions.spec.ts` and over the real endpoint in
 * `test/settlement-statement-export.int-spec.ts`.
 *
 * IT ALSO PINS THE ROUTE'S DECLARED AUTHORITY, because a guard that refuses
 * correctly protects nothing if the handler stopped naming the list.
 */
describe('the settlement statement export authority', () => {
  const guard = new PermissionsGuard(new Reflector());

  /** A caller holding exactly the named permissions, and nothing else. */
  const contextHolding = (permissions: readonly Permission[]): ExecutionContext => {
    const session: ResolvedSession = {
      sessionId: '0199a0f5-0000-7000-8000-0000000000a1',
      userId: '0199a0f5-0000-7000-8000-0000000000a2',
      username: 'synthetic-manager',
      displayName: 'کاربر آزمایشی',
      role: 'MANAGER',
      mustChangePassword: false,
      permissions,
    };

    const request = {} as Request;
    setRequestContext(request, {
      requestId: '0199a0f5-0000-7000-8000-0000000000a3',
      clientIp: null,
      userAgent: null,
      session,
    });

    return {
      getType: () => 'http',
      getHandler: () => SettlementStatementController.prototype.export,
      getClass: () => SettlementStatementController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  it('names exactly the frozen AND-list on the export route', () => {
    const access = readEndpointAccess(new Reflector(), contextHolding([]));

    expect(access).toEqual({
      kind: 'permissions',
      permissions: ['settlement.read', 'report.export'],
    });
    // The route names the shared constant, so the API and the web tier cannot
    // drift: no `settlement.export` was invented for this file.
    expect([...SETTLEMENT_EXPORT_PERMISSIONS]).toEqual(['settlement.read', 'report.export']);
  });

  it('lets a caller holding both authorities through', () => {
    expect(guard.canActivate(contextHolding([...SETTLEMENT_EXPORT_PERMISSIONS]))).toBe(true);
  });

  it('refuses the export when either half is revoked', () => {
    // Reading the statement on screen does not carry it out of the building...
    expect(() => guard.canActivate(contextHolding(['settlement.read']))).toThrow();
    // ...and the authority to export files opens nothing on its own, which is
    // what keeps `report.export` from being the widest door in the building.
    expect(() => guard.canActivate(contextHolding(['report.export']))).toThrow();
    expect(() => guard.canActivate(contextHolding([]))).toThrow();
  });

  it('refuses a caller holding every OTHER settlement authority', () => {
    // Rating sessions and closing periods are acts on this milestone's own data
    // and grant no view of it as a file.
    expect(() =>
      guard.canActivate(
        contextHolding(['settlement.rate', 'settlement.void_rating', 'settlement.close']),
      ),
    ).toThrow();
  });
});
