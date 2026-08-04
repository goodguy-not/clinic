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

  it('records the reason, request id and address', () => {
    logSecurityRejection({
      event: 'auth.login.rejected',
      reason: 'UNKNOWN_USERNAME',
      requestId: '3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
      clientIp: '192.0.2.10',
      usernameAttempted: 'someone',
    });

    const line = lines.join('\n');
    expect(line).toContain('reason=UNKNOWN_USERNAME');
    expect(line).toContain('requestId=3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f');
    expect(line).toContain('ip=192.0.2.10');
  });

  it('truncates an attacker-supplied username', () => {
    logSecurityRejection({
      event: 'auth.login.rejected',
      reason: 'UNKNOWN_USERNAME',
      requestId: 'r',
      usernameAttempted: 'u'.repeat(5000),
    });

    // The field is attacker-controlled; without a bound it is a way to write
    // arbitrary volume into the operational log.
    expect(lines.join('').length).toBeLessThan(300);
  });

  it('redacts a credential typed into the username box', () => {
    logSecurityRejection({
      event: 'auth.login.rejected',
      reason: 'UNKNOWN_USERNAME',
      requestId: 'r',
      usernameAttempted: 'password=hunter2',
    });

    expect(lines.join('')).not.toContain('hunter2');
  });

  it('omits absent optional fields rather than logging empty ones', () => {
    logSecurityRejection({
      event: 'auth.session.rejected',
      reason: 'SESSION_INVALID',
      requestId: 'r',
      clientIp: null,
    });

    const line = lines.join('');
    expect(line).not.toContain('ip=');
    expect(line).not.toContain('usernameAttempted=');
  });
});
