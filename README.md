# OTC Elite Signal Engine

OTC Elite Signal Engine is a signal-only quantitative research extension for Chrome Manifest V3. It observes Pocket Option OTC reference-feed market data, builds causal market state, evaluates versioned strategies, journals every decision, resolves reference entries/results, exports scientific datasets, and supports deterministic replay.

## Safety boundary

The extension never clicks CALL/PUT, never sends orders, never executes trades, and never represents reference-feed outcomes as realized P&L. Protocol verification and scientific acceptance are performed against Pocket Option DEMO traffic.

Release 1.2.0 contains an empirically verified parser for the exact binary Socket.IO market schema observed on `demo-api-eu.po.market` on 2026-09-12. Matching REAL-account endpoints remain `INFERRED` and therefore fail closed before CALL/PUT.

## Verified protocol

The observed transport is Engine.IO 4 / Socket.IO over WebSocket. Live market data uses a Socket.IO binary event header followed by one binary JSON attachment:

```text
451-["updateStream",{"_placeholder":true,"num":0}]
<binary attachment>
```

The verified `updateStream` attachment is:

```text
[[asset, sourceTimestampSeconds, price]]
```

Payout is delivered independently:

```text
451-["chafor",{"_placeholder":true,"num":0}]
<binary attachment>
```

with attachment:

```text
[[asset, payoutPercent]]
```

`updateHistoryNewFast` is recognized and consumed as a historical bootstrap packet, but it is not converted into live decisions. This prevents historical backfill from generating retrospective live signals.

Only assets ending in `_otc` are admitted into the OTC quantitative pipeline. Non-OTC subscriptions observed on the same WebSocket are rejected.

## Architecture

```text
Pocket Option WebSocket
        ↓
MAIN World interceptor
        ↓
stateful Engine.IO / Socket.IO binary decoder
        ↓
strict updateStream / chafor semantic events
        ↓
ISOLATED World runtime validation + semantic sequencing + batching
        ↓
Service Worker QuantPipeline
        ├── append-only IndexedDB journal
        ├── 5s / 10s / 15s / 30s / 60s candles
        ├── causal Feature Engine
        ├── Structure + Volatility regime detection
        ├── independent strategies
        ├── capped evidence aggregation
        ├── Decision → Entry → Signal → Result
        ├── durable recovery
        ├── reference-feed analytics
        └── scientific dataset export / replay
```

Raw production WebSocket payloads never cross the MAIN → ISOLATED boundary. Semantic sequence numbers are assigned only after a raw frame pair has been successfully decoded into a semantic event, so ignored handshakes, heartbeat frames and historical packets cannot create sequence gaps.

## Protocol modes

### PRODUCTION

Only strict recognized schemas are accepted. Unknown events, malformed binary headers, malformed attachments, unsupported assets and unsupported endpoints fail closed.

### PROTOCOL_DISCOVERY

Discovery emits structural metadata only. It does not persist raw authentication frames, does not create ticks and does not create signals.

## Scientific time model

Every tick preserves:

- `sourceTimestampEpochMs`
- `receivedAtEpochMs`
- `receivedAtMonotonicMs`
- `eventTimestampEpochMs`
- `timestampBasis`
- `sourceClockSynchronized`
- `observedTimestampDeltaMs`
- `transportLatencyMs`

The captured Pocket Option source clock was approximately two hours ahead of the browser receipt clock with a stable offset. That offset is preserved in `observedTimestampDeltaMs`, but it is not called transport latency and it does not invalidate the tick. Until explicit clock synchronization is validated, live causal timing uses `LOCAL_RECEIPT` for `eventTimestampEpochMs`.

## Source verification

The exact binary stream schema observed on `demo-api-eu.po.market` is `VERIFIED`.

The same shape observed on REAL endpoints remains `INFERRED` because the frozen scientific acceptance procedure verifies protocol operation against DEMO. Decisions sourced from `INFERRED` data carry `UNVERIFIED_SOURCE_SCHEMA` and cannot become CALL/PUT signals.

Market identity contains the exact feed host, instrument and parser schema. Entry and expiry resolution fail closed across incompatible feeds.

## Payout semantics

`chafor` is stored as its own immutable payout snapshot. The observed frame does not include an expiry duration, therefore `expirationSeconds` is deliberately `null`; the implementation does not fabricate a 60-second payout scope.

Payout snapshots are keyed by asset and feed. A payout observed on one feed is not silently reused for another feed.

## Quantitative engine

The Feature Engine includes momentum, velocity, acceleration, volatility, candle anatomy, rejection, persistence, tick imbalance, directional sequences, distance, compression, expansion, trend strength, final-seconds behavior, RSI Wilder, EMA, ATR true range, Stochastic, and Bollinger z-score.

Classical indicators are auxiliary features, not standalone strategies. Insufficient warmup returns `null`. Flat RSI after warmup returns `50`.

Strategies are independent and regime-aware: Momentum, Reversal, Exhaustion, Breakout and Rejection. Correlated evidence is grouped into capped evidence families. `modelScore` is not a probability. `calibratedProbability` remains `null` until valid OOS calibration exists.

## Journal and recovery

IndexedDB stores immutable scientific records. Pending work is reconstructed after a Manifest V3 Service Worker restart by set difference:

```text
pending entries = CALL/PUT decisions − decisions with EntryResolutionRecord
pending results = signals − signals with ResultRecord
```

In-memory maps are runtime caches only. IndexedDB schema version 3 prevents legacy tick/payout schemas from mixing with release 1.2.0 records.

## Result semantics

The evaluation mode is `REFERENCE_FEED`.

- `CORRECT` / `INCORRECT` / `FLAT` are directional reference outcomes.
- Reference return is descriptive reference-feed evidence, not realized P&L.
- Flat price does not become a broker refund unless platform settlement is independently verified.
- Missing payout produces `economicReturn = null`.

## Replay and export

Scientific exports contain a versioned manifest, dataset ID, build/app metadata, config hashes, payout snapshots, ticks, candles, decisions, entry resolutions, decision/signal links, signals, results, and SHA-256 checksum.

Replay interleaves payout snapshots and ticks chronologically and sends them through the same `QuantPipeline` used in live mode.

## Development

Requirements: Node.js 20+ and TypeScript 5.8.x.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate:manifest
```

Or:

```bash
npm run verify
```

## Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select `dist/`.
6. Open Pocket Option DEMO.
7. Leave `protocolMode` as `PRODUCTION` for the verified parser or use `PROTOCOL_DISCOVERY` only when investigating a new schema/region.
8. Do not treat another DEMO region or any REAL endpoint as verified without a new captured regression fixture.

## Validation status

Release 1.2.0 validation on 2026-09-12:

- TypeScript strict typecheck: PASS
- Unit/invariant tests: 16/16 PASS
- Manifest/build gate: PASS
- Captured raw DEMO protocol replay through the decoder: 234 price events + 24 payout events
- All captured DEMO price ticks: `VALID`
- All captured DEMO price ticks: `LOCAL_RECEIPT`
- All captured DEMO price ticks: `VERIFIED`
- Captured quantitative integration: 234 ticks, 64 candles, 54 decisions, 4 signals, 2 resolved results within the capture window
- No auto-trading, auto-click or order execution path exists

The original raw capture also contained REAL-account metadata and must not be committed. Use only sanitized DEMO fixtures for documentation or regression work.
