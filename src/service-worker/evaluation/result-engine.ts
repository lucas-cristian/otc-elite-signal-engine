import { SignalRecord, ResultRecord, PriceOutcome, SignalDirectionalOutcome, PlatformSettlementOutcome, SettlementConfidence } from '../../common/models/journal-types';
import { Tick } from '../../common/models/types';
import { canonicalEntityHash } from '../../common/hashing/canonical-hash';

export type ResultEvaluationResult = 
  | { status: 'RESOLVED'; result: ResultRecord }
  | { status: 'UNRESOLVED'; result: ResultRecord };

export class ResultEngine {
  constructor(private readonly maxTimeoutMs: number = 5000) {}

  public evaluateFromTick(signal: SignalRecord, tick: Tick, nowMs: number): ResultEvaluationResult | null {
    const timeSinceExpiry = tick.eventTimestamp - signal.expectedExpiryTimestamp;

    // Se o tick ainda está no passado (antes do momento da expiração)
    if (tick.eventTimestamp < signal.expectedExpiryTimestamp) {
      // Mas se o relógio global já excedeu o timeout tolerável...
      if (nowMs - signal.expectedExpiryTimestamp > this.maxTimeoutMs) {
        return this.createUnresolved(signal, nowMs, 'EXPIRY_TIMEOUT');
      }
      return null; // Continua esperando
    }

    // Se o tick chegou depois do expectedExpiryTimestamp, mas excedeu maxTimeoutMs, consideramos falha de feed?
    // Depende. Se o tempo da corretora apenas demorou um pouco, usamos o primeiro tick que cruzou a linha.
    // Mas se o tick que cruzou a linha ocorreu muito além do tempo, pode ser um feed stale.
    if (timeSinceExpiry > this.maxTimeoutMs) {
       return this.createUnresolved(signal, nowMs, 'EXPIRY_TIMEOUT');
    }

    // Resolve o resultado
    let priceOutcome: PriceOutcome = 'FLAT';
    if (tick.price > signal.referenceEntryPrice) priceOutcome = 'UP';
    else if (tick.price < signal.referenceEntryPrice) priceOutcome = 'DOWN';

    let directionalOutcome: SignalDirectionalOutcome = 'FLAT';
    let economicOutcome: PlatformSettlementOutcome = 'REFUND';
    let economicReturn: number = 0.0;

    // Avaliação Factual (Fase 1 usa Inferred from Reference Price)
    // Se o sinal era CALL e subiu -> CORRECT
    if (signal.direction === 'CALL') {
      if (priceOutcome === 'UP') {
        directionalOutcome = 'CORRECT';
        economicOutcome = 'WIN';
        economicReturn = 0.8; // TODO: Payout parametrizável depois (Fase 8)
      } else if (priceOutcome === 'DOWN') {
        directionalOutcome = 'INCORRECT';
        economicOutcome = 'LOSS';
        economicReturn = -1.0;
      }
    } else if (signal.direction === 'PUT') {
      if (priceOutcome === 'DOWN') {
        directionalOutcome = 'CORRECT';
        economicOutcome = 'WIN';
        economicReturn = 0.8;
      } else if (priceOutcome === 'UP') {
        directionalOutcome = 'INCORRECT';
        economicOutcome = 'LOSS';
        economicReturn = -1.0;
      }
    }

    const resultId = canonicalEntityHash('RESULT_RESOLVED', 1, {
      signalId: signal.signalId,
      referenceExitTimestamp: tick.eventTimestamp
    });

    const result: ResultRecord = {
      resolutionStatus: 'RESOLVED',
      resultId,
      resultSchemaVersion: '1',
      signalId: signal.signalId,
      
      evaluationMode: 'REFERENCE_FEED',
      
      referenceExitPrice: tick.price,
      referenceExitTimestamp: tick.eventTimestamp,
      expiryTimingErrorMs: timeSinceExpiry, // Erro temporal entre a expiração teórica e o tick capturado
      
      priceOutcome,
      directionalOutcome,
      
      economicOutcome,
      economicReturn,
      
      settlementMetadata: {
        settlementMetadataSchemaVersion: '1',
        confidence: SettlementConfidence.INFERRED,
        source: 'INFERRED_FROM_REFERENCE_PRICE',
        verifiedAt: nowMs
      },
      
      exitMarketSourceIdentity: tick.marketSourceIdentity,
      
      recoveredAcrossPageSession: false, // Pode ser alterado se carregado do disco
      entryPageSessionId: signal.entryMarketSourceIdentity.platform, // O Signal não guarda session. Na verdade, precisamos passar isso. Wait, schema?
      exitPageSessionId: tick.pageSessionId,
      
      evaluatedAt: nowMs
    };

    // Fix: O EntryPageSessionId deveria vir do entry resolution original.
    // Na estrutura atual o SignalRecord não tem isso diretamente, mas podemos preencher com empty string para mock,
    // ou idealmente ler do EntryResolutionRecord se precisarmos em Fases avançadas.
    // Para resolver type compliance, vamos assumir 'unknown' se não temos na mão.
    (result as any).entryPageSessionId = 'unknown'; 

    return { status: 'RESOLVED', result };
  }

  private createUnresolved(signal: SignalRecord, nowMs: number, reason: 'EXPIRY_TIMEOUT'): ResultEvaluationResult {
    const resultId = canonicalEntityHash('RESULT_UNRESOLVED', 1, {
      signalId: signal.signalId,
      nowMs
    });

    const result: ResultRecord = {
      resolutionStatus: 'UNRESOLVED',
      resultId,
      resultSchemaVersion: '1',
      signalId: signal.signalId,
      
      evaluationMode: 'REFERENCE_FEED',
      
      referenceExitPrice: null,
      referenceExitTimestamp: null,
      expiryTimingErrorMs: null,
      
      priceOutcome: 'UNRESOLVED',
      directionalOutcome: 'UNRESOLVED',
      
      economicOutcome: 'UNKNOWN',
      economicReturn: null,
      
      settlementMetadata: {
        settlementMetadataSchemaVersion: '1',
        confidence: SettlementConfidence.UNKNOWN,
        source: null,
        verifiedAt: null
      },
      
      exitMarketSourceIdentity: null,
      unresolvedReason: reason,
      evaluatedAt: nowMs
    };

    return { status: 'UNRESOLVED', result };
  }
}
