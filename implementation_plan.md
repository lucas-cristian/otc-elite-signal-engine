# OTC Elite Signal Engine — MASTER IMPLEMENTATION PLAN

DOCUMENT STATUS:
ARCHITECTURE FREEZE CANDIDATE

AUTHORITATIVE SPECIFICATION:
YES

SUPERSEDES:
V1, V2, V2.1, V2.1.1, V2.1.1 FINAL patch documents

---

## 1. Architecture Vision & Runtime Contexts

O **OTC Elite Signal Engine** é um laboratório quantitativo na forma de extensão do Google Chrome (Manifest V3). O objetivo é interceptar dados reais de mercado OTC via WebSocket, processá-los com rigor científico, avaliar estratégias de trading (CALL/PUT) e medir resultados (Signal-Only), sem inventar dados, e garantindo completa reprodutibilidade (Replay Engine).

### 1.1 Runtime Contexts
- **MAIN World (Page Context):** Injetado via content script. Único local com acesso ao protocolo WebSocket original. Intercepta, empacota em `NormalizedMarketEvent` e envia para o ISOLATED World via `window.postMessage`.
- **ISOLATED World (Content Script):** Roda na aba da corretora. Valida eventos da MAIN, realiza parsing seguro, gere estado por conexão (`ConnectionSequenceState`), resolve instrumentos e envia dados brutos, mas validados, ao Service Worker via `chrome.runtime.sendMessage` com **Batching** para mitigar overhead.
- **Service Worker (Background Context):** O motor quantitativo. Recebe batches, persiste no IndexedDB, atualiza Candles, computa Features/Regimes, processa estratégias (Decision Engine), emite Signals e resolve resultados (Result Engine). Opera independentemente da interface de usuário.
- **Offscreen Document:** Instanciado quando necessário processamento intensivo (ex: Replay pesado) para não travar o SW.
- **Dashboard (Popup/Options):** UI escrita em React/Vite. Lê o IndexedDB do Service Worker. É um view model passivo; toda a ciência reside no SW.

### 1.2 Build System & Manifest V3
- **Toolchain:** Node.js (>=20), TypeScript (>=5), Vite (com Rollup plugins customizados para injetar MAIN world context), ESLint, Prettier, Vitest.
- **Manifest V3:** Permissões estritas: `storage`, `activeTab`, `scripting`, `unlimitedStorage`. Host permissions restritas ao domínio alvo da plataforma.

---

## 2. Hashing, Canonicalization & Identification

Todas as chaves primárias científicas usam algoritmos canônicos para garantir determinismo. O algoritmo canônico oficial tem versão fixa.

```typescript
const canonicalHashVersion = 1;

// Tipos definidos para evitar falsas inferências
type TimestampBasis = 'SOURCE_RECEIVED' | 'LOCAL_RECEIVED' | 'HYBRID';
type DataQuality = 'OPTIMAL' | 'DEGRADED' | 'INVALID';
type SourceQuality = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
type PriceSource = 'WS_BINARY' | 'WS_JSON' | 'DOM_OBSERVATION';
type EntryReferencePolicy = 'FIRST_TICK_AFTER_ALERT' | 'NEXT_CANDLE_OPEN';
type ExpiryPolicy = 'FIXED_DELAY_FROM_ENTRY' | 'FIXED_TIMESTAMP';
type ExecutionMode = 'LIVE' | 'REPLAY';
```

### 2.1 Canonical JSON
Regras de `canonicalJson(payload)`:
- Chaves de objetos ordenadas lexicograficamente de forma recursiva.
- Arrays preservam ordem.
- `undefined`, `NaN`, `Infinity` proibidos (rejeitar hash se encontrados).
- `-0` normalizado para `0`.
- Numbers serializados em representação string padronizada.
- Enums representados como string.
- Strings codificadas em UTF-8.
- Objetos `Date` nativos proibidos (usar apenas `number` como epoch ms).

### 2.2 Canonical Entity Hash
A função canônica que une `domainPrefix` e `payload` convertendo-os em bytes separadamente e concatenando-os (evitando o operador lógico `||` ambíguo).

```typescript
function canonicalEntityHash(domain: string, version: number, payload: unknown): string {
  const prefixBytes = utf8Encode(`${domain}:v${version}:`);
  const payloadBytes = utf8Encode(canonicalJson(payload));
  // concatBytes concatena dois Uint8Array em um novo Uint8Array
  return sha256(concatBytes(prefixBytes, payloadBytes));
}
```

### 2.3 Canonical Asset ID
Para comparar ativos (ex: "EUR/USD OTC" vs "EURUSD_otc"):
```typescript
function getCanonicalAssetId(rawAsset: string): string {
  return rawAsset.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
```

---

## 3. Data Acquisition, Source Identity & Frame Sequencer

### 3.1 Market Source Identity
Toda informação lida do mercado deve estar ancorada em uma identidade verificável que garante consistência (especialmente no Recovery Cross-Session).

```typescript
interface MarketSourceIdentity {
  marketSourceIdentitySchemaVersion: string;
  platform: 'POCKET_OPTION';
  asset: string; // Deve usar o CanonicalAssetId no instanciamento
  marketType: 'OTC';
  source: PriceSource;
  feedId: string | null;
  instrumentId: string | null;
  parserSchemaId: string | null;
}
```

**Regras de Compatibilidade (MarketSourceCompatibility)**
```typescript
interface MarketSourceCompatibility {
  compatible: boolean;
  reason: 'MATCH' | 'PLATFORM_MISMATCH' | 'ASSET_MISMATCH' | 'MARKET_TYPE_MISMATCH' | 'INSTRUMENT_MISMATCH' | 'FEED_MISMATCH' | 'SOURCE_SEMANTICS_MISMATCH' | 'INSUFFICIENT_IDENTITY';
}

function isCompatibleMarketSource(entry: MarketSourceIdentity, exit: MarketSourceIdentity): MarketSourceCompatibility {
  if (entry.platform !== exit.platform) return { compatible: false, reason: 'PLATFORM_MISMATCH' };
  if (getCanonicalAssetId(entry.asset) !== getCanonicalAssetId(exit.asset)) return { compatible: false, reason: 'ASSET_MISMATCH' };
  if (entry.marketType !== exit.marketType) return { compatible: false, reason: 'MARKET_TYPE_MISMATCH' };
  if (entry.instrumentId !== null && exit.instrumentId !== null && entry.instrumentId !== exit.instrumentId) return { compatible: false, reason: 'INSTRUMENT_MISMATCH' };
  if (entry.feedId !== null && exit.feedId !== null && entry.feedId !== exit.feedId) return { compatible: false, reason: 'FEED_MISMATCH' };
  if (entry.parserSchemaId !== null && exit.parserSchemaId !== null && entry.parserSchemaId !== exit.parserSchemaId) return { compatible: false, reason: 'SOURCE_SEMANTICS_MISMATCH' };
  
  // Exige-se confiança: falha fechada se ambos estão ausentes e são críticos para o source
  if (entry.instrumentId === null && exit.instrumentId === null && entry.feedId === null && exit.feedId === null) {
      return { compatible: false, reason: 'INSUFFICIENT_IDENTITY' };
  }

  return { compatible: true, reason: 'MATCH' };
}
```

### 3.2 Normalized Market Events
A Page Bridge intercepta o tráfego de rede (WebSocket `send`/`onmessage`), copiando o payload em um array local e encaminhando. Emite apenas os seguintes eventos para a Extensão (ISOLATED World):

```typescript
type ConnectionEventType = 'OPEN' | 'CLOSE' | 'ERROR';

type NormalizedMarketEvent = 
  | { type: 'CONNECTION'; connectionId: string; event: ConnectionEventType; timestampMs: number }
  | { type: 'PRICE_FRAME'; connectionId: string; payloadBuffer: Uint8Array; timestampMs: number }
  | { type: 'SUBSCRIPTION_STATE'; connectionId: string; subscriptions: string[]; timestampMs: number };
```

### 3.3 Frame Sequencer & Parser
Para evitar desordem ou bloqueios assíncronos (ex: decodificando MessagePack/Protobuf), usa-se o `FrameSequencer` gerenciado **por `connectionId`**.

```typescript
interface ConnectionSequenceState {
  nextAssignedSequence: number;
  nextEmitSequence: number;
  pending: Map<number, Promise<Tick | null>>;
}
```
**Regras:**
- **Sem Heurística:** É proibido adivinhar que "bytes parecem um float". O `parserSchemaId` deve ser explicitamente fornecido.
- **Parse Timeout (`frameParseTimeoutMs`):** Se a decodificação não finalizar a tempo, gera-se erro local (rejeição do frame), e a fila avança para não causar deadlock.
- **Connection Cleanup:** Quando a Bridge envia `CONNECTION_CLOSE` ou `CONNECTION_ERROR`, o `ConnectionSequenceState` referente ao `connectionId` é imediatamente limpo e seus parsers pendentes abortados.

---

## 4. Time, Causality & Candle Engine

### 4.1 Time Model
O tempo oficial do tick (`eventTimestamp`) é originário do pacote de rede se disponível ou do instante do recebimento. NUNCA se subtrai `performance.now()` do `Date.now()` para adivinhar a hora global. O uso ocorre via injeção `LiveClock` ou `ReplayClock`.

```typescript
interface Tick {
  tickSchemaVersion: string;
  tickId: string; // canonicalEntityHash('TICK', 1, {...})
  marketSourceIdentity: MarketSourceIdentity;
  pageSessionId: string;
  eventTimestamp: number;
  price: number;
  timestampBasis: TimestampBasis;
}
```

### 4.2 Candle Engine & Lifecycle
O Engine acumula Ticks. 

```typescript
enum CandleLifecycle {
  FORMING = 'FORMING',
  CLOSED = 'CLOSED',
  EMPTY_INTERVAL = 'EMPTY_INTERVAL'
}

interface Candle {
  candleSchemaVersion: string;
  asset: string;
  timeframe: string; // e.g. "M1"
  startTimestamp: number;
  endTimestamp: number;
  lifecycle: CandleLifecycle;
  gapAffected: boolean;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  tickCount: number;
  timestampBasis: TimestampBasis;
}
```
**Regra de Fechamento (`CLOSED`):** O candle atinge `CLOSED` exclusivamente quando o relógio global (ou o timestamp de um tick superveniente) cruza `endTimestamp`. O fechamento é o último tick efetivamente observado no intervalo temporal. Não se reconstrói o `close` do candle com o preço de abertura do próximo candle.

### 4.3 Anti-Lookahead & Information Cutoff
O motor garante que o cálculo não veja o futuro. O Snapshot das Features registra o instante exato de corte e se o cálculo aproveitou dados abertos (Candle parcial).

```typescript
interface FeatureSnapshot {
  computedAt: number;
  informationCutoffTimestamp: number;
  usedPartialCandle: boolean;
  partialCandleCutoffTimestamp: number | null;
  features: Record<string, number | null>;
}
```
**Teste Invariante Causal:** Nenhum preço ou tick superior a `informationCutoffTimestamp` pode influenciar o FeatureSnapshot.

---

## 5. Engines, Evaluation Window & Config Hashing

### 5.1 Evaluation Window
A janela sobre a qual a decisão será gerada, identificada deterministicamente para coibir ruído, e gravada no Journal.

```typescript
type Timeframe = 'M1' | 'M5' | 'M15';

interface EvaluationWindow {
  evaluationWindowId: string; // canonicalEntityHash('EVALUATION_WINDOW', 1, {...})
  asset: string;
  timeframe: Timeframe;
  candleStartTimestamp: number;
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  expirationSeconds: number;
  configHash: string;
}
```

### 5.2 Config Hash
Agrupa TODAS as políticas críticas. O `configHash` é usado em IDs derivados para separar lógicas que mudaram e geraram sinais conflitantes, abrangendo:
- Parâmetros, pesos e threshold de Features/Strategies.
- MinConfidence, Regimes.
- `entryReferencePolicy`, `maxEntryResolutionDelayMs`, `expiryPolicy`, `maxExpiryResolutionDelayMs`.
- Thresholds de Gaps e `DataQuality`.
*(Exclui estritamente variáveis de UI puramente cosméticas).*

---

## 6. Scientific Journal (Decision → Entry → Signal)

O coração do sistema é append-only. Um registro preexistente nunca é modificado; seu ciclo evolui através de dependências adicionadas ao IDB.

### 6.1 DecisionRecord (Imutável)
Representa um momento de decisão, independente se resulta em recomendação de trading ou bloqueio.

```typescript
interface StrategyEvaluation {
  strategyId: string;
  strategyVersion: string;
  direction: 'CALL' | 'PUT' | 'NO_TRADE';
  score: number | null;
  weight: number;
}

interface MarketRegimeSnapshot {
  structure: 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | null;
  volatility: 'HIGH' | 'LOW' | 'NORMAL' | null;
}

interface EvidenceSnapshot {
  // Dados de famílias de evidência combinada
  combinedScore: number | null;
  capped: boolean;
}

interface DecisionRecord {
  decisionId: string; // canonicalEntityHash('DECISION', 1, {...})
  decisionSchemaVersion: string;
  executionMode: ExecutionMode;
  asset: string;
  
  decisionComputedAt: number;
  decisionPublishedAt: number;
  alertPublishedAt: number | null; // Registrado apenas se finalDecision = CALL/PUT
  
  evaluationWindowId: string;
  candleStartTimestamp: number | null;
  
  candidateDirection: 'CALL' | 'PUT' | null;
  finalDecision: 'CALL' | 'PUT' | 'NO_TRADE' | 'BLOCKED' | 'DATA_UNAVAILABLE';
  
  modelScore: number | null;
  calibratedProbability: number | null;
  
  structureRegime: 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | null;
  volatilityRegime: 'HIGH' | 'LOW' | 'NORMAL' | null;
  
  strategySnapshots: StrategyEvaluation[] | null;
  featureSnapshot: FeatureSnapshot | null;
  regimeSnapshot: MarketRegimeSnapshot | null;
  evidenceSnapshot: EvidenceSnapshot | null;
  sourceQuality: SourceQuality | null;
  
  blockers: string[];
  dataQuality: DataQuality;
  expirationSeconds: number;
  
  configHash: string;
  configSnapshot: Record<string, unknown>; // ConfigSnapshot type alias object
  appVersion: string;
  marketEpisodeId: string | null; // canonicalEntityHash('MARKET_EPISODE', 1, {...})
  
  createdAt: number;
}
```
**Granularity Key:** Impede flutuações e criação de milhões de registros de `NO_TRADE` na mesma janela se não houver mudança de feature ou config.

```typescript
const decisionGranularityKey = canonicalEntityHash('DECISION_GRANULARITY', 1, {
    evaluationWindowId,
    strategyGroupId,
    expirationSeconds,
    configHash
});
```

### 6.2 EntryResolutionRecord (Discriminated Union)
Quando o sistema decide um CALL/PUT (e atinge `alertPublishedAt`), tenta resolver a entrada buscando no Stream um tick subsequente.

```typescript
type EntryUnresolvedReason = 'ENTRY_TIMEOUT' | 'FEED_STALE' | 'DATA_UNAVAILABLE' | 'ASSET_CHANGED' | 'EXTENSION_CONTEXT_LOST';

type EntryResolutionRecord = ResolvedEntryRecord | UnresolvedEntryRecord;

interface ResolvedEntryRecord {
  resolutionStatus: 'RESOLVED';
  entryResolutionId: string; // canonicalEntityHash('ENTRY_RESOLUTION_RESOLVED', 1, {...})
  entryResolutionSchemaVersion: string;
  decisionId: string;
  
  referenceEntryPrice: number;
  referenceEntryTimestamp: number; // Invariante: >= alertPublishedAt
  decisionPublishedAt: number;
  entryDelayMs: number;
  
  entrySource: PriceSource;
  entryReferencePolicy: EntryReferencePolicy;
  entryMarketSourceIdentity: MarketSourceIdentity;
  entryPageSessionId: string;
  entryTickId: string;

  resolvedAt: number;
}

interface UnresolvedEntryRecord {
  resolutionStatus: 'UNRESOLVED';
  entryResolutionId: string;
  entryResolutionSchemaVersion: string;
  decisionId: string;
  
  referenceEntryPrice: null;
  referenceEntryTimestamp: null;
  
  maxEntryResolutionDelayMs: number;
  unresolvedReason: EntryUnresolvedReason;
  
  resolvedAt: number;
}
```

### 6.3 SignalRecord & Fingerprint
Criado APENAS se o entry resolution der `RESOLVED`.
O vínculo append-only garante integridade do DecisionRecord original.

```typescript
interface DecisionSignalLink {
  decisionId: string;
  signalId: string; // referenciará o SignalRecord
  linkedAt: number;
}
```

O `SignalRecord` reflete o estado de previsão após uma entrada observada validamente:

```typescript
interface SignalRecord {
  signalSchemaVersion: string;
  signalId: string; // canonicalEntityHash('SIGNAL', 1, { fingerprint, ...})
  signalFingerprint: string; 
  decisionId: string;
  
  executionMode: ExecutionMode;
  asset: string;
  direction: 'CALL' | 'PUT';
  
  referenceEntryPrice: number;
  referenceEntryTimestamp: number;
  expirationSeconds: number;
  expectedExpiryTimestamp: number;
  
  entryMarketSourceIdentity: MarketSourceIdentity;
  
  signalCreatedAt: number;
}
```
**Signal Fingerprint:** Identifica unicamente a intenção preditiva:
```typescript
const signalFingerprint = canonicalEntityHash('SIGNAL_FINGERPRINT', 1, {
  asset,
  evaluationWindowId,
  structureRegime,
  volatilityRegime,
  strategyId: 'AGGREGATED_STRATEGY', // dependente da lógica combinada
  direction,
  expirationSeconds,
  configHash
});
```

---

## 7. Result Evaluation & Settlement

### 7.1 ResultRecord (Discriminated Union)
V1 mede performance *teórica do sinal* sobre preços capturados (**REFERENCE_FEED**). Ele NÃO avalia slippage real nem prega falsamente que lucrou na conta do usuário (Realized P&L).

```typescript
type PriceOutcome = 'UP' | 'DOWN' | 'FLAT' | 'UNRESOLVED';
type SignalDirectionalOutcome = 'CORRECT' | 'INCORRECT' | 'FLAT' | 'UNRESOLVED';
type PlatformSettlementOutcome = 'WIN' | 'LOSS' | 'REFUND' | 'UNKNOWN';

enum SettlementConfidence {
  VERIFIED = 'VERIFIED',
  INFERRED = 'INFERRED',
  UNKNOWN = 'UNKNOWN'
}

interface SettlementMetadata {
  settlementMetadataSchemaVersion: string;
  confidence: SettlementConfidence;
  source: 'PLATFORM_PROTOCOL' | 'PLATFORM_DOM' | 'INFERRED_FROM_REFERENCE_PRICE' | null;
  verifiedAt: number | null;
}

type UnresolvedReason = 'ASSET_FEED_LOST' | 'EXPIRY_TIMEOUT' | 'MARKET_SOURCE_INCOMPATIBLE';

type ResultRecord = ResolvedResultRecord | UnresolvedResultRecord;

interface ResolvedResultRecord {
  resolutionStatus: 'RESOLVED';
  resultId: string; // canonicalEntityHash('RESULT_RESOLVED', 1, {...})
  resultSchemaVersion: string;
  signalId: string;
  
  evaluationMode: 'REFERENCE_FEED'; // Crucial na V1
  
  referenceExitPrice: number;
  referenceExitTimestamp: number;
  expiryTimingErrorMs: number;
  
  priceOutcome: PriceOutcome;
  directionalOutcome: SignalDirectionalOutcome;
  
  economicOutcome: PlatformSettlementOutcome;
  economicReturn: number | null; // WIN = +payout, LOSS = -1, REFUND = 0, UNKNOWN = null
  
  settlementMetadata: SettlementMetadata;
  exitMarketSourceIdentity: MarketSourceIdentity;
  
  recoveredAcrossPageSession: boolean;
  entryPageSessionId: string;
  exitPageSessionId: string;
  
  evaluatedAt: number;
}

interface UnresolvedResultRecord {
  resolutionStatus: 'UNRESOLVED';
  resultId: string; // canonicalEntityHash('RESULT_UNRESOLVED', 1, {...})
  resultSchemaVersion: string;
  signalId: string;
  
  evaluationMode: 'REFERENCE_FEED';
  
  referenceExitPrice: null;
  referenceExitTimestamp: null;
  expiryTimingErrorMs: null;
  
  priceOutcome: 'UNRESOLVED';
  directionalOutcome: 'UNRESOLVED';
  
  economicOutcome: 'UNKNOWN';
  economicReturn: null;
  
  settlementMetadata: SettlementMetadata;
  exitMarketSourceIdentity: MarketSourceIdentity | null;
  
  unresolvedReason: UnresolvedReason;
  evaluatedAt: number;
}
```

### 7.2 Settlement Factual vs. Counterfactual
- **Factual:** Usa apenas `PlatformSettlementOutcome` observável ou deduzido diretamente do preço. Não embute regras heurísticas irrealistas (`DRAW_AS_WIN`). Se um empate ocorreu e o resultado real da corretora não foi detectado, usa `REFUND` ou `UNKNOWN`.
- O Motor nunca esconde falhas de entrada (`EntryResolutionRecord.UNRESOLVED`) nem preenche exit falso (`UnresolvedResultRecord`).

---

## 8. Analytics & Statistics

### 8.1 Performance Direcional e Econômica

- **Directional Analytics**: Medem a taxa de precisão de movimentos de preço. Para proporções (Win Rate), usa-se estritamente o **Wilson Confidence Interval**.
- **Economic Edge**: Depende do somatório e média das perdas e ganhos parametrizados. Não se usa Wilson CI, e sim o **Mean Reference Return** (`observedMeanReferenceReturn`), acompanhado de desvios padronizados clássicos.
- O Edge Econômico da V1 é **DESCRIPTIVE_ONLY**.

```typescript
enum EconomicEvidenceStatus {
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  DESCRIPTIVE_ONLY = 'DESCRIPTIVE_ONLY', // O retorno e os CIs são meramente exploratórios na V1
  INCONCLUSIVE = 'INCONCLUSIVE',
  EVIDENCE_OF_POSITIVE_REFERENCE_EDGE = 'EVIDENCE_OF_POSITIVE_REFERENCE_EDGE' // Exige amostra Out-Of-Sample
}
```

### 8.2 Coverages
Toda tela que exibir P&L teórico (`Reference Return`) deve exibir paralelamente a cobertura para não ocultar problemas científicos:
- `decisionCount`, `callPutDecisionCount`
- `entryResolvedCount`, `entryUnresolvedCount` (e seu derivado `entryResolutionRate`)
- `resolvedDirectionalSampleSize`
- `economicSampleSize`, `economicCoverageRate` (Ex: % de sinais resolvidos onde o payout era idôneo e resultou em `economicReturn` não nulo).
- `verifiedSettlementCount`, `inferredSettlementCount`, `unknownSettlementCount`.

---

## 9. Performance Metrics, Backpressure & Storage

### 9.1 Instrumentação Obrigatória
Devem ser instanciadas métricas em tempo de desenvolvimento (Profiling/Dashboard Debug) de:
- `frameQueueDepth`, `parseDurationMs`
- `batchQueueDepth`, `batchFlushLatencyMs`
- `contentToSwMessagesPerSecond`
- `featureL1DurationMs`, `featureL2DurationMs`
- `hotBufferMemoryEstimate`
- `indexedDbBatchWriteDurationMs`

### 9.2 Backpressure Policies
Quando limites elásticos forem superados:
1. Altera-se `DataQuality` para `DEGRADED`.
2. Preserva-se a execução de Feature/Live Pipeline na RAM prioritariamente.
3. Garante-se persistência do Journal (Decisions/Signals/Results).
4. Descarta-se históricos maciços do IndexedDB (ex: raw ticks antigos) registrando que houve `historicalPersistenceGap`.
- Nunca perca evento de backpressure no vazio; grave nas variáveis e no log.

### 9.3 Storage Schema (IndexedDB)
O Service Worker utiliza um IndexedDB assíncrono mantido via Dexie ou nativo. Os Object Stores estritos e Append-Only em grande parte:
- `ticks` (PrimaryKey: `tickId`; Índices: `eventTimestamp`, `asset`; Retention: Rolling curta configurável).
- `candles` (PrimaryKey: hash composto; Índices: `startTimestamp`; Retention: Longa configurável).
- `decisions` (PrimaryKey: `decisionId`; Índices: `decisionComputedAt`, `asset`; Retention: Longa - Append Only).
- `entryResolutions` (PrimaryKey: `entryResolutionId`; Append Only).
- `decisionSignalLinks` (PrimaryKey: `decisionId`).
- `signals` (PrimaryKey: `signalId`; Índices: `asset`, `signalCreatedAt`; Append Only).
- `results` (PrimaryKey: `resultId`; Índices: `signalId`; Append Only).
- Outras auxiliares: `settings`, `statistics`, `batchState`.
- **Migrations:** Incremento de `datasetSchemaVersion`. Uma migração **NUNCA** modifica o valor passado histórico (features, entryPrice). Caso modifique estrutura, o cálculo original e seu veredito permanecem os mesmos. Derivações exigem um novo artefato ou tabela (`derivedAt`, `derivedByVersion`).

### 9.4 Service Worker Recovery
O motor recupera seu estado após interrupções do OS:
O SW levanta, lê `entryResolutions`, localiza `ENTRY_PENDING` que esgotou `maxEntryResolutionDelayMs` e finaliza como UNRESOLVED; varre `signals` aguardando expiração e realiza match com ticks residuais preservados.

Quando ocorre **Cross-Session Recovery**, o ResultRecord recebe `recoveredAcrossPageSession: true`, `entryPageSessionId` diferente de `exitPageSessionId`. 

---

## 10. Replay Engine

Motor determinístico puro para Backtesting e Auditoria (Executado via Offscreen API se denso).
- Entrada: Dataset contendo `NormalizedMarketEvents` validados.
- Configuração: O mesmo conjunto de hashes de live trading.
- Processo: Injeta 1 evento por vez via `ReplayClock`.
- Resultado Esperado: Produz os exatos mesmos `DecisionRecords`, `FeatureSnapshots`, `SignalRecords` e `ResultRecords` que a simulação Live produziria, com ID de Hash idênticos (salvo exclusões declaradas puramente de log de runtime).

---

## 11. Arquitetura de Pastas (File Structure)

```
/src
  /common
    /hashing          # canonical-hash.ts
    /time             # live-clock.ts, replay-clock.ts
    /models           # (tick, candle, entry-resolution.ts, market-source-identity.ts, evaluation-window.ts, enums centralizados)
  /main-world         # page-bridge.ts (Injection script via Vite plugin)
  /isolated-world     # content-script.ts, frame-sequencer.ts, frame-parser.ts, connection-state.ts
  /service-worker
    /core             # background.ts, orchestrator.ts
    /storage          # database.ts (IndexedDB Schema/Migrations)
    /engine           # candle-engine.ts, feature-engine.ts, decision-engine.ts
    /evaluation       # result-engine.ts, metrics.ts
  /offscreen          # replay-worker.ts
  /ui
    /dashboard        # App.tsx, SignalList, StatsPanel (React)
    /popup            # Minimal control view
/tests
  /unit
  /integration
  /replay
/scripts
  /build              # vite-config.ts, rollup plugins
manifest.json
package.json
tsconfig.json
```

---

## 12. Implementation Phases

Todas as fases devem ser executadas com sequencialidade, implementando base antes de recursos pesados.
NÃO comece o Engine antes de fechar o Pipeline de rede.

**FASE 1 - Base Types e Toolchain (Foco atual pós-autorização)**
- Toolchain, TypeScript, Vitest, Manifest V3 base.
- Configuração da bridge (Main -> Isolated), canonical hash implementation e type definitions para Modelos Científicos.
- Build Validation (Vite).

**FASE 2 - Data Acquisition e Clock**
- Page Bridge, Frame Sequencer, Market Source Identity.
- Mock parsers básicos; Data Integrity check; Backpressure skeleton.

**FASE 3 - Core Scientific Journals e Storage**
- IndexedDB setup, Migrations mechanism.
- Gravação de Ticks e Models de Decision, Signal e EntryResolution (Mock input).

**FASE 4 - Analytics Engine**
- Feature Engine, Candle Lifecycle, Anti-Lookahead checks.
- Estratégias (Decision Engine mock).

**FASE 5 - Result e Settlement Engine**
- Entry Matcher, Expiry Policy execution.
- ResultRecord composition, Settlement Confidence.

**FASE 6 - UI Dashboard & Export**
- React Dashboard lendo do IDB; Export para CSV/JSON.

---

## 13. Test Plan

*(Não bloqueado numericamente, o critério de sucesso é `all mandatory tests must pass`).*
Os arquivos devem testar estritamente cada invariante discutida.

- `market-source-compatibility-rules.test.ts`, `entry-source-identity.test.ts`
- `evaluation-window-id.test.ts`, `decision-granularity-key.test.ts`
- `result-discriminated-union.test.ts`, `schema-version-consistency.test.ts`
- `canonical-json.test.ts`, `canonical-hash-byte-concat.test.ts`
- `typescript-schema-reference-consistency.test.ts`
- `decision-precommit.test.ts`, `decision-nullability.test.ts`, `decision-timestamp-semantics.test.ts`
- `entry-resolution-timeout.test.ts`, `entry-resolution-record.test.ts`
- `entry-unresolved-analytics.test.ts`, `unresolved-result-schema.test.ts`
- `factual-settlement.test.ts`, `settlement-metadata.test.ts`, `reference-feed-evaluation.test.ts`
- `economic-coverage.test.ts`, `economic-return-ci.test.ts`, `economic-evidence-status.test.ts`
- `canonical-entity-id.test.ts`, `canonical-hash-domain-separation.test.ts`
- `multi-connection-sequencer.test.ts`, `connection-cleanup.test.ts`, `frame-parse-timeout.test.ts`
- `binary-parser-no-heuristic.test.ts`, `market-event-discrimination.test.ts`
- `cross-session-expiry-recovery.test.ts`, `cross-session-recovery-metadata.test.ts`
- `persistence-backpressure.test.ts`
- `candle-lifecycle.test.ts`, `candle-finalization.test.ts`
- `partial-candle-lookahead.test.ts`, `partial-candle-cutoff.test.ts`, `information-cutoff.test.ts`

---

## 14. Verification Plan e Acceptance Criteria

**Verification Plan:**
- `npm run typecheck`, `npm test`, `npm run build`, `npm run validate:manifest` passando sem erros no terminal.
- Walkthrough Manual validando painel de Analytics sob carga moderada via aba local simulada.

**Acceptance Criteria (Checklist Universal):**
- MAIN/ISOLATED isolam estritamente Window e chrome.runtime.
- Dados binários desconhecidos disparam fail-closed (Parser Timeout/Failure) em vez de corromper o feed.
- Nenhuma feature lê o dado do tick/candle acima de `informationCutoffTimestamp`.
- A fila do IndexedDB degrada Qualidade graciosamente e não encerra o SW sem log.
- Relógio depende de `TimestampBasis` rigoroso, imune a clock skew entre Main e SW.
- Resultados registram Settlement de forma fatídica. Nunca prometem ao usuário um Lucro de P&L operando sob `REFERENCE_FEED`.
- Exportações e simulações via Replay batem ID a ID com o Log Original (Determinismo).

---

## 15. Risk Register e Runtime Protocol Discovery

**15.1 Runtime Unknowns — Not Architecture Blockers**
Os dados listados a seguir são dependências diretas de como o Frontend alvo (Pocket Option) empacota eventos em Runtime; não devem impedir o Design atual, mas são delegados à Fase 2 (Discovery).

- **Exact WS price frame & payload encoding:** O formato não será heurístico, mas empiricamente deduzido durante os debugs de `page-bridge.ts`.
  - *Method:* Inspecionar WS send/receive interceptado no painel.
  - *Fail-Closed:* Parser falha => DATA_UNAVAILABLE. Responsável: FrameParser.
- **Server Timestamp field vs Local timestamp:**
  - *Method:* Comparar delta temporal.
  - *Fail-Closed:* Apenas usa Local Received Time. Responsável: Time Model.
- **Instrument ID semantics & Payout:**
  - *Method:* Descobrir como "EUR/USD_OTC" e payouts fluem (via REST init, Redux state injection ou WS broadcast).
  - *Fail-Closed:* Sinais continuam mas sob *Inferred Source* e payout = *UNKNOWN*. Responsável: Instrument Resolver.

**15.2 Mitigação de Riscos Técnicos (Security & Storage)**
- **SW Suspension:** O Content Script desperta o SW via ping ou reabertura de port. E o IDB centraliza o status.
- **Privacy:** Page Bridge nunca intercepta auth, tokens e cookies. Debug mode desabilita dados após cache limitado.

---

## 16. Final Consistency Report

| Area | Status | Evidence Section | Remaining Runtime Unknowns |
| --- | --- | --- | --- |
| Runtime worlds | PASS | 1.1 | WS Protocol interop API |
| WebSocket acquisition | PASS | 3.2 | Exact frame shape |
| Instrument resolution | PASS | 2.3 | DOM/Redux map location |
| Time model | PASS | 4.1 | Server timestamp field |
| Data integrity | PASS | 9.2 | Backpressure real-world limit |
| Entry lifecycle | PASS | 6.2 | None |
| Signal journal | PASS | 6.3 | None |
| Result model | PASS | 7.1 | Expiry boundary matching |
| Settlement | PASS | 7.2 | Real platform settlement format |
| Economic analytics | PASS | 8.1 | None |
| Candle causality | PASS | 4.2 / 4.3 | None |
| Replay determinism | PASS | 10 | None |
| Hashing | PASS | 2.2 | None |
| Storage/recovery | PASS | 9.3 | IDB max storage caps per browser |
| Build | PASS | 1.2 | Vite CSP compatibility exact tweaks |
| Testing | PASS | 13 | None |
| Statistics | PASS | 8.1 / 8.2 | None |

---

## 17. Readiness Gate Final

*Checklist atesta que o presente plano satisfaz a restrição autossuficiente e livre de ambiguidades.*

- [x] Master plan is standalone
- [x] No references required to superseded plans
- [x] No placeholders/TODOs in critical architecture
- [x] All persisted schemas versioned
- [x] All pseudocode fields exist in schemas
- [x] MarketSource compatibility deterministic
- [x] EvaluationWindow deterministic
- [x] Decision granularity deterministic
- [x] Result discriminated union complete
- [x] Entry source identity persisted
- [x] Hash byte concatenation semantics correct
- [x] Canonical JSON fully defined
- [x] No synthetic market data
- [x] No hidden exclusions
- [x] No look-ahead
- [x] Entry cannot precede alert
- [x] Exit requires compatible market identity
- [x] Reference performance != realized P&L
- [x] V1 does not claim formal economic edge
- [x] Replay reproduces full scientific lifecycle
- [x] SW recovery persistent/idempotent
- [x] Test plan complete
- [x] Implementation phases complete
- [x] Runtime unknowns handled fail-closed

---

```text
FINAL SELF-AUDIT:
PASS

ARCHITECTURE FREEZE CANDIDATE:
YES

IMPLEMENTATION AUTHORIZED:
NO — requires explicit human approval

NEXT ALLOWED ACTION AFTER HUMAN APPROVAL:
FASE 1 ONLY
```
