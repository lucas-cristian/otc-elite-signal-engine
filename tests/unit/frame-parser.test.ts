import { describe, expect, it } from 'vitest';
import { parseFrame } from '../../src/isolated-world/frame-parser';

function frame(value: unknown): Uint8Array {
  return new TextEncoder().encode(`42${JSON.stringify(value)}`);
}

describe('parseFrame', () => {
  it('parses the latest price from updateStream data', async () => {
    const tick = await parseFrame(frame([
      'updateStream',
      {
        asset: 'EURUSD_otc',
        data: [[1789186200, 1.2345]],
      },
    ]));

    expect(tick?.price).toBe(1.2345);
    expect(tick?.marketSourceIdentity.asset).toBe('EURUSD OTC');
  });

  it('accepts a transport prefix before the JSON array', async () => {
    const tick = await parseFrame(new TextEncoder().encode(
      '451-["updateStream",{"asset":"EURUSD_otc","data":[[1,1.25]]}]',
    ));

    expect(tick?.price).toBe(1.25);
  });

  it('does not turn chat events into market ticks', async () => {
    const tick = await parseFrame(frame([
      'chat_room_list',
      { asset: 'EURUSD_otc', price: 1.2345 },
    ]));

    expect(tick).toBeNull();
  });
});
