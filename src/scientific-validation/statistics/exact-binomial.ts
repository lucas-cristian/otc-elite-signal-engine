function logFactorial(value: number): number {
  let sum = 0;
  for (let index = 2; index <= value; index += 1) sum += Math.log(index);
  return sum;
}

function logBinomialPmf(successes: number, total: number, probability: number): number {
  if (successes < 0 || successes > total) return Number.NEGATIVE_INFINITY;
  if (probability === 0) return successes === 0 ? 0 : Number.NEGATIVE_INFINITY;
  if (probability === 1) return successes === total ? 0 : Number.NEGATIVE_INFINITY;
  return logFactorial(total)
    - logFactorial(successes)
    - logFactorial(total - successes)
    + successes * Math.log(probability)
    + (total - successes) * Math.log1p(-probability);
}

function logSumExp(values: number[]): number {
  if (values.length === 0) return Number.NEGATIVE_INFINITY;
  const maximum = Math.max(...values);
  if (!Number.isFinite(maximum)) return maximum;
  let sum = 0;
  for (const value of values) sum += Math.exp(value - maximum);
  return maximum + Math.log(sum);
}

export function exactOneSidedBinomialPValue(successes: number, total: number, nullProbability = 0.5): number | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < 0 || successes > total) {
    throw new Error('Invalid binomial counts');
  }
  if (!(nullProbability > 0 && nullProbability < 1)) throw new Error('nullProbability must be between zero and one');
  if (total === 0) return null;
  const logs: number[] = [];
  for (let value = successes; value <= total; value += 1) logs.push(logBinomialPmf(value, total, nullProbability));
  return Math.min(1, Math.exp(logSumExp(logs)));
}
