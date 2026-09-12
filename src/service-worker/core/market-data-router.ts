import { Tick, Candle, Timeframe, TimestampBasis } from '../../common/models/types';
import { TickAccumulator, TickAccumulatorConfig } from '../engine/tick-accumulator';
import { getCanonicalAssetId } from '../../common/hashing/canonical-hash';

export type RouterCandleHandler = (asset: string, candle: Candle) => void;
export type RouterDataUnavailableHandler = (asset: string, reason: string) => void;

export interface MarketDataRouterConfig {
  timeframes: Timeframe[];
  staleThresholdMs: number;
  timestampBasis: TimestampBasis;
  onCandle: RouterCandleHandler;
  onDataUnavailable: RouterDataUnavailableHandler;
}

/**
 * Recebe ticks e os roteia para o TickAccumulator correto por ativo.
 * Cria acumuladores sob demanda (lazy).
 */
export class MarketDataRouter {
  private readonly accumulators = new Map<string, TickAccumulator>();
  private readonly config: MarketDataRouterConfig;

  constructor(config: MarketDataRouterConfig) {
    this.config = config;
  }

  public routeTick(tick: Tick): void {
    const canonicalAsset = getCanonicalAssetId(tick.marketSourceIdentity.asset);
    let accumulator = this.accumulators.get(canonicalAsset);

    if (!accumulator) {
      accumulator = this.createAccumulator(canonicalAsset);
      this.accumulators.set(canonicalAsset, accumulator);
    }

    accumulator.ingestTick(tick);
  }

  public getActiveAssets(): string[] {
    return Array.from(this.accumulators.keys());
  }

  public getPartialCandles(asset: string): Map<Timeframe, Candle | null> | null {
    const acc = this.accumulators.get(getCanonicalAssetId(asset));
    return acc ? acc.getPartialCandles() : null;
  }

  public flushAll(): void {
    for (const acc of this.accumulators.values()) {
      acc.flush();
    }
    this.accumulators.clear();
  }

  private createAccumulator(canonicalAsset: string): TickAccumulator {
    const accConfig: TickAccumulatorConfig = {
      timeframes: this.config.timeframes,
      staleThresholdMs: this.config.staleThresholdMs,
      timestampBasis: this.config.timestampBasis,
      onCandle: (candle: Candle) => {
        this.config.onCandle(canonicalAsset, candle);
      },
      onDataUnavailable: (asset: string, reason) => {
        this.config.onDataUnavailable(asset, reason);
      },
    };

    return new TickAccumulator(canonicalAsset, accConfig);
  }
}
