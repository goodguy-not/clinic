import type { NextConfig } from 'next';
import { loadServerEnv } from './src/env';

// The repository-root `.env` is deliberately NOT loaded here. It belongs to the
// API and carries the database connection string; loading it would put that
// string into this process even though nothing here may use it
// (CLAUDE.md, Architecture boundary).
//
// Next.js auto-loads `apps/web/.env.local`, which carries only the variables the
// web application actually needs. See `.env.local.example`.

// Fail fast. This runs when the config is loaded — during `next build`,
// `next dev` and `next start` — so a missing or malformed variable stops the
// build or the server before it can ever serve a request.
loadServerEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
