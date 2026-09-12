import { FrameSequencer, TickEmitter } from './frame-sequencer';
import { NormalizedMarketEvent } from '../common/models/market-events';
import { Tick } from '../common/models/types';

// ── Emitter concreto que usa chrome.runtime para enviar ao Service Worker ──
const tickEmitter: TickEmitter = (tick: Tick) => {
  chrome.runtime.sendMessage({ type: 'MARKET_TICK', payload: tick }).catch(err => {
    console.warn('[ContentScript] Failed to send tick to SW:', err);
  });
};

const sequencer = new FrameSequencer(tickEmitter);

// ── Escuta mensagens da Page Bridge (MAIN world) ──
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'OTC_ELITE_PAGE_BRIDGE') return;

  const evt = event.data.payload as NormalizedMarketEvent;

  switch (evt.type) {
    case 'CONNECTION':
      sequencer.handleConnectionEvent(evt.connectionId, evt.event);
      break;
    case 'PRICE_FRAME':
      sequencer.queueFrame(evt.connectionId, evt.payloadBuffer);
      break;
    case 'SUBSCRIPTION_STATE':
      // Será processado em fases futuras
      break;
  }
});

// ── Injeta a Page Bridge no MAIN world ──
const script = document.createElement('script');
script.src = chrome.runtime.getURL('pageBridge.js');
script.type = 'module';
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

console.log('[ContentScript] Isolated world initialized.');
