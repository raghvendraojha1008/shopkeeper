export type FilterPeriod = 'current_month' | 'current_year' | 'current_business_year' | 'all';

export function computeDateRangeFromPeriod(
  period: FilterPeriod | undefined,
  financialYearStart?: string
): { start: string; end: string } {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  if (!period || period === 'all') {
    return { start: '', end: '' };
  }

  if (period === 'current_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    return { start, end: todayStr };
  }

  if (period === 'current_year') {
    const start = `${today.getFullYear()}-01-01`;
    return { start, end: todayStr };
  }

  if (period === 'current_business_year') {
    // Parse financial year start month (e.g. "April" => 4, default to 4 for India)
    let fyMonth = 4; // April = month 4 (1-indexed)
    if (financialYearStart) {
      const monthMap: Record<string, number> = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
      };
      const parsed = monthMap[financialYearStart.toLowerCase().trim()];
      if (parsed) fyMonth = parsed;
    }

    const currentMonth = today.getMonth() + 1; // 1-indexed
    const currentYear = today.getFullYear();

    let fyYear: number;
    if (currentMonth >= fyMonth) {
      fyYear = currentYear;
    } else {
      fyYear = currentYear - 1;
    }

    const startMonth = String(fyMonth).padStart(2, '0');
    const start = `${fyYear}-${startMonth}-01`;
    return { start, end: todayStr };
  }

  return { start: '', end: '' };
}

export function getDefaultDateRange(settings: any): { start: string; end: string } {
  const period: FilterPeriod = settings?.automation?.default_filter_period || 'all';
  const financialYearStart = settings?.profile?.financial_year_start;
  return computeDateRangeFromPeriod(period, financialYearStart);
}
