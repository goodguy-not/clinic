import { redirect } from 'next/navigation';
import { requireSession } from '@/server/auth-session';

export default async function ReportsPage() {
  await requireSession({ requirePermission: 'appointment.read' });
  redirect('/reports/sessions');
}
