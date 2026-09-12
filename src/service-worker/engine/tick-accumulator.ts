import { Tick, Candle, Timeframe, TimestampBasis } from '../../common/models/types';
import { CandleBuilder, CandleEmitter } from './candle-builder';

export type DataUnavailableCallback = (asset: string, reason: 'FEED_STALE') => void;

export interface TickAccumulatorConfig {
  /** Timeframes a construir simultaneamente. */
  timeframes: Timeframe[];
  /** ms sem nenhum tick antes de disparar DATA_UNAVAILABLE. */
  staleThresholdMs: number;
  timestampBasis: TimestampBasis;
  onCandle: CandleEmitter;
  onDataUnavailable: DataUnavailableCallback;
}

/**
 * Gerencia múltiplos CandleBuilders (um por timeframe) para um único ativo.
 * Também monitora staleness do feed.
 */
export class TickAccumulator {
  private readonly asset: string;
  private readonly config: TickAccumulatorConfig;
  private readonly builders = new Map<Timeframe, CandleBuilder>();
  private lastTickTimestamp = 0;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(asset: string, config: TickAccumulatorConfig) {
    this.asset = asset;
    this.config = config;

    for (const tf of config.timeframes) {
      this.builders.set(
        tf,
        new CandleBuilder(asset, tf, config.timestampBasis, config.onCandle),
      );
    }
  }

  public ingestTick(tick: Tick): void {
    if (tick.price <= 0 || !isFinite(tick.price)) {
      console.warn(`[TickAccumulator] Preço inválido descartado: ${tick.price}`);
      return;
    }

    this.lastTickTimestamp = tick.eventTimestamp;
    this.resetStaleTimer();

    for (const builder of this.builders.values()) {
      builder.ingestTick(tick);
    }
  }

  public getPartialCandles(): Map<Timeframe, Candle | null> {
    const result = new Map<Timeframe, Candle | null>();
    for (const [tf, builder] of this.builders.entries()) {
      result.set(tf, builder.getPartialCandle());
    }
    return result;
  }

  public flush(): void {
    this.clearStaleTimer();
    for (const builder of this.builders.values()) {
      builder.flush();
    }
  }

  public getLastTickTimestamp(): number {
    return this.lastTickTimestamp;
  }

  // ── Stale feed monitor ────────────────────────────────────────────────────

  private resetStaleTimer(): void {
    this.clearStaleTimer();
    this.staleTimer = setTimeout(() => {
      this.config.onDataUnavailable(this.asset, 'FEED_STALE');
    }, this.config.staleThresholdMs);
  }

  private clearStaleTimer(): void {
    if (this.staleTimer !== null) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }
}
