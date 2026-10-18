import { Badge, Panel } from './ui';

export type PublicationReadinessItem = {
  label: string;
  ready: boolean;
  detail: string;
  optional?: boolean;
};

/** A single, plain-language manager view of every gate around a public item. */
export function PublicationReadiness({ items }: { items: readonly PublicationReadinessItem[] }) {
  return (
    <Panel title="آمادگی برای نمایش در سایت">
      <p className="text-sm leading-6 text-slate-600">
        این فهرست نشان می‌دهد چه چیزی اکنون روی سایت قابل نمایش است و چه کاری هنوز مانده است.
      </p>
      <ul className="flex flex-col gap-3" aria-label="وضعیت آمادگی انتشار">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div>
              <strong className="text-sm text-slate-900">{item.label}</strong>
              <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>
            </div>
            <Badge tone={item.ready ? 'success' : item.optional ? 'neutral' : 'warning'}>
              {item.ready ? 'آماده' : item.optional ? 'اختیاری؛ تکمیل نشده' : 'هنوز لازم است'}
            </Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
