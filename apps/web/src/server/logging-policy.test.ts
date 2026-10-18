import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}

describe('Web server logging boundary', () => {
  it('has no ad hoc console output and never reads the uploaded file name', () => {
    const server = sources(join(__dirname, '..', 'server')).join('\n');
    const handlers = sources(join(__dirname, '..', 'app', 'api')).join('\n');
    expect(server + handlers).not.toMatch(/console\.(?:log|info|warn|error|debug)\s*\(/);
    const upload = readFileSync(
      join(__dirname, '..', 'app', 'api', 'media', 'upload', 'route.ts'),
      'utf8',
    );
    expect(upload).not.toMatch(/file\.name|filename/i);
  });
});
