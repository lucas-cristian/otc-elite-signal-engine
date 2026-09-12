import { DecisionRecord, ResolvedEntryRecord, UnresolvedEntryRecord, SignalRecord } from '../../../common/models/journal-types';
import { Tick } from '../../../common/models/types';
import { canonicalEntityHash } from '../../../common/hashing/canonical-hash';

export type EntryResolutionResult = 
  | { status: 'RESOLVED'; entry: ResolvedEntryRecord; signal: SignalRecord }
  | { status: 'UNRESOLVED'; entry: UnresolvedEntryRecord };

export class EntryResolver {
  constructor(private readonly maxDelayMs: number = 3000) {}

  public resolveFromTick(decision: DecisionRecord, tick: Tick, nowMs: number): EntryResolutionResult | null {
    if (decision.finalDecision !== 'CALL' && decision.finalDecision !== 'PUT') {
      return null; // Apenas CALL e PUT precisam de resolução
    }

    if (decision.alertPublishedAt === null) {
      return null; // O alerta não foi publicado
    }

    const delayMs = tick.eventTimestamp - decision.alertPublishedAt;

    // Timeout (Unresolved)
    if (delayMs > this.maxDelayMs || nowMs - decision.alertPublishedAt > this.maxDelayMs) {
      const unresolvedId = canonicalEntityHash('ENTRY_RESOLUTION_UNRESOLVED', 1, {
        decisionId: decision.decisionId,
        nowMs
      });
      return {
        status: 'UNRESOLVED',
        entry: {
          resolutionStatus: 'UNRESOLVED',
          entryResolutionId: unresolvedId,
          entryResolutionSchemaVersion: '1',
          decisionId: decision.decisionId,
          referenceEntryPrice: null,
          referenceEntryTimestamp: null,
          maxEntryResolutionDelayMs: this.maxDelayMs,
          unresolvedReason: 'ENTRY_TIMEOUT',
          resolvedAt: nowMs
        }
      };
    }

    // Apenas considera ticks que aconteceram DEPOIS (ou no exato milissegundo) da publicação do alerta
    if (tick.eventTimestamp >= decision.alertPublishedAt) {
      const entryId = canonicalEntityHash('ENTRY_RESOLUTION_RESOLVED', 1, {
        decisionId: decision.decisionId,
        tickId: tick.tickId
      });

      const entry: ResolvedEntryRecord = {
        resolutionStatus: 'RESOLVED',
        entryResolutionId: entryId,
        entryResolutionSchemaVersion: '1',
        decisionId: decision.decisionId,
        referenceEntryPrice: tick.price,
        referenceEntryTimestamp: tick.eventTimestamp,
        decisionPublishedAt: decision.decisionPublishedAt!,
        entryDelayMs: delayMs,
        entrySource: 'WS_JSON', // TODO: extrair do MarketSourceIdentity
        entryReferencePolicy: 'FIRST_TICK_AFTER_ALERT',
        entryMarketSourceIdentity: tick.marketSourceIdentity,
        entryPageSessionId: tick.pageSessionId,
        entryTickId: tick.tickId,
        resolvedAt: nowMs
      };

      const signalFingerprint = canonicalEntityHash('SIGNAL_FINGERPRINT', 1, {
        decisionId: decision.decisionId,
        referenceEntryTimestamp: tick.eventTimestamp
      });

      const signalId = canonicalEntityHash('SIGNAL', 1, {
        fingerprint: signalFingerprint
      });

      const signal: SignalRecord = {
        signalSchemaVersion: '1',
        signalId,
        signalFingerprint,
        decisionId: decision.decisionId,
        executionMode: decision.executionMode,
        asset: decision.asset,
        direction: decision.finalDecision as 'CALL' | 'PUT',
        referenceEntryPrice: tick.price,
        referenceEntryTimestamp: tick.eventTimestamp,
        expirationSeconds: decision.expirationSeconds,
        expectedExpiryTimestamp: tick.eventTimestamp + (decision.expirationSeconds * 1000),
        entryMarketSourceIdentity: tick.marketSourceIdentity,
        signalCreatedAt: nowMs
      };

      return { status: 'RESOLVED', entry, signal };
    }

    // Tick ainda está no passado em relação ao alerta, aguarda o próximo
    return null;
  }
}
