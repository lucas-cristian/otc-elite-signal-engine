import { describe, it, expect, vi, afterEach } from 'vitest';
import { FrameSequencer } from '../../src/isolated-world/frame-sequencer';
import * as parser from '../../src/isolated-world/frame-parser';
import { Tick } from '../../src/common/models/types';

const makeDummyTick = (price: number): Tick => ({
  tickId: `t_${price}`,
  tickSchemaVersion: '1',
  marketSourceIdentity: {} as any,
  pageSessionId: 'sess_1',
  price,
  eventTimestamp: 1000,
  timestampBasis: 'LOCAL_RECEIVED',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FrameSequencer', () => {
  it('should emit ticks from two connections independently', async () => {
    vi.spyOn(parser, 'parseFrame').mockImplementation(async (buf) =>
      makeDummyTick(buf[0])
    );

    const emitted: Tick[] = [];
    const emitter = vi.fn((tick: Tick) => emitted.push(tick));
    const sequencer = new FrameSequencer(emitter);

    sequencer.handleConnectionEvent('conn_1', 'OPEN');
    sequencer.handleConnectionEvent('conn_2', 'OPEN');

    await sequencer.queueFrame('conn_1', new Uint8Array([10]));
    await sequencer.queueFrame('conn_2', new Uint8Array([20]));

    // drain usa await internamente — aguarda microtasks pendentes
    await Promise.resolve();
    await Promise.resolve();

    expect(emitter).toHaveBeenCalledTimes(2);
    expect(emitted.map(t => t.price)).toEqual(expect.arrayContaining([10, 20]));
  });

  it('should drop frames queued after CLOSE', async () => {
    const emitter = vi.fn();
    const sequencer = new FrameSequencer(emitter);

    sequencer.handleConnectionEvent('conn_1', 'OPEN');
    sequencer.handleConnectionEvent('conn_1', 'CLOSE');

    await sequencer.queueFrame('conn_1', new Uint8Array([99]));

    expect(emitter).not.toHaveBeenCalled();
    expect((sequencer as any).connections.has('conn_1')).toBe(false);
  });

  it('should not call emitter for null parse results', async () => {
    vi.spyOn(parser, 'parseFrame').mockResolvedValue(null);

    const emitter = vi.fn();
    const sequencer = new FrameSequencer(emitter);
    sequencer.handleConnectionEvent('conn_1', 'OPEN');

    await sequencer.queueFrame('conn_1', new Uint8Array([1]));

    await Promise.resolve();
    await Promise.resolve();

    expect(emitter).not.toHaveBeenCalled();
  });

  it('should maintain sequence order per connection', async () => {
    const prices: number[] = [];
    vi.spyOn(parser, 'parseFrame')
      .mockImplementationOnce(async () => { await delay(20); return makeDummyTick(1); })
      .mockImplementationOnce(async () => { await delay(5);  return makeDummyTick(2); })
      .mockImplementationOnce(async () => { await delay(1);  return makeDummyTick(3); });

    const sequencer = new FrameSequencer((tick) => prices.push(tick.price));
    sequencer.handleConnectionEvent('conn_1', 'OPEN');

    // Queued em sequência, mas parseFrame resolve fora de ordem
    await sequencer.queueFrame('conn_1', new Uint8Array([0])); // → tick 1 (lento)
    await sequencer.queueFrame('conn_1', new Uint8Array([0])); // → tick 2 (médio)
    await sequencer.queueFrame('conn_1', new Uint8Array([0])); // → tick 3 (rápido)

    // Aguarda todas as Promises resolverem
    await delay(50);

    expect(prices).toEqual([1, 2, 3]); // Ordem garantida pelo sequencer
  });
});

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
