# OTC Elite Signal Engine — Implemented Architecture and Validation Plan

## Status

Code remediation implemented in sandbox on 2026-09-12.

Scientific runtime status: **FAIL-CLOSED PENDING POCKET OPTION DEMO PROTOCOL VERIFICATION**.

The implementation must not be described as protocol-verified until the exact Pocket Option WebSocket schemas are observed and validated in a DEMO account. `protocolSchemaVerified` defaults to `false`, which prevents CALL/PUT decisions from becoming actionable signals.

## 1. Runtime boundaries

### MAIN World

`src/main-world/page-bridge.ts` is the only component that intercepts the page WebSocket. In `PRODUCTION`, it parses frames using strict versioned Pocket Option schemas and forwards only semantic market events. Unknown or malformed frames are rejected. Raw payload bytes are not transported to the extension runtime.

In `PROTOCOL_DISCOVERY`, the bridge emits bounded redacted/structural observations and does not create market ticks.

### ISOLATED World

`src/isolated-world/content-script.ts` validates semantic events, preserves per-connection order, creates deterministic validated ticks, carries payout snapshots, batches observations, and forwards them to the Service Worker.

### Service Worker

`src/service-worker/core/quant-pipeline.ts` is the shared scientific pipeline used by live execution and replay. It persists evidence before causal entry resolution and treats IndexedDB as the authority for restart recovery.

## 2. Deterministic identity and time

Canonical scientific IDs use versioned domain-separated SHA-256 over canonical JSON.

Tick fields preserve:

```text
sourceTimestampEpochMs
receivedAtEpochMs
receivedAtMonotonicMs
eventTimestampEpochMs
timestampBasis
observedTimestampDeltaMs
transportLatencyMs
```

`transportLatencyMs` remains `null` because source and local clocks are not assumed synchronized.

Tick IDs contain no random component. Source timestamps are normalized only by parser schemas that explicitly define their unit. Implausible timestamps are rejected instead of guessed.

## 3. Market source compatibility

`MarketSourceIdentity` includes platform, canonical asset, market type, source semantics, instrument ID, optional feed ID, and parser schema ID.

Compatibility is symmetric and fail-closed. If one side has a feed ID and the other does not, compatibility is `INSUFFICIENT_IDENTITY`. Instrument and parser schema are mandatory.

## 4. Scientific timeframes and candles

Supported timeframes are exactly:

```text
5s
10s
15s
30s
60s
```

Candles never carry forward a price into an empty interval. Empty intervals have null OHLC. The prior candle closes with its last real tick; a tick from the following interval is never used as an artificial close.

## 5. Features, regimes and strategies

The Feature Engine computes causal feature families using only observations before the information cutoff. It includes momentum, velocity, acceleration, volatility, candle anatomy, rejection, persistence, tick imbalance, directional sequences, price distance, compression, expansion, trend strength, final-seconds behavior, RSI Wilder, EMA, ATR, Stochastic and Bollinger z-score.

Warmup is per feature/strategy. Missing data remains `null`.

Structure regime:

```text
TREND_UP
TREND_DOWN
RANGE
CHAOTIC
UNKNOWN
```

Volatility regime:

```text
LOW
NORMAL
HIGH
UNKNOWN
```

CHAOTIC and UNKNOWN states fail closed.

Independent strategies:

```text
MomentumStrategy
ReversalStrategy
ExhaustionStrategy
BreakoutStrategy
RejectionStrategy
```

Evidence is grouped by family with deterministic caps. `modelScore` is distinct from probability. `calibratedProbability` is statically `null`.

## 6. Decision identity

Evaluation windows are SHA-256 canonical entities containing asset, timeframe, candle start, window boundaries, expiry and config hash.

Decision granularity is canonical and uses the versioned strategy group, evaluation window, expiry and config hash.

Signal fingerprints use only concrete deterministic fields.

## 7. Causal entry and payout snapshot

Decision records are persisted before becoming pending entries. Entry resolution only accepts the first valid matching tick whose event timestamp is greater than or equal to `alertPublishedAt` and inside `maxEntryResolutionDelayMs`.

Signals are created only after a resolved entry. Every signal carries an immutable `PayoutSnapshot`; missing payout remains explicit as unknown.

## 8. Result model

Resolved and unresolved results are separate discriminated unions. A resolved result cannot hold `UNRESOLVED` outcomes.

Flat price produces directional `FLAT`. It never invents a broker refund. Without verified settlement, economic outcome is `UNKNOWN` and economic return is null.

Reference-feed settlement inference is labeled `INFERRED`, not realized P&L.

## 9. Durable MV3 recovery

Service Worker recovery derives pending work from journal set differences rather than transient process memory. Timeouts are finalized idempotently on recovery.

## 10. Analytics

Analytics expose decision count, CALL/PUT count, entry resolution coverage, resolved directional sample size, directional accuracy with Wilson interval, economic sample size, economic coverage, settlement confidence counts, and observed mean reference return.

Economic evidence remains `DESCRIPTIVE_ONLY` in V1 and is never promoted to proof of edge by win-rate alone.

## 11. Replay and export

Scientific datasets include:

```text
datasetSchemaVersion
datasetId
createdAt
appVersion
buildId
gitCommit
configHashes
checksumSha256
ticks
payoutSnapshots
candles
decisions
entryResolutions
decisionSignalLinks
signals
results
```

Replay validates the checksum and processes one tick at a time through the same `QuantPipeline`. Tests assert deterministic decision IDs between live simulation and replay.

## 12. Build and acceptance gates

Scripts:

```text
npm run typecheck
npm test
npm run build
npm run validate:manifest
npm run verify
```

Sandbox result on 2026-09-12:

```text
typecheck: PASS
tests: 12/12 PASS
build: PASS
manifest validation: PASS
zero-any scan: PASS
Math.random scan: PASS
placeholder/TODO/FIXME scan: PASS
old timeframe scan: PASS
```

## 13. External DEMO acceptance gate

Still required outside the current sandbox:

1. Load `dist/` as an unpacked Chrome extension.
2. Sign in to Pocket Option with a DEMO account only.
3. Confirm DEMO balance visually before any protocol inspection.
4. Use `PROTOCOL_DISCOVERY` to observe schema structure without persisting sensitive payloads.
5. Verify exact price, instrument, timestamp and payout schemas against live DEMO traffic.
6. Add/adjust versioned parser schemas only from observed evidence.
7. Run a schema-specific regression fixture.
8. Set `protocolSchemaVerified` only for a schema/version that passed those checks.
9. Confirm Production emits real semantic ticks and rejects unknown frames.
10. Confirm no order execution, auto-click or auto-trading path exists.

Until this gate is complete, CALL/PUT remains fail-closed by design.
