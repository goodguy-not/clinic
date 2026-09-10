import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  availabilityExceptionListResponseSchema,
  availabilityExceptionResponseSchema,
  availabilityWindowListResponseSchema,
  articleListResponseSchema,
  articleResponseSchema,
  dashboardResponseSchema,
  familyAccountReportResponseSchema,
  paymentReportResponseSchema,
  sessionReportResponseSchema,
  promiseReportResponseSchema,
  mediaAssetListResponseSchema,
  mediaAssetResponseSchema,
  clinicContentEntryResponseSchema,
  clinicContentResponseSchema,
  publicClinicProfileResponseSchema,
  servicePublicCopyListResponseSchema,
  servicePublicCopyResponseSchema,
  therapistProfileCopyListResponseSchema,
  therapistProfileCopyResponseSchema,
  therapistPublicProfileResponseSchema,
  therapistActivityResponseSchema,
  websiteRequestDetailSchema,
  websiteRequestInboxResponseSchema,
  appointmentDayResponseSchema,
  appointmentSeriesOperationResponseSchema,
  appointmentSeriesResponseSchema,
  appointmentResponseSchema,
  appointmentViewResponseSchema,
  postSessionChargeResponseSchema,
  paymentListResponseSchema,
  paymentResponseSchema,
  promiseListResponseSchema,
  promiseResponseSchema,
  recurrencePreviewResponseSchema,
  rescheduledPromiseResponseSchema,
  createUserResponseSchema,
  errorEnvelopeSchema,
  loginResponseSchema,
  passwordResetResponseSchema,
  resolveAvailabilityResponseSchema,
  revokeSessionsResponseSchema,
  roomListResponseSchema,
  roomResponseSchema,
  serviceListResponseSchema,
  serviceResponseSchema,
  sessionResponseSchema,
  sessionChargeResponseSchema,
  tariffListResponseSchema,
  tariffResponseSchema,
  therapistListResponseSchema,
  therapistResponseSchema,
  testimonialListResponseSchema,
  testimonialResponseSchema,
  userListResponseSchema,
  userResponseSchema,
  type CatalogStatus,
  type AvailabilityExceptionListQuery,
  type AvailabilityExceptionListResponse,
  type AvailabilityExceptionResponse,
  type AvailabilityWindowListResponse,
  type AppointmentDayQuery,
  type AppointmentDayResponse,
  type AppointmentResponse,
  type AppointmentSeriesOperationResponse,
  type AppointmentSeriesResponse,
  type AppointmentViewResponse,
  type ArticleListResponse,
  type ArticleResponse,
  type CancelAppointmentRequest,
  type CancelAppointmentSeriesFromRequest,
  type ChildDetailResponse,
  type ChildWriteResponse,
  type ConfirmDraftRequest,
  type CreateAvailabilityExceptionRequest,
  type CreateAppointmentRequest,
  type CreateAppointmentSeriesRequest,
  type CreateArticleRequest,
  type CreateChildRequest,
  type CreateFamilyRequest,
  type CreateRoomRequest,
  type CreateServiceRequest,
  type CreateTariffRequest,
  type CreateTherapistRequest,
  type CreateTestimonialRequest,
  type CreateUserRequest,
  type CreateUserResponse,
  type DashboardQuery,
  type DashboardResponse,
  type FamilyAccountReportQuery,
  type FamilyAccountReportExportQuery,
  type FamilyAccountReportResponse,
  type PaymentReportQuery,
  type PaymentReportExportQuery,
  type PaymentReportResponse,
  type SessionReportQuery,
  type SessionReportExportQuery,
  type SessionReportResponse,
  type PromiseReportQuery,
  type PromiseReportExportQuery,
  type PromiseReportResponse,
  type TherapistActivityQuery,
  type TherapistActivityExportQuery,
  type TherapistActivityResponse,
  type WebsiteRequestDetail,
  type WebsiteRequestInboxQuery,
  type WebsiteRequestInboxResponse,
  type ChangeWebsiteRequestStatusRequest,
  type LinkWebsiteRequestRequest,
  type ErrorCode,
  familyAccountResponseSchema,
  type FamilyAccountQuery,
  type FamilyAccountResponse,
  type FamilyDetailResponse,
  type FamilyListResponse,
  type FamilySearchRequest,
  type FamilyWriteResponse,
  type LoginRequest,
  type LoginResponse,
  type MoveAppointmentRequest,
  type CreateMediaAttachmentRequest,
  type MediaAssetListResponse,
  type MediaAssetResponse,
  type ClinicContentEntryResponse,
  type ClinicContentResponse,
  type UpdateMediaFramingRequest,
  type UpdateMediaPublicationRequest,
  type PublicClinicProfileResponse,
  type ServicePublicCopyListResponse,
  type ServicePublicCopyResponse,
  type TherapistProfileCopyListResponse,
  type TherapistProfileCopyResponse,
  type TherapistPublicProfileResponse,
  type UpdateClinicProfileRequest,
  type UpdateClinicContentEntryRequest,
  type UpdateServicePublicCopyRequest,
  type UpdateServicePublicCopyPublicationRequest,
  type UpdateTherapistProfileCopyRequest,
  type UpdateTherapistPublicProfileRequest,
  type UpdateTherapistPublicVisibilityRequest,
  type PostSessionChargeResponse,
  type PaymentListQuery,
  type PaymentListResponse,
  type PaymentResponse,
  type PromiseListQuery,
  type PromiseListResponse,
  type PromiseResponse,
  type PasswordResetResponse,
  type RecordStatus,
  type RecordAttendanceRequest,
  type RegistrationDraftResponse,
  type ReplaceAvailabilityWindowsRequest,
  type ResolveAvailabilityQuery,
  type ResolveAvailabilityResponse,
  type RevokeSessionsResponse,
  type ReopenAppointmentRequest,
  type RecurrencePreviewResponse,
  type RoomListResponse,
  type RoomResponse,
  type ServiceListResponse,
  type ServiceResponse,
  type SessionResponse,
  type SessionChargeDetail,
  type SessionChargeResponse,
  type TariffListQuery,
  type TariffListResponse,
  type TariffResponse,
  type TherapistListResponse,
  type TherapistResponse,
  type TestimonialListResponse,
  type TestimonialResponse,
  type UpdateChildRequest,
  type UpdateFamilyRequest,
  type UpdateAppointmentSeriesFromRequest,
  type UpdateArticlePublicationRequest,
  type UpdateArticleRequest,
  type UpdateRoomRequest,
  type UpdateServiceRequest,
  type UpdateTherapistRequest,
  type UpdateTestimonialApprovalRequest,
  type UpdateTestimonialPublicationRequest,
  type UpdateTestimonialRequest,
  type UserListResponse,
  type UserResponse,
  type UserRole,
  type UserStatus,
  type CreateChargeAdjustmentRequest,
  type CreatePaymentRequest,
  type CreatePromiseRequest,
  type FulfillPromiseRequest,
  type ReschedulePromiseRequest,
  type RescheduledPromiseResponse,
  type CancelPromiseRequest,
  type VoidPaymentRequest,
  type VoidChargeAdjustmentRequest,
  type VoidSessionChargeRequest,
  childDetailResponseSchema,
  childWriteResponseSchema,
  familyDetailResponseSchema,
  familyListResponseSchema,
  familyWriteResponseSchema,
  registrationDraftResponseSchema,
  shareRuleListResponseSchema,
  shareRuleResponseSchema,
  sessionSettlementResponseSchema,
  settlementStatementResponseSchema,
  settlementPeriodListResponseSchema,
  closeSettlementPeriodResponseSchema,
  settlementPeriodDetailResponseSchema,
  type ShareRuleListQuery,
  type ShareRuleListResponse,
  type ShareRuleResponse,
  type CreateShareRuleRequest,
  type VoidShareRuleRequest,
  type RateSessionRequest,
  type SessionSettlementResponse,
  type SettlementStatementQuery,
  type SettlementStatementResponse,
  type SettlementPeriodListQuery,
  type SettlementPeriodListResponse,
  type CloseSettlementPeriodRequest,
  type CloseSettlementPeriodResponse,
  type SettlementPeriodDetailResponse,
  type SettlementStatementExportQuery,
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
  /**
   * The registration-draft token, read from this server's own `draft` cookie
   * and forwarded as `x-draft-token`. Never taken from a browser-supplied
   * value — see `CallerContext`'s own rule that this module builds every
   * outbound header itself.
   */
  draftToken?: string;
};

export type ApiSuccess<T> = { ok: true; data: T; requestId: string };
export type ApiFailure = {
  ok: false;
  code: ErrorCode | 'API_UNREACHABLE';
  status: number;
  requestId: string;
  /**
   * The envelope's `error.details`, unparsed. Populated only for the two
   * codes that carry one — `FAMILY_POSSIBLE_DUPLICATE` and
   * `CHILD_POSSIBLE_DUPLICATE` — so a caller can parse it against
   * `duplicateBlockedDetailsSchema` and read the draft token out of it. Every
   * other failure leaves this undefined.
   */
  details?: unknown;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
export type ApiCsvResult = { ok: true; response: Response; requestId: string } | ApiFailure;
export type ReportExportQuery =
  | SessionReportExportQuery
  | PromiseReportExportQuery
  | TherapistActivityExportQuery
  | PaymentReportExportQuery
  | FamilyAccountReportExportQuery
  | SettlementStatementExportQuery;

const REQUEST_TIMEOUT_MS = 8000;
const MAX_USER_AGENT_LENGTH = 256;

/**
 * Nest ledger URLs are owned by the API workstream, not by the browser-facing
 * `/api/ledger/*` handlers. Keep the finalized read and correction paths
 * isolated here so Web callers and presentation contracts do not encode Nest
 * routing details.
 */
const sessionChargeApiPath = {
  postForParticipant: (participantId: string) =>
    `/session-charges/participants/${encodeURIComponent(participantId)}`,
  void: (chargeId: string) => `/session-charges/${encodeURIComponent(chargeId)}/void`,
  familyAccount: (familyId: string) => `/families/${encodeURIComponent(familyId)}/account`,
  participantChargeState: (participantId: string) =>
    `/session-charges/participants/${encodeURIComponent(participantId)}`,
  createAdjustment: (chargeId: string) =>
    `/session-charges/${encodeURIComponent(chargeId)}/adjustments`,
  voidAdjustment: (chargeId: string, adjustmentId: string) =>
    `/session-charges/${encodeURIComponent(chargeId)}/adjustments/${encodeURIComponent(adjustmentId)}/void`,
} as const;

const familyMoneyApiPath = {
  payments: (familyId: string) => `/families/${encodeURIComponent(familyId)}/payments`,
  voidPayment: (paymentId: string) => `/payments/${encodeURIComponent(paymentId)}/void`,
  promises: (familyId: string) => `/families/${encodeURIComponent(familyId)}/promises`,
  fulfillPromise: (promiseId: string) => `/promises/${encodeURIComponent(promiseId)}/fulfill`,
  reschedulePromise: (promiseId: string) => `/promises/${encodeURIComponent(promiseId)}/reschedule`,
  cancelPromise: (promiseId: string) => `/promises/${encodeURIComponent(promiseId)}/cancel`,
} as const;

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
  if (context.draftToken !== undefined && context.draftToken !== '') {
    headers.set('x-draft-token', context.draftToken);
  }

  return headers;
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
      ...(envelope.success && envelope.data.error.details !== undefined
        ? { details: envelope.data.error.details }
        : {}),
    };
  }

  // Parsed against the strict contract. An unexpected field in a NestJS
  // response — a serialised password hash above all — fails here rather than
  // reaching a page.
  return { ok: true, data: schema.parse(payload), requestId };
}

/**
 * The one non-JSON staff write. `fetch` owns the multipart boundary; setting a
 * content type here would omit it and make an otherwise valid photograph look
 * malformed to NestJS.
 */
async function callMultipart<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  context: CallerContext,
  form: FormData,
): Promise<ApiResult<T>> {
  const { API_BASE_URL } = loadServerEnv();
  const requestId = randomUUID();
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(context, requestId, false),
      body: form,
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'API_UNREACHABLE', status: 503, requestId };
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

  return { ok: true, data: schema.parse(payload), requestId };
}

/** Frozen report filters only: dates, closed enums, opaque ids, and paging. */
function reportSearch(query: object): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined)
      search.set(key, typeof value === 'boolean' ? String(value) : String(value));
  }
  return search;
}

/**
 * Requests the authoritative NestJS export and leaves its bytes untouched.
 * The Web tier only supplies the validated filter vocabulary and transports
 * the response; it never parses, reconstructs, or enriches CSV rows.
 */
async function exportReportCsv(
  kind:
    'sessions' | 'promises' | 'therapist-activity' | 'payments' | 'family-accounts' | 'settlement',
  query: ReportExportQuery,
  context: CallerContext,
): Promise<ApiCsvResult> {
  const { API_BASE_URL } = loadServerEnv();
  const requestId = randomUUID();
  const headers = buildHeaders(context, requestId, false);
  headers.set('accept', 'text/csv');

  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}${kind === 'settlement' ? '/settlement/statement/export' : `/reports/${kind}/export`}?${reportSearch(query).toString()}`,
      {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
  } catch {
    return { ok: false, code: 'API_UNREACHABLE', status: 503, requestId };
  }

  if (!response.ok) {
    const payload: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const envelope = errorEnvelopeSchema.safeParse(payload);
    return {
      ok: false,
      code: envelope.success ? envelope.data.error.code : 'API_UNREACHABLE',
      status: response.status,
      requestId: envelope.success ? envelope.data.error.requestId : requestId,
    };
  }

  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/csv')) {
    return { ok: false, code: 'API_UNREACHABLE', status: 502, requestId };
  }

  return { ok: true, response, requestId };
}

export const api = {
  exportReportCsv,

  // --- reusable media workspace -------------------------------------------

  listMedia: (context: CallerContext): Promise<ApiResult<MediaAssetListResponse>> =>
    call('/media', 'GET', mediaAssetListResponseSchema, context),

  getMedia: (id: string, context: CallerContext): Promise<ApiResult<MediaAssetResponse>> =>
    call(`/media/${encodeURIComponent(id)}`, 'GET', mediaAssetResponseSchema, context),

  uploadMedia: (
    file: Blob,
    altText: string,
    context: CallerContext,
  ): Promise<ApiResult<MediaAssetResponse>> => {
    const form = new FormData();
    form.set('file', file, 'photograph');
    form.set('altText', altText);
    return callMultipart('/media', mediaAssetResponseSchema, context, form);
  },

  createMediaAttachment: (
    mediaId: string,
    body: CreateMediaAttachmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<MediaAssetResponse>> =>
    call(
      `/media/${encodeURIComponent(mediaId)}/attachments`,
      'POST',
      mediaAssetResponseSchema,
      context,
      body,
    ),

  updateMediaFraming: (
    attachmentId: string,
    body: UpdateMediaFramingRequest,
    context: CallerContext,
  ): Promise<ApiResult<MediaAssetResponse>> =>
    call(
      `/media/attachments/${encodeURIComponent(attachmentId)}/framing`,
      'PATCH',
      mediaAssetResponseSchema,
      context,
      body,
    ),

  updateMediaPublication: (
    attachmentId: string,
    body: UpdateMediaPublicationRequest,
    context: CallerContext,
  ): Promise<ApiResult<MediaAssetResponse>> =>
    call(
      `/media/attachments/${encodeURIComponent(attachmentId)}/publication`,
      'PATCH',
      mediaAssetResponseSchema,
      context,
      body,
    ),

  paymentReport: (
    query: PaymentReportQuery,
    context: CallerContext,
  ): Promise<ApiResult<PaymentReportResponse>> =>
    call(
      `/reports/payments?${reportSearch(query).toString()}`,
      'GET',
      paymentReportResponseSchema,
      context,
    ),

  familyAccountReport: (
    query: FamilyAccountReportQuery,
    context: CallerContext,
  ): Promise<ApiResult<FamilyAccountReportResponse>> =>
    call(
      `/reports/family-accounts?${reportSearch(query).toString()}`,
      'GET',
      familyAccountReportResponseSchema,
      context,
    ),

  sessionReport: (
    query: SessionReportQuery,
    context: CallerContext,
  ): Promise<ApiResult<SessionReportResponse>> =>
    call(
      `/reports/sessions?${reportSearch(query).toString()}`,
      'GET',
      sessionReportResponseSchema,
      context,
    ),

  promiseReport: (
    query: PromiseReportQuery,
    context: CallerContext,
  ): Promise<ApiResult<PromiseReportResponse>> =>
    call(
      `/reports/promises?${reportSearch(query).toString()}`,
      'GET',
      promiseReportResponseSchema,
      context,
    ),

  therapistActivityReport: (
    query: TherapistActivityQuery,
    context: CallerContext,
  ): Promise<ApiResult<TherapistActivityResponse>> =>
    call(
      `/reports/therapist-activity?${reportSearch(query).toString()}`,
      'GET',
      therapistActivityResponseSchema,
      context,
    ),

  settlementStatement: (
    query: SettlementStatementQuery,
    context: CallerContext,
  ): Promise<ApiResult<SettlementStatementResponse>> =>
    call(
      `/settlement/statement?${reportSearch(query).toString()}`,
      'GET',
      settlementStatementResponseSchema,
      context,
    ),

  listSettlementPeriods: (
    query: SettlementPeriodListQuery,
    context: CallerContext,
  ): Promise<ApiResult<SettlementPeriodListResponse>> =>
    call(
      `/settlement/periods?${reportSearch(query).toString()}`,
      'GET',
      settlementPeriodListResponseSchema,
      context,
    ),

  settlementPeriodDetail: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<SettlementPeriodDetailResponse>> =>
    call(
      `/settlement/periods/${encodeURIComponent(id)}/lines`,
      'GET',
      settlementPeriodDetailResponseSchema,
      context,
    ),

  closeSettlementPeriod: (
    body: CloseSettlementPeriodRequest,
    context: CallerContext,
  ): Promise<ApiResult<CloseSettlementPeriodResponse>> =>
    call('/settlement/periods', 'POST', closeSettlementPeriodResponseSchema, context, body),

  listShareRules: (
    query: ShareRuleListQuery,
    context: CallerContext,
  ): Promise<ApiResult<ShareRuleListResponse>> =>
    call(
      `/settlement/share-rules?${reportSearch(query).toString()}`,
      'GET',
      shareRuleListResponseSchema,
      context,
    ),

  createShareRule: (
    body: CreateShareRuleRequest,
    context: CallerContext,
  ): Promise<ApiResult<ShareRuleResponse>> =>
    call('/settlement/share-rules', 'POST', shareRuleResponseSchema, context, body),

  voidShareRule: (
    id: string,
    body: VoidShareRuleRequest,
    context: CallerContext,
  ): Promise<ApiResult<ShareRuleResponse>> =>
    call(
      `/settlement/share-rules/${encodeURIComponent(id)}/void`,
      'POST',
      shareRuleResponseSchema,
      context,
      body,
    ),

  rateSession: (
    chargeId: string,
    body: RateSessionRequest,
    context: CallerContext,
  ): Promise<ApiResult<SessionSettlementResponse>> =>
    call(
      `/settlement/session-charges/${encodeURIComponent(chargeId)}/rating`,
      'POST',
      sessionSettlementResponseSchema,
      context,
      body,
    ),

  readSessionRating: (
    chargeId: string,
    context: CallerContext,
  ): Promise<ApiResult<SessionSettlementResponse>> =>
    call(
      `/settlement/session-charges/${encodeURIComponent(chargeId)}/rating`,
      'GET',
      sessionSettlementResponseSchema,
      context,
    ),

  dashboard: (
    query: DashboardQuery,
    context: CallerContext,
  ): Promise<ApiResult<DashboardResponse>> => {
    const search = new URLSearchParams();
    if (query.date !== undefined) search.set('date', query.date);
    const suffix = search.size === 0 ? '' : `?${search.toString()}`;

    return call(`/dashboard${suffix}`, 'GET', dashboardResponseSchema, context);
  },

  websiteRequestInbox: (
    query: WebsiteRequestInboxQuery,
    context: CallerContext,
  ): Promise<ApiResult<WebsiteRequestInboxResponse>> => {
    const search = new URLSearchParams();
    for (const status of query.statuses ?? []) search.append('statuses', status);
    if (query.page !== undefined) search.set('page', String(query.page));
    if (query.pageSize !== undefined) search.set('pageSize', String(query.pageSize));
    const suffix = search.size === 0 ? '' : `?${search.toString()}`;

    return call(`/website-requests${suffix}`, 'GET', websiteRequestInboxResponseSchema, context);
  },

  getWebsiteRequest: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<WebsiteRequestDetail>> =>
    call(`/website-requests/${encodeURIComponent(id)}`, 'GET', websiteRequestDetailSchema, context),

  changeWebsiteRequestStatus: (
    id: string,
    body: ChangeWebsiteRequestStatusRequest,
    context: CallerContext,
  ): Promise<ApiResult<WebsiteRequestDetail>> =>
    call(
      `/website-requests/${encodeURIComponent(id)}/status`,
      'PATCH',
      websiteRequestDetailSchema,
      context,
      body,
    ),

  linkWebsiteRequest: (
    id: string,
    body: LinkWebsiteRequestRequest,
    context: CallerContext,
  ): Promise<ApiResult<WebsiteRequestDetail>> =>
    call(
      `/website-requests/${encodeURIComponent(id)}/link`,
      'POST',
      websiteRequestDetailSchema,
      context,
      body,
    ),

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

  // --- internal editorial workspace ---------------------------------------
  //
  // Draft and authority-changing calls stay as distinct named methods. The
  // browser cannot smuggle `isPublic` or `approved` through a draft write, and
  // there is no generic content proxy that could reach a route not listed here.

  listArticles: (context: CallerContext): Promise<ApiResult<ArticleListResponse>> =>
    call('/content/articles', 'GET', articleListResponseSchema, context),

  getArticle: (id: string, context: CallerContext): Promise<ApiResult<ArticleResponse>> =>
    call(`/content/articles/${encodeURIComponent(id)}`, 'GET', articleResponseSchema, context),

  createArticle: (
    body: CreateArticleRequest,
    context: CallerContext,
  ): Promise<ApiResult<ArticleResponse>> =>
    call('/content/articles', 'POST', articleResponseSchema, context, body),

  updateArticle: (
    id: string,
    body: UpdateArticleRequest,
    context: CallerContext,
  ): Promise<ApiResult<ArticleResponse>> =>
    call(
      `/content/articles/${encodeURIComponent(id)}`,
      'PATCH',
      articleResponseSchema,
      context,
      body,
    ),

  listServicePublicCopies: (
    context: CallerContext,
  ): Promise<ApiResult<ServicePublicCopyListResponse>> =>
    call('/content/service-copy', 'GET', servicePublicCopyListResponseSchema, context),

  getServicePublicCopy: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<ServicePublicCopyResponse>> =>
    call(
      `/content/service-copy/${encodeURIComponent(id)}`,
      'GET',
      servicePublicCopyResponseSchema,
      context,
    ),

  updateServicePublicCopy: (
    id: string,
    body: UpdateServicePublicCopyRequest,
    context: CallerContext,
  ): Promise<ApiResult<ServicePublicCopyResponse>> =>
    call(
      `/content/service-copy/${encodeURIComponent(id)}`,
      'PATCH',
      servicePublicCopyResponseSchema,
      context,
      body,
    ),

  updateServicePublicCopyPublication: (
    id: string,
    body: UpdateServicePublicCopyPublicationRequest,
    context: CallerContext,
  ): Promise<ApiResult<ServicePublicCopyResponse>> =>
    call(
      `/content/service-copy/${encodeURIComponent(id)}/publication`,
      'PATCH',
      servicePublicCopyResponseSchema,
      context,
      body,
    ),

  listTherapistProfileCopies: (
    context: CallerContext,
  ): Promise<ApiResult<TherapistProfileCopyListResponse>> =>
    call('/content/therapist-profiles', 'GET', therapistProfileCopyListResponseSchema, context),

  getTherapistProfileCopy: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<TherapistProfileCopyResponse>> =>
    call(
      `/content/therapist-profiles/${encodeURIComponent(id)}`,
      'GET',
      therapistProfileCopyResponseSchema,
      context,
    ),

  updateTherapistProfileCopy: (
    id: string,
    body: UpdateTherapistProfileCopyRequest,
    context: CallerContext,
  ): Promise<ApiResult<TherapistProfileCopyResponse>> =>
    call(
      `/content/therapist-profiles/${encodeURIComponent(id)}`,
      'PATCH',
      therapistProfileCopyResponseSchema,
      context,
      body,
    ),

  getTherapistPublicProfile: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<TherapistPublicProfileResponse>> =>
    call(
      `/catalog/therapists/${encodeURIComponent(id)}/public-profile`,
      'GET',
      therapistPublicProfileResponseSchema,
      context,
    ),

  updateTherapistPublicProfile: (
    id: string,
    body: UpdateTherapistPublicProfileRequest,
    context: CallerContext,
  ): Promise<ApiResult<TherapistPublicProfileResponse>> =>
    call(
      `/catalog/therapists/${encodeURIComponent(id)}/public-profile`,
      'PATCH',
      therapistPublicProfileResponseSchema,
      context,
      body,
    ),

  updateTherapistPublicVisibility: (
    id: string,
    body: UpdateTherapistPublicVisibilityRequest,
    context: CallerContext,
  ): Promise<ApiResult<TherapistPublicProfileResponse>> =>
    call(
      `/catalog/therapists/${encodeURIComponent(id)}/public-profile/visibility`,
      'PATCH',
      therapistPublicProfileResponseSchema,
      context,
      body,
    ),

  getClinicProfile: (context: CallerContext): Promise<ApiResult<PublicClinicProfileResponse>> =>
    call('/content/clinic-profile', 'GET', publicClinicProfileResponseSchema, context),

  updateClinicProfile: (
    body: UpdateClinicProfileRequest,
    context: CallerContext,
  ): Promise<ApiResult<PublicClinicProfileResponse>> =>
    call('/content/clinic-profile', 'PUT', publicClinicProfileResponseSchema, context, body),

  listClinicContentEntries: (context: CallerContext): Promise<ApiResult<ClinicContentResponse>> =>
    call('/content/clinic-profile/entries', 'GET', clinicContentResponseSchema, context),

  updateClinicContentEntry: (
    id: string,
    body: UpdateClinicContentEntryRequest,
    context: CallerContext,
  ): Promise<ApiResult<ClinicContentEntryResponse>> =>
    call(
      `/content/clinic-profile/entries/${encodeURIComponent(id)}`,
      'PUT',
      clinicContentEntryResponseSchema,
      context,
      body,
    ),

  updateArticlePublication: (
    id: string,
    body: UpdateArticlePublicationRequest,
    context: CallerContext,
  ): Promise<ApiResult<ArticleResponse>> =>
    call(
      `/content/articles/${encodeURIComponent(id)}/publication`,
      'PATCH',
      articleResponseSchema,
      context,
      body,
    ),

  listTestimonials: (context: CallerContext): Promise<ApiResult<TestimonialListResponse>> =>
    call('/content/testimonials', 'GET', testimonialListResponseSchema, context),

  getTestimonial: (id: string, context: CallerContext): Promise<ApiResult<TestimonialResponse>> =>
    call(
      `/content/testimonials/${encodeURIComponent(id)}`,
      'GET',
      testimonialResponseSchema,
      context,
    ),

  createTestimonial: (
    body: CreateTestimonialRequest,
    context: CallerContext,
  ): Promise<ApiResult<TestimonialResponse>> =>
    call('/content/testimonials', 'POST', testimonialResponseSchema, context, body),

  updateTestimonial: (
    id: string,
    body: UpdateTestimonialRequest,
    context: CallerContext,
  ): Promise<ApiResult<TestimonialResponse>> =>
    call(
      `/content/testimonials/${encodeURIComponent(id)}`,
      'PATCH',
      testimonialResponseSchema,
      context,
      body,
    ),

  updateTestimonialApproval: (
    id: string,
    body: UpdateTestimonialApprovalRequest,
    context: CallerContext,
  ): Promise<ApiResult<TestimonialResponse>> =>
    call(
      `/content/testimonials/${encodeURIComponent(id)}/approval`,
      'PATCH',
      testimonialResponseSchema,
      context,
      body,
    ),

  updateTestimonialPublication: (
    id: string,
    body: UpdateTestimonialPublicationRequest,
    context: CallerContext,
  ): Promise<ApiResult<TestimonialResponse>> =>
    call(
      `/content/testimonials/${encodeURIComponent(id)}/publication`,
      'PATCH',
      testimonialResponseSchema,
      context,
      body,
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

  // --- therapist availability ----------------------------------------------

  listAvailabilityWindows: (
    therapistId: string,
    context: CallerContext,
  ): Promise<ApiResult<AvailabilityWindowListResponse>> =>
    call(
      `/availability/therapists/${encodeURIComponent(therapistId)}/windows`,
      'GET',
      availabilityWindowListResponseSchema,
      context,
    ),

  replaceAvailabilityWindows: (
    therapistId: string,
    body: ReplaceAvailabilityWindowsRequest,
    context: CallerContext,
  ): Promise<ApiResult<AvailabilityWindowListResponse>> =>
    call(
      `/availability/therapists/${encodeURIComponent(therapistId)}/windows`,
      'PUT',
      availabilityWindowListResponseSchema,
      context,
      body,
    ),

  listAvailabilityExceptions: (
    therapistId: string,
    query: AvailabilityExceptionListQuery,
    context: CallerContext,
  ): Promise<ApiResult<AvailabilityExceptionListResponse>> => {
    const search = new URLSearchParams();
    if (query.from !== undefined) search.set('from', query.from);
    if (query.to !== undefined) search.set('to', query.to);
    const suffix = search.size === 0 ? '' : `?${search.toString()}`;

    return call(
      `/availability/therapists/${encodeURIComponent(therapistId)}/exceptions${suffix}`,
      'GET',
      availabilityExceptionListResponseSchema,
      context,
    );
  },

  addAvailabilityException: (
    therapistId: string,
    body: CreateAvailabilityExceptionRequest,
    context: CallerContext,
  ): Promise<ApiResult<AvailabilityExceptionResponse>> =>
    call(
      `/availability/therapists/${encodeURIComponent(therapistId)}/exceptions`,
      'POST',
      availabilityExceptionResponseSchema,
      context,
      body,
    ),

  removeAvailabilityException: (
    therapistId: string,
    exceptionId: string,
    context: CallerContext,
  ): Promise<ApiResult<void>> =>
    call(
      `/availability/therapists/${encodeURIComponent(therapistId)}/exceptions/${encodeURIComponent(exceptionId)}`,
      'DELETE',
      { parse: () => undefined },
      context,
    ),

  resolveAvailability: (
    query: ResolveAvailabilityQuery,
    context: CallerContext,
  ): Promise<ApiResult<ResolveAvailabilityResponse>> => {
    const search = new URLSearchParams({ therapistId: query.therapistId, date: query.date });

    return call(
      `/availability/resolution?${search.toString()}`,
      'GET',
      resolveAvailabilityResponseSchema,
      context,
    );
  },

  // --- appointment day and lifecycle ---------------------------------------

  appointmentDay: (
    query: AppointmentDayQuery,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentDayResponse>> => {
    const search = new URLSearchParams({ date: query.date });
    if (query.therapistId !== undefined) search.set('therapistId', query.therapistId);
    if (query.roomId !== undefined) search.set('roomId', query.roomId);

    return call(
      `/appointment-day?${search.toString()}`,
      'GET',
      appointmentDayResponseSchema,
      context,
    );
  },

  appointmentView: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentViewResponse>> =>
    call(
      `/appointments/${encodeURIComponent(id)}/view`,
      'GET',
      appointmentViewResponseSchema,
      context,
    ),

  createAppointment: (
    body: CreateAppointmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentResponse>> =>
    call('/appointments', 'POST', appointmentResponseSchema, context, body),

  previewAppointmentSeries: (
    body: CreateAppointmentSeriesRequest,
    context: CallerContext,
  ): Promise<ApiResult<RecurrencePreviewResponse>> =>
    call('/appointment-series/preview', 'POST', recurrencePreviewResponseSchema, context, body),

  createAppointmentSeries: (
    body: CreateAppointmentSeriesRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentSeriesResponse>> =>
    call('/appointment-series', 'POST', appointmentSeriesResponseSchema, context, body),

  appointmentSeries: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentSeriesResponse>> =>
    call(
      `/appointment-series/${encodeURIComponent(id)}`,
      'GET',
      appointmentSeriesResponseSchema,
      context,
    ),

  cancelAppointmentSeriesFrom: (
    id: string,
    body: CancelAppointmentSeriesFromRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentSeriesOperationResponse>> =>
    call(
      `/appointment-series/${encodeURIComponent(id)}/cancel-from`,
      'POST',
      appointmentSeriesOperationResponseSchema,
      context,
      body,
    ),

  updateAppointmentSeriesFrom: (
    id: string,
    body: UpdateAppointmentSeriesFromRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentSeriesOperationResponse>> =>
    call(
      `/appointment-series/${encodeURIComponent(id)}/update-from`,
      'PATCH',
      appointmentSeriesOperationResponseSchema,
      context,
      body,
    ),

  moveAppointment: (
    id: string,
    body: MoveAppointmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentResponse>> =>
    call(
      `/appointments/${encodeURIComponent(id)}`,
      'PATCH',
      appointmentResponseSchema,
      context,
      body,
    ),

  cancelAppointment: (
    id: string,
    body: CancelAppointmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentResponse>> =>
    call(
      `/appointments/${encodeURIComponent(id)}/cancel`,
      'POST',
      appointmentResponseSchema,
      context,
      body,
    ),

  completeAppointment: (
    id: string,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentResponse>> =>
    call(
      `/appointments/${encodeURIComponent(id)}/complete`,
      'POST',
      appointmentResponseSchema,
      context,
      {},
    ),

  reopenAppointment: (
    id: string,
    body: ReopenAppointmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentResponse>> =>
    call(
      `/appointments/${encodeURIComponent(id)}/reopen`,
      'POST',
      appointmentResponseSchema,
      context,
      body,
    ),

  recordAppointmentAttendance: (
    appointmentId: string,
    participantId: string,
    body: RecordAttendanceRequest,
    context: CallerContext,
  ): Promise<ApiResult<AppointmentResponse>> =>
    call(
      `/appointments/${encodeURIComponent(appointmentId)}/participants/${encodeURIComponent(participantId)}/attendance`,
      'PUT',
      appointmentResponseSchema,
      context,
      body,
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

  // --- ledger ---------------------------------------------------------------
  //
  // The Web tier names only the frozen Milestone 5 operations. In particular,
  // there is no arbitrary ledger path or body escape hatch and no amount can be
  // supplied while posting a session charge. Browser-facing route names do not
  // determine the Nest paths isolated in `sessionChargeApiPath` above.

  getFamilyAccount: (
    familyId: string,
    query: FamilyAccountQuery,
    context: CallerContext,
  ): Promise<ApiResult<FamilyAccountResponse>> => {
    const search = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
      includeVoided: String(query.includeVoided),
    });
    if (query.childId !== undefined) search.set('childId', query.childId);
    if (query.from !== undefined) search.set('from', query.from);
    if (query.to !== undefined) search.set('to', query.to);

    return call(
      `${sessionChargeApiPath.familyAccount(familyId)}?${search.toString()}`,
      'GET',
      familyAccountResponseSchema,
      context,
    );
  },

  // --- payments and promises ------------------------------------------------
  //
  // These methods name only the frozen A2 wire operations, all of which are now
  // live in NestJS. Web parses every success strictly and exposes no generic
  // money endpoint.

  createPayment: (
    familyId: string,
    body: CreatePaymentRequest,
    context: CallerContext,
  ): Promise<ApiResult<PaymentResponse>> =>
    call(familyMoneyApiPath.payments(familyId), 'POST', paymentResponseSchema, context, body),

  listPayments: (
    familyId: string,
    query: PaymentListQuery,
    context: CallerContext,
  ): Promise<ApiResult<PaymentListResponse>> => {
    const search = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
      includeVoided: String(query.includeVoided),
    });
    if (query.from !== undefined) search.set('from', query.from);
    if (query.to !== undefined) search.set('to', query.to);

    return call(
      `${familyMoneyApiPath.payments(familyId)}?${search.toString()}`,
      'GET',
      paymentListResponseSchema,
      context,
    );
  },

  voidPayment: (
    paymentId: string,
    body: VoidPaymentRequest,
    context: CallerContext,
  ): Promise<ApiResult<PaymentResponse>> =>
    call(familyMoneyApiPath.voidPayment(paymentId), 'POST', paymentResponseSchema, context, body),

  createPromise: (
    familyId: string,
    body: CreatePromiseRequest,
    context: CallerContext,
  ): Promise<ApiResult<PromiseResponse>> =>
    call(familyMoneyApiPath.promises(familyId), 'POST', promiseResponseSchema, context, body),

  listPromises: (
    familyId: string,
    query: PromiseListQuery,
    context: CallerContext,
  ): Promise<ApiResult<PromiseListResponse>> => {
    const search = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    if (query.status !== undefined) search.set('status', query.status);

    return call(
      `${familyMoneyApiPath.promises(familyId)}?${search.toString()}`,
      'GET',
      promiseListResponseSchema,
      context,
    );
  },

  fulfillPromise: (
    promiseId: string,
    body: FulfillPromiseRequest,
    context: CallerContext,
  ): Promise<ApiResult<PromiseResponse>> =>
    call(
      familyMoneyApiPath.fulfillPromise(promiseId),
      'POST',
      promiseResponseSchema,
      context,
      body,
    ),

  reschedulePromise: (
    promiseId: string,
    body: ReschedulePromiseRequest,
    context: CallerContext,
  ): Promise<ApiResult<RescheduledPromiseResponse>> =>
    call(
      familyMoneyApiPath.reschedulePromise(promiseId),
      'POST',
      rescheduledPromiseResponseSchema,
      context,
      body,
    ),

  cancelPromise: (
    promiseId: string,
    body: CancelPromiseRequest,
    context: CallerContext,
  ): Promise<ApiResult<PromiseResponse>> =>
    call(familyMoneyApiPath.cancelPromise(promiseId), 'POST', promiseResponseSchema, context, body),

  postSessionCharge: (
    participantId: string,
    context: CallerContext,
  ): Promise<ApiResult<PostSessionChargeResponse>> =>
    call(
      sessionChargeApiPath.postForParticipant(participantId),
      'POST',
      postSessionChargeResponseSchema,
      context,
      {},
    ),

  /**
   * The seat's current charge, unwrapped for the callers that only want it.
   *
   * NestJS answers this read with the frozen `sessionChargeResponse` — the same
   * `{ charge }` envelope every ledger write returns — so it is parsed as that
   * and the charge is handed on. Parsing the bare detail against the envelope
   * would fail on every seat that has a charge at all, which is precisely the
   * seat this read exists for.
   */
  getParticipantSessionCharge: async (
    participantId: string,
    context: CallerContext,
  ): Promise<ApiResult<SessionChargeDetail>> => {
    const result = await call(
      sessionChargeApiPath.participantChargeState(participantId),
      'GET',
      sessionChargeResponseSchema,
      context,
    );

    return result.ok ? { ...result, data: result.data.charge } : result;
  },

  voidSessionCharge: (
    chargeId: string,
    body: VoidSessionChargeRequest,
    context: CallerContext,
  ): Promise<ApiResult<SessionChargeResponse>> =>
    call(sessionChargeApiPath.void(chargeId), 'POST', sessionChargeResponseSchema, context, body),

  createChargeAdjustment: (
    chargeId: string,
    body: CreateChargeAdjustmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<SessionChargeResponse>> =>
    call(
      sessionChargeApiPath.createAdjustment(chargeId),
      'POST',
      sessionChargeResponseSchema,
      context,
      body,
    ),

  voidChargeAdjustment: (
    chargeId: string,
    adjustmentId: string,
    body: VoidChargeAdjustmentRequest,
    context: CallerContext,
  ): Promise<ApiResult<SessionChargeResponse>> =>
    call(
      sessionChargeApiPath.voidAdjustment(chargeId, adjustmentId),
      'POST',
      sessionChargeResponseSchema,
      context,
      body,
    ),

  // --- families and children --------------------------------------------------

  /**
   * A POST that reads. Mirrors `FamiliesController.search`: the term is
   * personal data and must never travel as a query string.
   */
  searchFamilies: (
    body: FamilySearchRequest,
    context: CallerContext,
  ): Promise<ApiResult<FamilyListResponse>> =>
    call('/families/search', 'POST', familyListResponseSchema, context, body),

  getFamily: (id: string, context: CallerContext): Promise<ApiResult<FamilyDetailResponse>> =>
    call(`/families/${encodeURIComponent(id)}`, 'GET', familyDetailResponseSchema, context),

  createFamily: (
    body: CreateFamilyRequest,
    context: CallerContext,
  ): Promise<ApiResult<FamilyWriteResponse>> =>
    call('/families', 'POST', familyWriteResponseSchema, context, body),

  updateFamily: (
    id: string,
    body: UpdateFamilyRequest,
    context: CallerContext,
  ): Promise<ApiResult<FamilyWriteResponse>> =>
    call(`/families/${encodeURIComponent(id)}`, 'PATCH', familyWriteResponseSchema, context, body),

  changeFamilyStatus: (
    id: string,
    status: RecordStatus,
    context: CallerContext,
  ): Promise<ApiResult<FamilyDetailResponse>> =>
    call(
      `/families/${encodeURIComponent(id)}/status`,
      'PATCH',
      familyDetailResponseSchema,
      context,
      {
        status,
      },
    ),

  confirmFamilyRegistration: (
    body: ConfirmDraftRequest,
    context: CallerContext,
  ): Promise<ApiResult<FamilyWriteResponse>> =>
    call('/families/confirm-registration', 'POST', familyWriteResponseSchema, context, body),

  confirmFamilyUpdate: (
    body: ConfirmDraftRequest,
    context: CallerContext,
  ): Promise<ApiResult<FamilyWriteResponse>> =>
    call('/families/confirm-update', 'POST', familyWriteResponseSchema, context, body),

  getChild: (id: string, context: CallerContext): Promise<ApiResult<ChildDetailResponse>> =>
    call(`/children/${encodeURIComponent(id)}`, 'GET', childDetailResponseSchema, context),

  createChild: (
    familyId: string,
    body: CreateChildRequest,
    context: CallerContext,
  ): Promise<ApiResult<ChildWriteResponse>> =>
    call(
      `/families/${encodeURIComponent(familyId)}/children`,
      'POST',
      childWriteResponseSchema,
      context,
      body,
    ),

  updateChild: (
    id: string,
    body: UpdateChildRequest,
    context: CallerContext,
  ): Promise<ApiResult<ChildWriteResponse>> =>
    call(`/children/${encodeURIComponent(id)}`, 'PATCH', childWriteResponseSchema, context, body),

  changeChildStatus: (
    id: string,
    status: RecordStatus,
    context: CallerContext,
  ): Promise<ApiResult<ChildDetailResponse>> =>
    call(
      `/children/${encodeURIComponent(id)}/status`,
      'PATCH',
      childDetailResponseSchema,
      context,
      {
        status,
      },
    ),

  confirmChildRegistration: (
    body: ConfirmDraftRequest,
    context: CallerContext,
  ): Promise<ApiResult<ChildWriteResponse>> =>
    call('/children/confirm-registration', 'POST', childWriteResponseSchema, context, body),

  confirmChildUpdate: (
    body: ConfirmDraftRequest,
    context: CallerContext,
  ): Promise<ApiResult<ChildWriteResponse>> =>
    call('/children/confirm-update', 'POST', childWriteResponseSchema, context, body),

  currentDraft: (context: CallerContext): Promise<ApiResult<RegistrationDraftResponse>> =>
    call('/registration-drafts/current', 'GET', registrationDraftResponseSchema, context),

  discardDraft: (context: CallerContext): Promise<ApiResult<void>> =>
    call('/registration-drafts/discard', 'POST', { parse: () => undefined }, context),
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
