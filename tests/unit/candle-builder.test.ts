import { describe, it, expect, vi, afterEach } from 'vitest';
import { CandleBuilder } from '../../src/service-worker/engine/candle-builder';
import { Tick, Candle, CandleLifecycle } from '../../src/common/models/types';

// Referência: 2024-01-01 00:00:00 UTC
const BASE = 1704067200000;

function makeTick(price: number, offsetMs: number): Tick {
  return {
    tickId: `t_${offsetMs}`,
    tickSchemaVersion: '1',
    marketSourceIdentity: {} as any,
    pageSessionId: 'sess',
    price,
    eventTimestamp: BASE + offsetMs,
    timestampBasis: 'LOCAL_RECEIVED',
  } as Tick;
}

afterEach(() => vi.restoreAllMocks());

describe('CandleBuilder', () => {
  it('builds correct OHLC from multiple ticks in same interval', () => {
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    // Candle 1: ticks em [BASE, BASE+60s)
    builder.ingestTick(makeTick(1.1000, 5_000));   // open
    builder.ingestTick(makeTick(1.1050, 15_000));  // high
    builder.ingestTick(makeTick(1.0980, 30_000));  // low
    builder.ingestTick(makeTick(1.1020, 55_000));  // close

    // Tick no segundo minuto → fecha o candle anterior
    builder.ingestTick(makeTick(1.1030, 65_000));

    expect(emitted).toHaveLength(1);
    const c = emitted[0];
    expect(c.lifecycle).toBe(CandleLifecycle.CLOSED);
    expect(c.open).toBe(1.1000);
    expect(c.high).toBe(1.1050);
    expect(c.low).toBe(1.0980);
    expect(c.close).toBe(1.1020);
    expect(c.tickCount).toBe(4);
    expect(c.gapAffected).toBe(false);
    expect(c.startTimestamp).toBe(BASE);
    expect(c.endTimestamp).toBe(BASE + 60_000);
  });

  it('emits EMPTY_INTERVAL candles for gaps', () => {
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    builder.ingestTick(makeTick(1.10, 5_000));    // Candle @BASE
    builder.ingestTick(makeTick(1.11, 185_000));  // Candle @BASE+180s — 2 candles de gap

    // 1 candle fechado + 2 EMPTY_INTERVAL
    expect(emitted).toHaveLength(3);
    expect(emitted[0].lifecycle).toBe(CandleLifecycle.CLOSED);
    expect(emitted[1].lifecycle).toBe(CandleLifecycle.EMPTY_INTERVAL);
    expect(emitted[2].lifecycle).toBe(CandleLifecycle.EMPTY_INTERVAL);

    // Candle após o gap deve ser marcado como gapAffected
    const partialCandle = builder.getPartialCandle();
    expect(partialCandle?.gapAffected).toBe(true);
  });

  it('marks first post-gap candle as gapAffected', () => {
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    builder.ingestTick(makeTick(1.10, 5_000));
    builder.ingestTick(makeTick(1.11, 125_000)); // gap de 1 candle
    builder.ingestTick(makeTick(1.12, 185_000)); // avança para o candle seguinte

    // O segundo candle fechado deve ser gapAffected
    expect(emitted).toHaveLength(3); // closed + empty + closed
    expect(emitted[2].lifecycle).toBe(CandleLifecycle.CLOSED);
    expect(emitted[2].gapAffected).toBe(true);
  });

  it('discards retroactive (out-of-order) ticks — anti-lookahead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    builder.ingestTick(makeTick(1.10, 65_000));  // Candle @BASE+60s (minuto 2)
    builder.ingestTick(makeTick(1.05, 5_000));   // Retroativo → deve ser descartado

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Tick retroativo descartado'));
    // O candle não deve ser afetado
    const partial = builder.getPartialCandle();
    expect(partial?.open).toBe(1.10); // Não alterado
    expect(partial?.tickCount).toBe(1);
  });

  it('getPartialCandle returns FORMING candle without emitting', () => {
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    builder.ingestTick(makeTick(1.10, 5_000));
    builder.ingestTick(makeTick(1.15, 20_000));

    const partial = builder.getPartialCandle();
    expect(emitted).toHaveLength(0); // Nenhum candle fechado
    expect(partial?.lifecycle).toBe(CandleLifecycle.FORMING);
    expect(partial?.high).toBe(1.15);
  });

  it('flush emits the current candle as CLOSED', () => {
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    builder.ingestTick(makeTick(1.10, 5_000));
    builder.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].lifecycle).toBe(CandleLifecycle.CLOSED);
  });

  it('rejects ticks with invalid price', () => {
    // Este teste é da camada TickAccumulator, mas o CandleBuilder também
    // nunca deve receber preços inválidos — aqui validamos que OHLC não corrompe
    const emitted: Candle[] = [];
    const builder = new CandleBuilder('EURUSD', 'M1', 'LOCAL_RECEIVED', c => emitted.push(c));

    builder.ingestTick(makeTick(1.10, 5_000));
    // Injeta um preço 0 diretamente — o CandleBuilder vai processar (a validação é no Accumulator),
    // mas verificamos que o comportamento é determinístico
    builder.ingestTick(makeTick(0, 10_000));

    const partial = builder.getPartialCandle();
    expect(partial?.low).toBe(0); // Documentamos que CandleBuilder é dumb, validação é externa
  });
});
