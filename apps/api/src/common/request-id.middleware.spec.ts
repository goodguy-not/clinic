import type { Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';
import { getRequestContext } from './request-context';

function fakeRequest(headers: Record<string, string | string[]> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeResponse(): { response: Response; headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  const response = {
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
  } as unknown as Response;

  return { response, headers };
}

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('accepts a well-formed UUID from the web tier', () => {
    const id = '3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
    const request = fakeRequest({ 'x-request-id': id });
    const { response, headers } = fakeResponse();

    middleware.use(request, response, () => undefined);

    expect(getRequestContext(request).requestId).toBe(id);
    expect(headers['x-request-id']).toBe(id);
  });

  it.each([
    ['missing', {}],
    ['malformed', { 'x-request-id': 'not-a-uuid' }],
    ['empty', { 'x-request-id': '' }],
    ['injected text', { 'x-request-id': 'abc; DROP TABLE audit_log' }],
  ])('generates its own when the supplied value is %s', (_label, headers) => {
    const request = fakeRequest(headers);
    const { response } = fakeResponse();

    middleware.use(request, response, () => undefined);

    // The value is written to a uuid audit column, so anything with structure
    // must be replaced rather than sanitised.
    expect(getRequestContext(request).requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('takes the first value when a header is repeated', () => {
    const id = '3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
    const request = fakeRequest({ 'x-request-id': [id, 'second'] });
    const { response } = fakeResponse();

    middleware.use(request, response, () => undefined);

    expect(getRequestContext(request).requestId).toBe(id);
  });

  it('truncates an oversized user agent', () => {
    const request = fakeRequest({ 'x-client-user-agent': 'u'.repeat(1000) });
    const { response } = fakeResponse();

    middleware.use(request, response, () => undefined);

    // The column is capped at 256 by a CHECK constraint; truncating here means
    // an over-long value cannot fail the whole audit write.
    expect(getRequestContext(request).userAgent).toHaveLength(256);
  });

  it('starts with no session, so identity can only come from a lookup', () => {
    const request = fakeRequest();
    const { response } = fakeResponse();

    middleware.use(request, response, () => undefined);

    expect(getRequestContext(request).session).toBeNull();
  });

  it('calls next exactly once', () => {
    const next = jest.fn();
    middleware.use(fakeRequest(), fakeResponse().response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
