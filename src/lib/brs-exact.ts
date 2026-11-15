// Fractions represent hundredths of a rating point. BigInt never crosses the DTO boundary.
export type Fraction = { n: bigint; d: bigint };
export type ExactScore = { numerator: string; denominator: string };
function gcd(a: bigint, b: bigint): bigint { while (b) { const rest = a % b; a = b; b = rest; } return a < BigInt(0) ? -a : a; }
export function fraction(n: bigint | number, d: bigint | number = 1): Fraction {
  const numerator = BigInt(n), denominator = BigInt(d);
  if (denominator <= BigInt(0)) throw new Error("Максимум первичных баллов должен быть положительным.");
  const common = gcd(numerator, denominator);
  return { n: numerator / common, d: denominator / common };
}
export function add(a: Fraction, b: Fraction) { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
export function subtract(a: Fraction, b: Fraction) { return fraction(a.n * b.d - b.n * a.d, a.d * b.d); }
export function compare(a: Fraction, b: Fraction) { const delta = a.n * b.d - b.n * a.d; return delta < BigInt(0) ? -1 : delta > BigInt(0) ? 1 : 0; }
export function roundedHundredths(a: Fraction) { return Number((a.n * BigInt(2) + a.d) / (a.d * BigInt(2))); }
export function integerRating(a: Fraction) { return Number((a.n + a.d * BigInt(100) - BigInt(1)) / (a.d * BigInt(100))); }
export function exactDto(a: Fraction): ExactScore { return { numerator: String(a.n), denominator: String(a.d) }; }
export function converted(primary: number, primaryMax: number, ratingMax: number) { return fraction(BigInt(primary) * BigInt(ratingMax), primaryMax); }
export function ratingValue(result: { score: number | null; primaryScore?: number | null; primaryMax?: number | null; exactNumerator?: string | null; exactDenominator?: string | null }, max: number) {
  if (result.score === null) return fraction(0);
  if (result.exactNumerator != null && result.exactDenominator != null) return fraction(BigInt(result.exactNumerator), BigInt(result.exactDenominator));
  return result.primaryScore != null && result.primaryMax != null ? converted(result.primaryScore, result.primaryMax, max) : fraction(result.score ?? 0);
}
