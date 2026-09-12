import { Tick, Candle } from '../../common/models/types';
import { MarketDataRouter } from './market-data-router';
import { openJournalDB } from '../storage/idb-schema';
import { JournalStore } from '../storage/journal-store';
import { JournalReader } from '../storage/journal-reader';
import { DecisionEngine } from '../engine/decision/decision-engine';
import { EntryResolver } from '../engine/decision/entry-resolver';
import { ResultEngine } from '../evaluation/result-engine';
import { DecisionRecord, SignalRecord } from '../../common/models/journal-types';

// ── Journal ───────────────────────────────────────────────────────────────
let journalStore: JournalStore | null = null;
let journalReader: JournalReader | null = null;

openJournalDB().then((db) => {
  journalStore = new JournalStore(db);
  journalReader = new JournalReader(db);
  console.log('[SW] IDB Journal opened successfully.');
}).catch((err) => {
  console.error('[SW] CRITICAL: Failed to open IDB Journal:', err);
  // Fail-closed: sem journal, o SW não emite sinais
});

// ── Decision Engine, Entry Resolver & Result Engine ───────────────────────
const decisionEngine = new DecisionEngine({
  executionMode: 'LIVE',
  appVersion: '1.0.0',
  configHash: 'default_v1',
  configSnapshot: {},
  expirationSeconds: 60,
  probabilityThreshold: 0.70
});

const entryResolver = new EntryResolver(3000);
const resultEngine = new ResultEngine(5000);

const pendingEntries = new Map<string, DecisionRecord>(); // decisionId -> DecisionRecord
const pendingSignals = new Map<string, SignalRecord>(); // signalId -> SignalRecord

// ── Market Data Router ────────────────────────────────────────────────────
const router = new MarketDataRouter({
  timeframes: ['M1', 'M5', 'M15'],
  staleThresholdMs: 30_000,
  timestampBasis: 'LOCAL_RECEIVED',
  onCandle: async (asset: string, candle: Candle) => {
    if (candle.lifecycle === 'CLOSED') {
      const nowMs = Date.now();
      const decision = decisionEngine.evaluateCandle(candle, nowMs, 'OPTIMAL');
      
      if (journalStore) {
        try {
          await journalStore.appendDecision(decision);
        } catch (err) {
          console.error('[SW] Erro ao gravar Decision:', err);
        }
      }

      if (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') {
        pendingEntries.set(decision.decisionId, decision);
      }
    }
  },
  onDataUnavailable: async (asset: string, reason: string) => {
    console.warn(`[SW] DATA_UNAVAILABLE | ${asset} | reason=${reason}`);
  },
});

// ── Message listener ──────────────────────────────────────────────────────
self.addEventListener('message', async (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'MARKET_TICK': {
      const tick = msg.payload as Tick;
      if (!tick || typeof tick.price !== 'number') return;
      
      router.routeTick(tick);
      const nowMs = Date.now();

      // 1. Resolve pending entries (Decision -> Signal)
      if (pendingEntries.size > 0 && journalStore) {
        for (const [decisionId, decision] of pendingEntries.entries()) {
          if (decision.asset === tick.marketSourceIdentity.asset) {
            const result = entryResolver.resolveFromTick(decision, tick, nowMs);
            if (result) {
              pendingEntries.delete(decisionId);
              try {
                await journalStore.appendEntryResolution(result.entry);
                if (result.status === 'RESOLVED' && result.signal) {
                  await journalStore.appendSignal(result.signal);
                  pendingSignals.set(result.signal.signalId, result.signal);
                  console.log(`[SW] Signal gerado: ${result.signal.direction} ${result.signal.asset}`, result.signal);
                }
              } catch (err) {
                console.error('[SW] Erro ao gravar Entry/Signal:', err);
              }
            }
          }
        }
      }

      // 2. Resolve pending signals (Signal -> Result)
      if (pendingSignals.size > 0 && journalStore) {
        for (const [signalId, signal] of pendingSignals.entries()) {
          if (signal.asset === tick.marketSourceIdentity.asset) {
            const result = resultEngine.evaluateFromTick(signal, tick, nowMs);
            if (result) {
              pendingSignals.delete(signalId);
              try {
                await journalStore.appendResult(result.result);
                console.log(`[SW] Result gerado: ${result.result.directionalOutcome} | Return: ${result.result.economicReturn}`);
              } catch (err) {
                console.error('[SW] Erro ao gravar Result:', err);
              }
            }
          }
        }
      }
      break;
    }

    case 'QUERY_PENDING_RESULTS': {
      if (!journalReader) return;
      const nowMs = msg.nowMs ?? Date.now();
      journalReader.listPendingResults(nowMs).then(pending => {
        console.log(`[SW] Pending results: ${pending.length}`);
      });
      break;
    }
  }
});

console.log('[SW] Background service worker initialized.');
