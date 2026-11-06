/** "2 minutes ago" / "yesterday" in the user's language. */
export function ago(t: number): string {
  const s = Math.round((t - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month']]
  let div = 1
  for (const [limit, unit] of steps) {
    if (Math.abs(s) < limit) return rtf.format(Math.round(s / div), unit)
    div = limit
  }
  return rtf.format(Math.round(s / 31557600), 'year')
}
