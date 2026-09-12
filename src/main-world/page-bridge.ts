import { NormalizedMarketEvent, ConnectionEventType } from '../common/models/market-events';

// Injetado na página original
function setupPageBridge() {
  const OriginalWebSocket = window.WebSocket;
  
  let connectionCounter = 0;

  function generateConnectionId(): string {
    return `ws_conn_${Date.now()}_${++connectionCounter}`;
  }

  function emitEvent(event: NormalizedMarketEvent) {
    window.postMessage(
      {
        source: 'OTC_ELITE_PAGE_BRIDGE',
        payload: event
      },
      '*'
    );
  }

  class InterceptedWebSocket extends OriginalWebSocket {
    private connectionId: string;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      
      this.connectionId = generateConnectionId();

      emitEvent({
        type: 'CONNECTION',
        connectionId: this.connectionId,
        event: 'OPEN',
        timestampMs: Date.now()
      });

      this.addEventListener('close', () => {
        emitEvent({
          type: 'CONNECTION',
          connectionId: this.connectionId,
          event: 'CLOSE',
          timestampMs: Date.now()
        });
      });

      this.addEventListener('error', () => {
        emitEvent({
          type: 'CONNECTION',
          connectionId: this.connectionId,
          event: 'ERROR',
          timestampMs: Date.now()
        });
      });

      this.addEventListener('message', (event) => {
        let payloadBuffer: Uint8Array;
        
        if (event.data instanceof ArrayBuffer) {
          payloadBuffer = new Uint8Array(event.data);
        } else if (event.data instanceof Blob) {
          // Blobs representam um desafio síncrono. Em um caso real, 
          // a leitura FileReader é necessária, mas omitiremos a conversão 
          // assíncrona pesada na bridge por simplicidade do skeleton, 
          // ou leremos sync se possível, mas Blob -> ArrayBuffer é async.
          // Para simplificar, transformamos via promise e ignoramos atrasos.
          event.data.arrayBuffer().then(buffer => {
            emitEvent({
              type: 'PRICE_FRAME',
              connectionId: this.connectionId,
              payloadBuffer: new Uint8Array(buffer),
              timestampMs: Date.now()
            });
          });
          return; // Atrasado
        } else if (typeof event.data === 'string') {
          payloadBuffer = new TextEncoder().encode(event.data);
        } else {
          return; // Tipo desconhecido
        }

        
        if ((window as any).__loggedFrames === undefined) { (window as any).__loggedFrames = 0; }
        if ((window as any).__loggedFrames < 3) {
           console.log("[PageBridge] Raw Frame Payload: ", typeof event.data, event.data.toString().substring(0,200));
           (window as any).__loggedFrames++;
        }
        emitEvent({
          type: 'PRICE_FRAME',

          connectionId: this.connectionId,
          payloadBuffer,
          timestampMs: Date.now()
        });
      });
    }
  }

  // Substitui a referência global
  window.WebSocket = InterceptedWebSocket as unknown as typeof WebSocket;
  console.log('[PageBridge] WebSocket interception initialized.');
}

setupPageBridge();
