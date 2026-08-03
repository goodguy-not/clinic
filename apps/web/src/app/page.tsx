import { fetchApiLiveness } from '@/server/api-client';

export const dynamic = 'force-dynamic';

/**
 * Foundation status page.
 *
 * A Server Component calling the server-only NestJS client directly, which is
 * the intended path for reads (CLAUDE.md: "Server Components may call a
 * server-only NestJS client directly"). Carries no marketing or clinical copy —
 * approved Persian content is owner-provided in the public-site milestone.
 */
export default async function Home() {
  const api = await fetchApiLiveness();

  return (
    <main>
      <h1>Clinic Platform</h1>
      <dl>
        <dt>وب</dt>
        <dd>سالم</dd>
        <dt>ای‌پی‌آی</dt>
        <dd>{api.ok ? `سالم (${api.data.service})` : 'در دسترس نیست'}</dd>
      </dl>
    </main>
  );
}
