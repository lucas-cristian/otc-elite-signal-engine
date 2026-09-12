import { Tick } from '../common/models/types';

export async function parseFrame(payloadBuffer: Uint8Array): Promise<Tick | null> {
  try {
    const text = new TextDecoder().decode(payloadBuffer);
    
    // Filtro básico para evitar processar mensagens irrelevantes
    if (!text.includes('price') && !text.includes('rate')) return null;

    // Pocket Option geralmente envia os preços em arrays de atualização do Socket.io ou JSON direto
    // Tentativa de achar um padrão genérico para ativos OTC
    
    // 1. Tentar parsear JSON direto (se for uma string JSON válida)
    let data: any = null;
    try {
      // socket.io pode prefixar com "42" (message)
      if (text.startsWith('42')) {
        data = JSON.parse(text.substring(2));
      } else {
        data = JSON.parse(text);
      }
    } catch(e) {
      // Ignorar e tentar regex
    }

    if (data && Array.isArray(data) && data.length > 1) {
      const payload = data[1];
      // Adaptar dependendo da estrutura real da corretora
      const asset = payload.asset || payload.symbol;
      const price = payload.price || payload.rate || payload.val;
      
      if (asset && price && typeof price === 'number') {
        return {
          asset: String(asset).replace('_otc', ' OTC'),
          timestamp: Date.now(),
          price: price
        };
      }
    }

    // 2. Fallback: Regex genérico para caçar "asset":"EURUSD_otc" e "price":1.2345
    const assetMatch = text.match(/"(?:asset|symbol)"\s*:\s*"([A-Z0-9_]+)"/);
    const priceMatch = text.match(/"(?:price|rate|val)"\s*:\s*([0-9]+\.[0-9]+)/);
    
    if (assetMatch && priceMatch) {
      return {
        asset: assetMatch[1].replace('_otc', ' OTC'),
        timestamp: Date.now(),
        price: parseFloat(priceMatch[1])
      };
    }
  } catch (err) {
    // Fail-Closed behavior
  }
  return null;
}
