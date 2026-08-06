import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('masks the password in a PostgreSQL connection string', () => {
    const input = 'connect ECONNREFUSED postgresql://clinic:sup3rs3cret@localhost:5433/clinic_dev';

    const result = redactSecrets(input);

    expect(result).not.toContain('sup3rs3cret');
    expect(result).toContain('postgresql://clinic:***@localhost:5433/clinic_dev');
  });

  it('masks every occurrence in multi-line text such as a stack trace', () => {
    const input = [
      'Error: postgres://a:first_secret@db:5432/x',
      '    at handler (postgresql://b:second_secret@db:5432/y)',
    ].join('\n');

    const result = redactSecrets(input);

    expect(result).not.toContain('first_secret');
    expect(result).not.toContain('second_secret');
  });

  it('leaves text without credentials unchanged', () => {
    const input = 'Error: connection timed out after 3000ms';

    expect(redactSecrets(input)).toBe(input);
  });

  it('masks a startup failure of the shape main.ts logs on the bootstrap path', () => {
    // PrismaService connects during module initialisation, so a bootstrap
    // failure can surface a driver error carrying the connection string.
    const input =
      "Can't reach database server at `localhost:5433`. " +
      'datasource db: postgresql://clinic:clinic_dev_only@localhost:5433/clinic_dev?schema=public';

    const result = redactSecrets(input);

    expect(result).not.toContain('clinic_dev_only');
    expect(result).toContain('postgresql://clinic:***@localhost:5433/clinic_dev');
    // Non-secret diagnostics must survive, or the log becomes useless.
    expect(result).toContain('localhost:5433');
  });
});

describe('registration draft tokens are bearer secrets', () => {
  it('masks a draft token wherever it is assigned', () => {
    // Anyone holding one can read the family details somebody typed and
    // complete their registration. That it lives for ten minutes makes it
    // short-lived, not harmless.
    for (const line of [
      'x-draft-token: Zm9vYmFyYmF6',
      'draftToken="Zm9vYmFyYmF6"',
      'draft_token=Zm9vYmFyYmF6',
    ]) {
      const redacted = redactSecrets(line);

      expect(redacted).not.toContain('Zm9vYmFyYmF6');
      expect(redacted).toContain('***');
    }
  });

  it('leaves surrounding text intact', () => {
    expect(redactSecrets('draft rejected for x-draft-token: abc123 at 12:00')).toBe(
      'draft rejected for x-draft-token: *** at 12:00',
    );
  });
});
