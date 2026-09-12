import { canonicalEntityHash } from '../../../common/hashing/canonical-hash.js';
import type {
  DecisionRecord,
  EntryResolutionRecord,
  EntryUnresolvedReason,
  ResolvedEntryRecord,
  SignalRecord,
} from '../../../common/models/journal-types.js';
import type { PayoutSnapshot, Tick } from '../../../common/models/types.js';

export interface EntryResolutionOutcome {
  entry: EntryResolutionRecord;
  signal: SignalRecord | null;
}

function unknownPayout(decision: DecisionRecord, capturedAt: number): PayoutSnapshot {
  return {
    payoutSnapshotSchemaVersion: '3',
    canonicalAssetId: decision.canonicalAssetId,
    expirationSeconds: null,
    expirationBinding: 'UNBOUND',
    payoutRate: null,
    capturedAt,
    source: 'UNKNOWN',
    quality: 'UNKNOWN',
    feedId: null,
    parserSchemaId: null,
    protocolVerificationId: null,
  };
}

export class EntryResolver {
  public constructor(private readonly maxEntryResolutionDelayMs: number) {}

  public resolveFromTick(decision: DecisionRecord, tick: Tick, payoutSnapshot: PayoutSnapshot | null): EntryResolutionOutcome | null {
    if ((decision.finalDecision !== 'CALL' && decision.finalDecision !== 'PUT') || decision.alertPublishedAt === null) return null;
    if (tick.eventTimestampEpochMs < decision.alertPublishedAt) return null;
    if (tick.eventTimestampEpochMs > decision.alertPublishedAt + this.maxEntryResolutionDelayMs) {
      return { entry: this.unresolved(decision, 'ENTRY_TIMEOUT', tick.eventTimestampEpochMs), signal: null };
    }
    if (tick.marketSourceIdentity.canonicalAssetId !== decision.canonicalAssetId) return null;
    if (decision.sourceFeedId === null || tick.marketSourceIdentity.feedId !== decision.sourceFeedId) return null;
    if (decision.marketEpisodeId === null || decision.arbitrationStatus !== 'PRIMARY') return null;
    if (tick.integrity !== 'VALID' || tick.sourceQuality !== 'VERIFIED' || tick.protocolVerificationId === null) return null;
    const entryPayload = {
      decisionId: decision.decisionId,
      entryTickId: tick.tickId,
      referenceEntryTimestamp: tick.eventTimestampEpochMs,
      referenceEntryPrice: tick.price,
    };
    const entry: ResolvedEntryRecord = {
      resolutionStatus: 'RESOLVED',
      entryResolutionSchemaVersion: '2',
      entryResolutionId: canonicalEntityHash('ENTRY_RESOLUTION_RESOLVED', 2, entryPayload),
      decisionId: decision.decisionId,
      referenceEntryPrice: tick.price,
      referenceEntryTimestamp: tick.eventTimestampEpochMs,
      decisionPublishedAt: decision.decisionPublishedAt,
      entryDelayMs: tick.eventTimestampEpochMs - decision.alertPublishedAt,
      entryReferencePolicy: 'FIRST_TICK_AFTER_ALERT',
      entryMarketSourceIdentity: tick.marketSourceIdentity,
      entryPageSessionId: tick.pageSessionId,
      entryTickId: tick.tickId,
      resolvedAt: tick.receivedAtEpochMs,
    };
    const fingerprint = canonicalEntityHash('SIGNAL_FINGERPRINT', 2, {
      canonicalAssetId: decision.canonicalAssetId,
      evaluationWindowId: decision.evaluationWindowId,
      structureRegime: decision.structureRegime,
      volatilityRegime: decision.volatilityRegime,
      strategyGroupId: 'CORE_STRATEGIES_V1',
      direction: decision.finalDecision,
      expirationSeconds: decision.expirationSeconds,
      configHash: decision.configHash,
    });
    const signalId = canonicalEntityHash('SIGNAL', 2, {
      signalFingerprint: fingerprint,
      decisionId: decision.decisionId,
      entryTickId: tick.tickId,
    });
    const signal: SignalRecord = {
      signalSchemaVersion: '3',
      signalId,
      signalFingerprint: fingerprint,
      decisionId: decision.decisionId,
      marketEpisodeId: decision.marketEpisodeId,
      executionMode: decision.executionMode,
      canonicalAssetId: decision.canonicalAssetId,
      direction: decision.finalDecision,
      referenceEntryPrice: tick.price,
      referenceEntryTimestamp: tick.eventTimestampEpochMs,
      expirationSeconds: decision.expirationSeconds,
      expectedExpiryTimestamp: tick.eventTimestampEpochMs + decision.expirationSeconds * 1000,
      entryMarketSourceIdentity: tick.marketSourceIdentity,
      entryPageSessionId: tick.pageSessionId,
      payoutSnapshot: payoutSnapshot ?? unknownPayout(decision, tick.receivedAtEpochMs),
      signalCreatedAt: tick.receivedAtEpochMs,
    };
    return { entry, signal };
  }

  public timeout(decision: DecisionRecord, nowMs: number, reason: EntryUnresolvedReason = 'ENTRY_TIMEOUT'): EntryResolutionRecord | null {
    if ((decision.finalDecision !== 'CALL' && decision.finalDecision !== 'PUT') || decision.alertPublishedAt === null) return null;
    if (nowMs <= decision.alertPublishedAt + this.maxEntryResolutionDelayMs) return null;
    return this.unresolved(decision, reason, nowMs);
  }

  private unresolved(decision: DecisionRecord, reason: EntryUnresolvedReason, resolvedAt: number): EntryResolutionRecord {
    return {
      resolutionStatus: 'UNRESOLVED',
      entryResolutionSchemaVersion: '2',
      entryResolutionId: canonicalEntityHash('ENTRY_RESOLUTION_UNRESOLVED', 2, { decisionId: decision.decisionId, reason }),
      decisionId: decision.decisionId,
      referenceEntryPrice: null,
      referenceEntryTimestamp: null,
      maxEntryResolutionDelayMs: this.maxEntryResolutionDelayMs,
      unresolvedReason: reason,
      resolvedAt,
    };
  }
}
