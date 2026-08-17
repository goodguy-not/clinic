import Link from 'next/link';
import { FOCUS_RING } from './styles';

export type FamilyMoneySection = 'account' | 'payments' | 'promises';

const ITEMS: ReadonlyArray<{ section: FamilyMoneySection; segment: string; label: string }> = [
  { section: 'account', segment: 'account', label: 'هزینه‌ها و حساب' },
  { section: 'payments', segment: 'payments', label: 'پرداخت‌ها' },
  { section: 'promises', segment: 'promises', label: 'قول‌های پرداخت' },
];

export function FamilyMoneyNavigation({
  familyId,
  active,
}: {
  familyId: string;
  active: FamilyMoneySection;
}) {
  return (
    <nav aria-label="بخش‌های مالی خانواده" className="overflow-x-auto pb-1">
      <ul className="flex min-w-max list-none gap-2 p-0">
        {ITEMS.map((item) => {
          const isActive = item.section === active;
          return (
            <li key={item.section}>
              <Link
                href={`/families/${encodeURIComponent(familyId)}/${item.segment}`}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${FOCUS_RING} ${
                  isActive
                    ? 'border-brand-700 bg-brand-50 text-brand-950 shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:text-brand-900'
                }`}
              >
                <span aria-hidden="true">{isActive ? '●' : '○'}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
