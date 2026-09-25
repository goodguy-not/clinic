import { Logger } from '@nestjs/common';
import { logSecurityRejection } from './security-log';

describe('logSecurityRejection', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records exactly the event, the reason and the request id', () => {
    logSecurityRejection({
      event: 'auth.login.rejected',
      reason: 'UNKNOWN_USERNAME',
      requestId: '3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    });

    expect(lines).toEqual([
      'event=auth.login.rejected reason=UNKNOWN_USERNAME requestId=3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    ]);
  });

  it('has no field through which a username or an address could reach the log', () => {
    // Milestone 10, checkpoint A3. A caller handing over more than the type
    // allows is ignored rather than written: the line is built from three
    // named fields, never from the object it was given.
    logSecurityRejection({
      event: 'website.request.throttled',
      reason: 'SUBMISSION_RATE_EXCEEDED',
      requestId: 'r',
      ...({ clientIp: '192.0.2.10', usernameAttempted: 'someone' } as object),
    });

    const line = lines.join('\n');
    expect(line).not.toContain('192.0.2.10');
    expect(line).not.toContain('someone');
  });
});
