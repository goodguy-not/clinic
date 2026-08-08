import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ScheduleAgenda,
  ScheduleAgendaGroup,
  ScheduleCard,
  ScheduleDateNavigation,
  type ScheduleDayOption,
} from './scheduling';

const DAYS: ScheduleDayOption[] = [
  {
    isoDate: '2026-08-08',
    href: '/schedule?date=2026-08-08',
    weekday: 'شنبه',
    day: '۱۷',
    month: 'مرداد',
    accessibleLabel: 'شنبه ۱۷ مرداد ۱۴۰۵',
  },
  {
    isoDate: '2026-08-09',
    href: '/schedule?date=2026-08-09',
    weekday: 'یکشنبه',
    day: '۱۸',
    accessibleLabel: 'یکشنبه ۱۸ مرداد ۱۴۰۵، امروز، انتخاب‌شده',
    selected: true,
    today: true,
  },
];

describe('schedule date navigation', () => {
  const markup = renderToStaticMarkup(
    createElement(ScheduleDateNavigation, {
      label: 'انتخاب روز برنامه',
      periodLabel: '۱۷ تا ۲۳ مرداد ۱۴۰۵',
      previous: { href: '/schedule?date=2026-08-02', label: 'هفتهٔ قبل' },
      next: { href: '/schedule?date=2026-08-16', label: 'هفتهٔ بعد' },
      today: { href: '/schedule?date=2026-08-09', label: 'امروز' },
      todayMarker: 'امروز',
      days: DAYS,
    }),
  );

  it('exposes the rail and icon-only controls by their Persian names', () => {
    expect(markup).toContain('aria-label="انتخاب روز برنامه"');
    expect(markup).toContain('aria-label="هفتهٔ قبل"');
    expect(markup).toContain('aria-label="هفتهٔ بعد"');
  });

  it('marks the selected calendar date without making it a redundant link', () => {
    expect(markup).toContain('aria-current="date"');
    expect(markup.match(/href="\/schedule\?date=2026-08-09"/g)).toHaveLength(1);
    expect(markup).toContain('یکشنبه ۱۸ مرداد ۱۴۰۵، امروز، انتخاب‌شده');
  });

  it('preserves machine-readable dates beside the Persian labels', () => {
    expect(markup).toContain('dateTime="2026-08-08"');
    expect(markup).toContain('dateTime="2026-08-09"');
  });
});

describe('schedule agenda', () => {
  const card = createElement(ScheduleCard, {
    title: 'مورد آزمایشی',
    description: 'توضیح آزمایشی',
    metadata: createElement('span', null, 'فرادادهٔ آزمایشی'),
    href: '/synthetic-item',
    accessibleLabel: 'مشاهدهٔ مورد آزمایشی',
  });
  const markup = renderToStaticMarkup(
    createElement(ScheduleAgenda, {
      id: 'daily-schedule',
      title: 'برنامهٔ روز',
      description: 'دو مورد',
      children: createElement(ScheduleAgendaGroup, {
        time: '09:05',
        timeLabel: '۰۹:۰۵',
        children: card,
      }),
    }),
  );

  it('connects the agenda label and preserves semantic date-time values', () => {
    expect(markup).toContain('aria-labelledby="daily-schedule-title"');
    expect(markup).toContain('id="daily-schedule-title"');
    expect(markup).toContain('dateTime="09:05"');
    expect(markup).toContain('dir="ltr"');
  });

  it('makes an agenda card one clear, labelled navigation target', () => {
    expect(markup).toContain('href="/synthetic-item"');
    expect(markup).toContain('aria-label="مشاهدهٔ مورد آزمایشی"');
    expect(markup).toContain('<article>');
  });

  it('does not attach appointment behaviour to a presentation-only card', () => {
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('/api/');
  });
});
