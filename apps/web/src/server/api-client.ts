import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  createUserResponseSchema,
  errorEnvelopeSchema,
  loginResponseSchema,
  passwordResetResponseSchema,
  revokeSessionsResponseSchema,
  roomListResponseSchema,
  roomResponseSchema,
  serviceListResponseSchema,
  serviceResponseSchema,
  sessionResponseSchema,
  tariffListResponseSchema,
  tariffResponseSchema,
  therapistListResponseSchema,
  therapistResponseSchema,
  userListResponseSchema,
  userResponseSchema,
  type CatalogStatus,
  type CreateRoomRequest,
  type CreateServiceRequest,
  type CreateTariffRequest,
  type CreateTherapistRequest,
  type CreateUserRequest,
  type CreateUserResponse,
  type ErrorCode,
  type LoginRequest,
  type LoginResponse,
  type PasswordResetResponse,
  type RevokeSessionsResponse,
  type RoomListResponse,
  type RoomResponse,
  type ServiceListResponse,
  type ServiceResponse,
  type SessionResponse,
  type TariffListQuery,
  type TariffListResponse,
  type TariffResponse,
  type TherapistListResponse,
  type TherapistResponse,
  type UpdateRoomRequest,
  type UpdateServiceRequest,
  type UpdateTherapistRequest,
  type UserListResponse,
  type UserResponse,
  type UserRole,
  type UserStatus,
} from '@clinic/contracts';
import { loadServerEnv } from '@/env';

/**
 * Server-only client for the NestJS API.
 *
 * `server-only` makes importing this from a Client Component a build error, so
 * the internal key and the session token can never reach the browser. Server
 * Components may call it directly; there is no generic proxy route.
 *
 * The outbound header set is built here from scratch, and this module exposes
 * no way to pass arbitrary headers. That is the structural half of "NestJS
 * never trusts the web tier's claims": there is no parameter through which a
 * browser-supplied `x-user-id`, `x-user-role`, `x-permissions`,
 * `authorization`, `x-request-id` or `x-internal-key` could be forwarded, so
 * the rule is enforced by the function signature rather than by review.
 */

export type CallerContext = {
  /** The opaque session token, only after the cookie signature verified. */
  sessionToken?: string;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type ApiSuccess<T> = { ok: true; data: T; requestId: string };
export type ApiFailure = {
  ok: false;
  code: ErrorCode | 'API_UNREACHABLE';
  status: number;
  requestId: string;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const REQUEST_TIMEOUT_MS = 8000;
const MAX_USER_AGENT_LENGTH = 256;

function buildHeaders(context: CallerContext, requestId: string, hasBody: boolean): Headers {
  const { INTERNAL_API_KEY } = loadServerEnv();
  const headers = new Headers();

  headers.set('accept', 'application/json');
  headers.set('x-internal-key', INTERNAL_API_KEY);

  // Generated here, never taken from the browser. NestJS validates it as a UUID
  // and replaces anything malformed, but not forwarding a client value in the
  // first place is what keeps an attacker from choosing the identifier that
  // ends up in the audit trail.
  headers.set('x-request-id', requestId);

  if (hasBody) headers.set('content-type', 'application/json');
  if (context.sessionToken !== undefined) headers.set('x-session-id', context.sessionToken);
  if (context.clientIp != null && context.clientIp !== '') {
    headers.set('x-client-ip', context.clientIp);
  }
  if (context.userAgent != null && context.userAgent !== '') {
    headers.set('x-client-user-agent', context.userAgent.slice(0, MAX_USER_AGENT_LENGTH));
  }

  return headers;
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  schema: { parse: (value: unknown) => T },
  context: CallerContext,
  body?: unknown,
): Promise<ApiResult<T>> {
  const { API_BASE_URL } = loadServerEnv();
  const requestId = randomUUID();

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: buildHeaders(context, requestId, body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    // Detail deliberately dropped: an upstream failure must not surface
    // internal hostnames or stack traces to a browser response.
    return { ok: false, code: 'API_UNREACHABLE', status: 503, requestId };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T, requestId };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = errorEnvelopeSchema.safeParse(payload);

    return {
      ok: false,
      code: envelope.success ? envelope.data.error.code : 'API_UNREACHABLE',
      status: response.status,
      requestId: envelope.success ? envelope.data.error.requestId : requestId,
    };
  }

  // Parsed against the strict contract. An unexpected field in a NestJS
  // response — a serialised password hash above all — fails here rather than
  // reaching a page.
  return { ok: true, data: schema.parse(payload), requestId };
}

export const api = {
  login: (body: LoginRequest, context: CallerContext): Promise<ApiResult<LoginResponse>> =>
    call('/auth/login', 'POST', loginResponseSchema, context, body),

  logout: (context: CallerContext): Promise<ApiResult<void>> =>
    call('/auth/logout', 'POST', { parse: () => undefined }, context),

  session: (context: CallerContext): Promise<ApiResult<SessionResponse>> =>
    call('/auth/session', 'GET', sessionResponseSchema, context),

  changePassword: (
    body: { currentPassword: string; newPassword: string },
    context: CallerContext,
  ): Promise<ApiResult<LoginResponse>> =>
    call('/auth/password', 'POST', loginResponseSchema, context, body),

  listUsers: (context: CallerContext): Promise<ApiResult<UserListResponse>> =>
    call('/users', 'GET', userListResponseSchema, context),

  createUser: (
    body: CreateUserRequest,
    context: CallerContext,
  ): Promise<ApiResult<CreateUserResponse>> =>
    call('/users', 'POST', createUserResponseSchema, context, body),

  changeRole: (
    id: string,
    role: UserRole,
    context: CallerContext,
  ): Promise<ApiResult<UserResponse>> =>
    call(`/users/${encodeURIComponent(id)}/role`, 'PATCH', userResponseSchema, context, { role }),

  changeStatus: (
    id: string,
    status: UserStatus,
    context: CallerContext,
  ): Promise<ApiResult<UserResponse>> =>
    call(`/users/${encodeURIComponent(id)}/status`, 'PATCH', userResponseSchema, context, {
      status,
    }),

  resetUserPassword: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<PasswordResetResponse>> =>
    call(
      `/users/${encodeURIComponent(id)}/password-reset`,
      'POST',
      passwordResetResponseSchema,
      context,
    ),

  unlockUser: (id: string, context: CallerContext): Promise<ApiResult<UserResponse>> =>
    call(`/users/${encodeURIComponent(id)}/unlock`, 'POST', userResponseSchema, context),

  revokeUserSessions: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<RevokeSessionsResponse>> =>
    call(
      `/users/${encodeURIComponent(id)}/sessions/revoke`,
      'POST',
      revokeSessionsResponseSchema,
      context,
    ),

  // --- clinic reference data -------------------------------------------------
  //
  // One typed method per endpoint, listed by hand. There is no generic
  // `request(path)` here on purpose: a caller cannot reach a route this object
  // does not name, so the BFF cannot drift into a proxy.

  listServices: (context: CallerContext): Promise<ApiResult<ServiceListResponse>> =>
    call('/catalog/services', 'GET', serviceListResponseSchema, context),

  getService: (id: string, context: CallerContext): Promise<ApiResult<ServiceResponse>> =>
    call(`/catalog/services/${encodeURIComponent(id)}`, 'GET', serviceResponseSchema, context),

  createService: (
    body: CreateServiceRequest,
    context: CallerContext,
  ): Promise<ApiResult<ServiceResponse>> =>
    call('/catalog/services', 'POST', serviceResponseSchema, context, body),

  updateService: (
    id: string,
    body: UpdateServiceRequest,
    context: CallerContext,
  ): Promise<ApiResult<ServiceResponse>> =>
    call(
      `/catalog/services/${encodeURIComponent(id)}`,
      'PATCH',
      serviceResponseSchema,
      context,
      body,
    ),

  changeServiceStatus: (
    id: string,
    status: CatalogStatus,
    context: CallerContext,
  ): Promise<ApiResult<ServiceResponse>> =>
    call(
      `/catalog/services/${encodeURIComponent(id)}/status`,
      'PATCH',
      serviceResponseSchema,
      context,
      { status },
    ),

  listRooms: (context: CallerContext): Promise<ApiResult<RoomListResponse>> =>
    call('/catalog/rooms', 'GET', roomListResponseSchema, context),

  getRoom: (id: string, context: CallerContext): Promise<ApiResult<RoomResponse>> =>
    call(`/catalog/rooms/${encodeURIComponent(id)}`, 'GET', roomResponseSchema, context),

  createRoom: (body: CreateRoomRequest, context: CallerContext): Promise<ApiResult<RoomResponse>> =>
    call('/catalog/rooms', 'POST', roomResponseSchema, context, body),

  updateRoom: (
    id: string,
    body: UpdateRoomRequest,
    context: CallerContext,
  ): Promise<ApiResult<RoomResponse>> =>
    call(`/catalog/rooms/${encodeURIComponent(id)}`, 'PATCH', roomResponseSchema, context, body),

  changeRoomStatus: (
    id: string,
    status: CatalogStatus,
    context: CallerContext,
  ): Promise<ApiResult<RoomResponse>> =>
    call(`/catalog/rooms/${encodeURIComponent(id)}/status`, 'PATCH', roomResponseSchema, context, {
      status,
    }),

  listTherapists: (context: CallerContext): Promise<ApiResult<TherapistListResponse>> =>
    call('/catalog/therapists', 'GET', therapistListResponseSchema, context),

  getTherapist: (id: string, context: CallerContext): Promise<ApiResult<TherapistResponse>> =>
    call(`/catalog/therapists/${encodeURIComponent(id)}`, 'GET', therapistResponseSchema, context),

  createTherapist: (
    body: CreateTherapistRequest,
    context: CallerContext,
  ): Promise<ApiResult<TherapistResponse>> =>
    call('/catalog/therapists', 'POST', therapistResponseSchema, context, body),

  updateTherapist: (
    id: string,
    body: UpdateTherapistRequest,
    context: CallerContext,
  ): Promise<ApiResult<TherapistResponse>> =>
    call(
      `/catalog/therapists/${encodeURIComponent(id)}`,
      'PATCH',
      therapistResponseSchema,
      context,
      body,
    ),

  changeTherapistStatus: (
    id: string,
    status: CatalogStatus,
    context: CallerContext,
  ): Promise<ApiResult<TherapistResponse>> =>
    call(
      `/catalog/therapists/${encodeURIComponent(id)}/status`,
      'PATCH',
      therapistResponseSchema,
      context,
      { status },
    ),

  listTariffs: (
    query: TariffListQuery,
    context: CallerContext,
  ): Promise<ApiResult<TariffListResponse>> => {
    const search = new URLSearchParams();
    if (query.serviceId !== undefined) search.set('serviceId', query.serviceId);
    if (query.scope !== undefined) search.set('scope', query.scope);
    if (query.therapistId !== undefined) search.set('therapistId', query.therapistId);
    if (query.onDate !== undefined) search.set('onDate', query.onDate);
    if (query.includeVoided === true) search.set('includeVoided', 'true');

    const suffix = search.size === 0 ? '' : `?${search.toString()}`;

    return call(`/catalog/tariffs${suffix}`, 'GET', tariffListResponseSchema, context);
  },

  getTariff: (id: string, context: CallerContext): Promise<ApiResult<TariffResponse>> =>
    call(`/catalog/tariffs/${encodeURIComponent(id)}`, 'GET', tariffResponseSchema, context),

  createTariff: (
    body: CreateTariffRequest,
    context: CallerContext,
  ): Promise<ApiResult<TariffResponse>> =>
    call('/catalog/tariffs', 'POST', tariffResponseSchema, context, body),

  voidTariff: (
    id: string,
    reason: string,
    context: CallerContext,
  ): Promise<ApiResult<TariffResponse>> =>
    call(`/catalog/tariffs/${encodeURIComponent(id)}/void`, 'POST', tariffResponseSchema, context, {
      reason,
    }),
};

export type ApiLiveness = {
  status: string;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
};

/** Liveness only; `/health` is the one route NestJS exposes without the key. */
export async function fetchApiLiveness(): Promise<
  { ok: true; data: ApiLiveness } | { ok: false; reason: 'unreachable' | 'unhealthy' }
> {
  const { API_BASE_URL } = loadServerEnv();

  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });

    if (!response.ok) return { ok: false, reason: 'unhealthy' };

    return { ok: true, data: (await response.json()) as ApiLiveness };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
