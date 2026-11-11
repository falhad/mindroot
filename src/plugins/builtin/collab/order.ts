/**
 * Fractional order keys: strings that sort in the order siblings should appear. A new key can always
 * be made between two neighbours without renumbering the others, which is what lets two people insert
 * into the same list at the same time without clashing (the idea behind "fractional indexing").
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function mid(a: string, b: string | null): string {
  if (b !== null) {
    // keep the shared prefix and solve for the rest
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))]
  // the first digits are neighbours
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da] + mid(a.slice(1), null)
}

/** A key strictly between `a` and `b`. `null` means "no limit" on that side. Throws if `a` is not below `b`. */
export function between(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error('between: the lower key must be smaller than the upper key')
  return mid(a ?? '', b)
}
