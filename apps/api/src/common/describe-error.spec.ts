import { Prisma } from '@prisma/client';
import { EnvConfigError } from '../config/env';
import { AppError } from './app-error';
import { describeError, stackFrames } from './describe-error';

/**
 * THE LOGGING RULE, PINNED WHERE IT IS MOST LIKELY TO REGRESS (Milestone 10,
 * checkpoint A3): an unexpected error is logged by its kind, never by its words.
 * Each case below is a real way personal data reaches a log. Every value here
 * is synthetic.
 */
describe('describeError', () => {
  const PERSONAL = ['Sample Parent', '09120000000', 'نام نمونه', 'family-photo.jpg', 'sup3rs3cret'];

  const expectNothingPersonal = (text: string) => {
    for (const value of PERSONAL) expect(text).not.toContain(value);
  };

  it('keeps the SQLSTATE and the constraint name of a raw-query failure, and none of its row', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `23514`. Message: `new row for relation "family" violates check constraint "family_mobile_chk"` DETAIL: Failing row contains (Sample Parent, 09120000000, نام نمونه).',
      {
        code: 'P2010',
        clientVersion: '6.19.3',
        meta: {
          code: '23514',
          message:
            'new row for relation "family" violates check constraint "family_mobile_chk" DETAIL: Failing row contains (Sample Parent, 09120000000).',
        },
      },
    );

    const described = describeError(error);

    expect(described).toBe(
      'PrismaClientKnownRequestError code=P2010 sqlstate=23514 constraint=family_mobile_chk',
    );
    expectNothingPersonal(described);
  });

  it('drops the arguments Prisma renders into a failed call', () => {
    const error = new Error(
      'Invalid `prisma.family.create()` invocation:\n{ data: { guardianName: "Sample Parent", mobile: "09120000000" } }',
    );

    expect(describeError(error)).toBe('Error');
  });

  it('drops the body a JSON parse error quotes, and the path a filesystem error names', () => {
    const parse = new SyntaxError(
      'Unexpected token, "{"name": Sample Parent"... is not valid JSON',
    );
    const fs = Object.assign(
      new Error("ENOENT: no such file, open '/srv/media/family-photo.jpg'"),
      {
        code: 'ENOENT',
      },
    );

    expect(describeError(parse)).toBe('SyntaxError');
    expect(describeError(fs)).toBe('Error code=ENOENT');
  });

  it('drops a connection string, not merely its password', () => {
    expect(
      describeError(
        new Error('connect ECONNREFUSED postgresql://clinic:sup3rs3cret@db:5432/clinic'),
      ),
    ).toBe('Error');
  });

  it('keeps the two messages that are never built from input', () => {
    expect(
      describeError(new AppError('MEDIA_NOT_FOUND', undefined, 'This photograph has been erased')),
    ).toBe('AppError code=MEDIA_NOT_FOUND This photograph has been erased');
    expect(
      describeError(
        new EnvConfigError(
          'Invalid API environment configuration:\n  - MEDIA_STORAGE_DIR: Required',
        ),
      ),
    ).toContain('MEDIA_STORAGE_DIR');
  });

  it('describes a thrown non-error by its type alone', () => {
    expect(describeError('Sample Parent')).toBe('non-error value (string)');
  });

  it('logs stack frames without the message line above them', () => {
    const error = new Error('Failing row contains (Sample Parent, 09120000000)');

    const frames = stackFrames(error) ?? '';

    expect(frames).toMatch(/^\s+at /);
    expectNothingPersonal(frames);
  });
});
