import { Tick, Candle, Timeframe, CandleLifecycle, TimestampBasis } from '../../common/models/types';
import {
  alignToCandleStart,
  alignToCandleEnd,
  intervalsBetween,
  TIMEFRAME_MS,
} from '../../common/time/candle-time';

interface CandleAccumState {
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  intervalStart: number;
  gapAffected: boolean;
  lastTickTimestamp: number;
}

export type CandleEmitter = (candle: Candle) => void;

export class CandleBuilder {
  private state: CandleAccumState | null = null;
  private readonly asset: string;
  private readonly timeframe: Timeframe;
  private readonly timestampBasis: TimestampBasis;
  private readonly emitter: CandleEmitter;

  constructor(
    asset: string,
    timeframe: Timeframe,
    timestampBasis: TimestampBasis,
    emitter: CandleEmitter,
  ) {
    this.asset = asset;
    this.timeframe = timeframe;
    this.timestampBasis = timestampBasis;
    this.emitter = emitter;
  }

  /**
   * Processa um tick. Mantém invariante: nenhum tick é "lookahead" —
   * só o intervalo corrente é manipulado.
   */
  public ingestTick(tick: Tick): void {
    const tickTs = tick.eventTimestamp;
    const intervalStart = alignToCandleStart(tickTs, this.timeframe);

    if (this.state === null) {
      // Primeira observação — abre novo candle
      this.state = this.openNewState(intervalStart, tick.price, false);
      return;
    }

    const currentIntervalStart = this.state.intervalStart;

    if (intervalStart === currentIntervalStart) {
      // Mesmo intervalo — atualiza OHLC
      this.updateOHLC(tick.price);
      this.state.lastTickTimestamp = tickTs;
      return;
    }

    if (intervalStart > currentIntervalStart) {
      // Novo intervalo — fecha o candle atual
      this.closeAndEmit(this.state);

      // Detecta gaps entre o candle fechado e o novo tick
      const gapCount = intervalsBetween(
        this.state.lastTickTimestamp,
        tickTs,
        this.timeframe,
      );

      for (let i = 0; i < gapCount; i++) {
        const gapStart = currentIntervalStart + (i + 1) * TIMEFRAME_MS[this.timeframe];
        this.emitEmpty(gapStart);
      }

      // Abre novo candle — gapAffected se houve qualquer gap
      this.state = this.openNewState(intervalStart, tick.price, gapCount > 0);
      return;
    }

    // Tick fora de ordem (retroativo) — descartado para garantir anti-lookahead
    console.warn(
      `[CandleBuilder] Tick retroativo descartado: tickTs=${tickTs} < intervalStart=${currentIntervalStart}`,
    );
  }

  /**
   * Força o fechamento do candle atual como FORMING (parcial).
   * Usado para snapshot de UI, não para análise quantitativa.
   */
  public getPartialCandle(): Candle | null {
    if (!this.state) return null;
    return this.buildCandle(this.state, CandleLifecycle.FORMING);
  }

  /**
   * Fecha e emite o candle atual (ex: ao desligar o feed).
   */
  public flush(): void {
    if (this.state) {
      this.closeAndEmit(this.state);
      this.state = null;
    }
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  private openNewState(
    intervalStart: number,
    openPrice: number,
    gapAffected: boolean,
  ): CandleAccumState {
    return {
      open: openPrice,
      high: openPrice,
      low: openPrice,
      close: openPrice,
      tickCount: 1,
      intervalStart,
      gapAffected,
      lastTickTimestamp: intervalStart,
    };
  }

  private updateOHLC(price: number): void {
    if (!this.state) return;
    if (price > this.state.high) this.state.high = price;
    if (price < this.state.low)  this.state.low  = price;
    this.state.close = price;
    this.state.tickCount++;
  }

  private closeAndEmit(state: CandleAccumState): void {
    this.emitter(this.buildCandle(state, CandleLifecycle.CLOSED));
  }

  private emitEmpty(intervalStart: number): void {
    const candle: Candle = {
      candleSchemaVersion: '1',
      asset: this.asset,
      timeframe: this.timeframe,
      startTimestamp: intervalStart,
      endTimestamp: alignToCandleEnd(intervalStart, this.timeframe),
      lifecycle: CandleLifecycle.EMPTY_INTERVAL,
      gapAffected: true,
      open: null,
      high: null,
      low: null,
      close: null,
      tickCount: 0,
      timestampBasis: this.timestampBasis,
    };
    this.emitter(candle);
  }

  private buildCandle(state: CandleAccumState, lifecycle: CandleLifecycle): Candle {
    return {
      candleSchemaVersion: '1',
      asset: this.asset,
      timeframe: this.timeframe,
      startTimestamp: state.intervalStart,
      endTimestamp: alignToCandleEnd(state.intervalStart, this.timeframe),
      lifecycle,
      gapAffected: state.gapAffected,
      open: state.open,
      high: state.high,
      low: state.low,
      close: state.close,
      tickCount: state.tickCount,
      timestampBasis: this.timestampBasis,
    };
  }
}
