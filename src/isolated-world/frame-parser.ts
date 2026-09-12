import { Tick } from '../common/models/types';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value);
}

function getNumericField(payload: JsonObject, ...fieldNames: string[]): number | null {
  for (const fieldName of fieldNames) {
    const value = payload[fieldName];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function getLastStreamPrice(stream: JsonValue[]): number | null {
  const lastValue = stream[stream.length - 1];

  if (isJsonObject(lastValue)) {
    return getNumericField(lastValue, 'price', 'rate', 'value', 'val', 'close');
  }

  if (isJsonArray(lastValue)) {
    const price = lastValue[1];
    return typeof price === 'number' && Number.isFinite(price) ? price : null;
  }

  return null;
}

function extractJsonArray(text: string): string | null {
  const arrayStart = text.indexOf('[');
  if (arrayStart < 0) return null;

  const packetPrefix = text.slice(0, arrayStart).trim();
  if (!/^\d+(?:-\d*)?$/.test(packetPrefix)) return null;

  return text.slice(arrayStart);
}

function createTick(assetName: string, p: number): Tick {
  return {
    tickSchemaVersion: '1.0',
    tickId: 'tick_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    marketSourceIdentity: {
      marketSourceIdentitySchemaVersion: '1.0',
      platform: 'POCKET_OPTION',
      asset: assetName,
      marketType: 'OTC',
      source: 'WS_JSON',
      feedId: null,
      instrumentId: null,
      parserSchemaId: 'GENERIC_JSON'
    },
    pageSessionId: 'session_1',
    eventTimestamp: Date.now(),
    price: p,
    timestampBasis: 'LOCAL_RECEIVED'
  };
}

export async function parseFrame(payloadBuffer: Uint8Array): Promise<Tick | null> {
  try {
    const text = new TextDecoder().decode(payloadBuffer);
    
    const jsonStr = extractJsonArray(text);
    if (!jsonStr) return null;

    let data: unknown;
    try {
      data = JSON.parse(jsonStr) as unknown;
    } catch(e) { return null; }

    if (!isJsonArray(data) || data.length < 2) return null;

    const eventName = data[0];
    const payload = data[1];

    if (typeof eventName !== 'string' || !isJsonObject(payload)) return null;

    // Caso 1: Evento direto de "update"
    if (eventName === 'update' || eventName === 'price_update') {
      const asset = payload.asset ?? payload.symbol;
      const price = getNumericField(payload, 'price', 'rate', 'val');
      
      if (asset && price !== null) {
        return createTick(String(asset).replace('_otc', ' OTC'), price);
      }
    }
    
    // Caso 2: Evento de "updateHistoryNew" (quando abre o grafico)
    if (eventName === 'updateHistoryNew' && isJsonArray(payload.history) && payload.history.length > 0) {
      const asset = payload.asset ?? payload.symbol;
      const lastTick = payload.history[payload.history.length - 1];
      const price = isJsonObject(lastTick)
        ? getNumericField(lastTick, 'price', 'rate', 'value', 'val', 'close')
        : isJsonArray(lastTick) ? getLastStreamPrice([lastTick]) : null;
      
      if (asset && price !== null) {
        return createTick(String(asset).replace('_otc', ' OTC'), price);
      }
    }

    // Caso 3: Stream incremental de preços, geralmente emitido como [timestamp, price].
    if (eventName === 'updateStream' && isJsonArray(payload.data) && payload.data.length > 0) {
      const asset = payload.asset ?? payload.symbol;
      const price = getLastStreamPrice(payload.data);

      if (asset && price !== null) {
        return createTick(String(asset).replace('_otc', ' OTC'), price);
      }
    }
    
    // Caso 4: Fallback generico para qualquer array estruturado 
    const directPrice = getNumericField(payload, 'price');
    if (payload.symbol && directPrice !== null) {
      if (eventName.includes('chat') || eventName.includes('alert')) return null;
      return createTick(String(payload.symbol).replace('_otc', ' OTC'), directPrice);
    }
    
    if (payload.asset && directPrice !== null) {
      if (eventName.includes('chat') || eventName.includes('alert')) return null;
      return createTick(String(payload.asset).replace('_otc', ' OTC'), directPrice);
    }

  } catch (err) {
    // Fail-Closed
  }
  return null;
}
