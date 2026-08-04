/**
 * The CLI's only output channel.
 *
 * Generated passwords are written straight to the process's stdout, never
 * through the NestJS `Logger`. A logger is a shipping pipeline: in production
 * its output is collected, forwarded and retained, and a credential that
 * reaches it has effectively been persisted somewhere nobody is auditing. The
 * Nest application context is created with logging disabled entirely, so the
 * only bytes on stdout are the ones written here.
 */
export type CliIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  readStdin: () => Promise<string>;
};

export const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks).toString('utf8');
  },
};
