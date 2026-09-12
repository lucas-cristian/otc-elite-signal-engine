import { Tick } from '../common/models/types';

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
    
    // Processa apenas as mensagens de dados (42)
    if (!text.startsWith('42[')) return null;
    
    const jsonStr = text.substring(2);
    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch(e) { return null; }

    if (!Array.isArray(data) || data.length < 2) return null;

    const eventName = data[0];
    const payload = data[1];

    if (!payload || typeof payload !== 'object') return null;

    // Caso 1: Evento direto de "update"
    if (eventName === 'update' || eventName === 'price_update') {
      const asset = payload.asset || payload.symbol;
      const price = payload.price || payload.rate || payload.val;
      
      if (asset && price && typeof price === 'number') {
        return createTick(String(asset).replace('_otc', ' OTC'), price);
      }
    }
    
    // Caso 2: Evento de "updateHistoryNew" (quando abre o grafico)
    if (eventName === 'updateHistoryNew' && Array.isArray(payload.history) && payload.history.length > 0) {
      const asset = payload.asset || payload.symbol;
      const lastTick = payload.history[payload.history.length - 1];
      const price = lastTick.price || lastTick[1];
      
      if (asset && price && typeof price === 'number') {
        return createTick(String(asset).replace('_otc', ' OTC'), price);
      }
    }
    
    // Caso 3: Fallback generico para qualquer array estruturado 
    if (payload.symbol && payload.price && typeof payload.price === 'number') {
      if (eventName.includes('chat') || eventName.includes('alert')) return null;
      return createTick(String(payload.symbol).replace('_otc', ' OTC'), payload.price);
    }
    
    if (payload.asset && payload.price && typeof payload.price === 'number') {
      if (eventName.includes('chat') || eventName.includes('alert')) return null;
      return createTick(String(payload.asset).replace('_otc', ' OTC'), payload.price);
    }

  } catch (err) {
    // Fail-Closed
  }
  return null;
}
