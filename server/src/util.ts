/**
 * 行内偏移一律按 Unicode 码位（code point）计算，区间为半开 [start, end)。
 */

export function codePointLength(text: string): number {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of text) n++;
  return n;
}

export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('');
}

export function rangeOverlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
