/** Strip diacritics so typing "michal" finds "Michał" — mirrors the backend's search blob. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const plRules = new Intl.PluralRules('pl');

/**
 * Polish counts three ways — 1 wpis, 2 wpisy, 5 wpisów — and the rule is not "n < 5":
 * 22 takes the second form and 12 the third. `Intl.PluralRules` already knows this, so
 * callers just hand over the three stems.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const form = plRules.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
}

const rtf = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });

export function relativeTime(iso: string | null): string {
  if (!iso) return 'nigdy';

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'nigdy';

  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 60) return 'przed chwilą';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}
