export interface WilsonInterval {
  low: number;
  high: number;
  confidence: 0.95 | 0.99;
}

const Z_BY_CONFIDENCE: Record<WilsonInterval['confidence'], number> = {
  0.95: 1.959963984540054,
  0.99: 2.5758293035489004,
};

export function wilsonInterval(successes: number, total: number, confidence: WilsonInterval['confidence']): WilsonInterval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < 0 || successes > total) {
    throw new Error('Invalid Wilson interval counts');
  }
  if (total === 0) return null;
  const z = Z_BY_CONFIDENCE[confidence];
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    confidence,
  };
}
