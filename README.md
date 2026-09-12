# OTC Elite Signal Engine

OTC Elite Signal Engine is a signal-only quantitative research extension for Chrome Manifest V3. It observes Pocket Option OTC reference-feed market data, builds causal market state, evaluates versioned strategies, journals every decision, resolves reference entries/results, exports scientific datasets, and supports deterministic replay.

## Safety boundary

The extension never clicks CALL/PUT, never sends orders, never executes trades, and never represents reference-feed outcomes as realized P&L. Protocol verification is independent from strategy profitability or scientific acceptance.

Release 1.5.0 freezes the exact Socket.IO binary protocol evidence captured on 2026-09-12 for `demo-api-eu.po.market`, `api-us-north.po.market`, and `api-us-south.po.market`. Verification is based on the exact host + event + parser schema + payload shape tuple, not on hostname alone. Unregistered `*.po.market` feeds remain `INFERRED` and fail closed before CALL/PUT.

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

`updateHistoryNewFast` is recognized and consumed as a historical bootstrap packet, but it is not converted into live decisions. Only assets ending in `_otc` are admitted into the OTC quantitative pipeline.

## Protocol Verification Registry

`src/common/protocol/protocol-verification-registry.ts` is the frozen authority for protocol source quality. A market event is `VERIFIED` only when all of the following match a registry entry:

- exact feed host;
- event kind and Socket.IO event name;
- parser schema ID;
- exact payload shape ID;
- OTC market semantics.

Registry version `2026-09-12.1` contains evidence for the captured `updateStream` and `chafor` schemas on:

```text
demo-api-eu.po.market
api-us-north.po.market
api-us-south.po.market
```

Each registry entry contains an evidence ID, verification time, and SHA-256 of the original capture artifact. The raw capture is not distributed because it contains private account metadata. The hash preserves evidence identity without embedding those data in the repository.

An unregistered Pocket Option host may still be structurally parsed, but its `sourceQuality` is `INFERRED`, its `protocolVerificationId` is `null`, and the Decision Engine adds `UNVERIFIED_SOURCE_SCHEMA`.

## Architecture

```text
Pocket Option WebSocket
        ↓
MAIN World interceptor
        ↓
stateful Engine.IO / Socket.IO binary decoder
        ↓
Protocol Verification Registry
        ↓
strict updateStream / chafor semantic events
        ↓
ISOLATED World validation + semantic sequencing + batching
        ↓
Service Worker QuantPipeline
        ├── append-only IndexedDB journal
        ├── wall-clock data-health watchdog
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

Raw production WebSocket payloads never cross the MAIN → ISOLATED boundary. Semantic sequence numbers are assigned only after successful semantic decoding, so ignored handshakes, heartbeat frames and historical packets cannot create sequence gaps.

## Data-health watchdog

Release 1.5.0 separates the current wall-clock health of the feed from the historical state stored on the latest decision. Health changes even if no new tick arrives.

Frozen defaults:

```text
HEALTHY          tick age <= 5 s
DEGRADED         5 s < tick age <= 15 s
STALE            15 s < tick age <= 60 s
DATA_UNAVAILABLE tick age > 60 s
```

Before the first tick, the runtime is `INITIALIZING`; if no tick arrives for more than 60 seconds it becomes `DATA_UNAVAILABLE`.

The dashboard refresh path invokes the watchdog, and a Manifest V3 `chrome.alarms` watchdog runs periodically when the dashboard is not open. Overdue pending entries/results are finalized fail-closed; prolonged missing data at result expiry becomes `DATA_UNAVAILABLE` rather than remaining indefinitely healthy.

## Scientific time model

Every Tick v4 preserves:

- `sourceTimestampEpochMs`;
- `receivedAtEpochMs`;
- `receivedAtMonotonicMs`;
- `eventTimestampEpochMs`;
- `timestampBasis`;
- `sourceClockSynchronized`;
- `observedTimestampDeltaMs`;
- `transportLatencyMs`;
- `sourceQuality`;
- `protocolVerificationId`.

The captured Pocket Option source clock was approximately two hours ahead of the browser receipt clock with a stable offset. That offset is preserved in `observedTimestampDeltaMs`, but it is not called transport latency. Until explicit clock synchronization is validated, causal event time uses `LOCAL_RECEIPT`.

## Payout semantics

`chafor` is stored as an immutable PayoutSnapshot v3 independent of price packets. The observed frame does not identify an expiration duration, therefore:

```text
expirationSeconds = null
expirationBinding = UNBOUND
```

`quality = VERIFIED` means that the `chafor` protocol event and value shape were verified. It does **not** mean that the payout was verified for a 60-second signal. Economic evaluation additionally requires an explicit expiration binding.

Payout snapshots are keyed by asset and feed. Cross-feed payout reuse is prohibited.

## Quantitative engine

The Feature Engine includes momentum, velocity, acceleration, volatility, candle anatomy, rejection, persistence, tick imbalance, directional sequences, distance, compression, expansion, trend strength, final-seconds behavior, RSI Wilder, EMA, ATR true range, Stochastic, and Bollinger z-score.

Strategies are independent and regime-aware: Momentum, Reversal, Exhaustion, Breakout and Rejection. Correlated evidence is grouped into capped evidence families. `modelScore` is not a probability. `calibratedProbability` remains `null` until valid OOS calibration exists.

The default minimum model score remains `0.35`; release 1.5.0 does not lower it to manufacture more signals.

## Journal and recovery

IndexedDB stores immutable scientific records. Pending work is reconstructed after an MV3 Service Worker restart by set difference. Recovery also restores the latest tick used by the health watchdog and the latest feed-scoped payout snapshots.

IndexedDB schema version 5 prevents Tick v4 / Decision v3 / PayoutSnapshot v3 semantics from mixing with older releases.

## Result semantics

The evaluation mode is `REFERENCE_FEED`.

- `CORRECT` / `INCORRECT` / `FLAT` are directional reference outcomes.
- Reference return is descriptive reference-feed evidence, not realized P&L.
- Flat price does not become a broker refund unless platform settlement is independently verified.
- Economic return is fail-closed.
- Payout must be `VERIFIED`, have a non-null `protocolVerificationId`, have an explicit expiration binding, have a non-null expiration, and exactly match the signal expiration.
- Current observed `chafor` snapshots remain `UNBOUND`, so they are not eligible for economic scoring.

## Replay and export

Dataset schema v3 contains source-tree/build provenance, protocol registry version, protocol verification IDs actually used, export-time operational health, tick age at export, config hashes, payout snapshots, ticks, candles, decisions, entries, signals, results and SHA-256 checksum.

Replay interleaves payout snapshots and ticks chronologically through the same `QuantPipeline`. Export/replay finalize pending work through the dataset creation timestamp using the same watchdog semantics.

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
6. Open Pocket Option.
7. Keep `protocolMode` as `PRODUCTION` for frozen schemas; use `PROTOCOL_DISCOVERY` only when investigating an unregistered host/schema.
8. Do not add a new host to the registry without a captured regression artifact.

## Validation status

Release 1.5.0 validation on 2026-09-12:

- TypeScript strict typecheck: PASS
- Unit/invariant tests: 23/23 PASS
- Build: PASS
- Manifest MV3 validation: PASS
- Raw capture registry replay after exact de-duplication:
  - `demo-api-eu.po.market`: 234 verified price events + 24 verified payout events
  - `api-us-north.po.market`: 38 verified price events + 2 verified payout events
  - `api-us-south.po.market`: 127 verified price events + 6 verified payout events
- v1.3.0 real-session dataset regression through v1.4.0 semantics:
  - 692 ticks
  - 140 decisions
  - 18 CALL/PUT decisions without lowering the score threshold
  - 15 CALL / 3 PUT
  - 15 signals on 5s / 3 signals on 10s
  - 18 resolved entries
  - 6 resolved directional results and 12 `DATA_UNAVAILABLE` results after feed loss
  - directional sample 6: 2 correct / 4 incorrect (33.33%); descriptive only and far too small for scientific acceptance
  - economic sample 0 because payout expiration remains explicitly unbound
  - export health `DATA_UNAVAILABLE`, with latest tick age 243.836 seconds
- No auto-trading, auto-click or broker order-execution path exists

Protocol verification is not evidence of trading profitability. Strategy acceptance still requires sufficient OOS/holdout evidence under the frozen scientific protocol.


## Focus-resilient capture (1.5.0)

The ISOLATED transport no longer depends on `setTimeout` for market delivery. Semantic events are delivered through a long-lived `chrome.runtime.Port` and flushed with `queueMicrotask`, so background timer throttling does not delay the market pipeline. The service worker marks source tabs `autoDiscardable = false` and records Chrome tab lifecycle telemetry (`visibility`, `frozen`, `discarded`, transport connection and last semantic event). A truly frozen tab cannot execute page/content-script handlers; in that state the engine fails closed through the per-asset/feed watchdog instead of reporting stale data as healthy.

## Asset/feed health and independent market episodes (1.5.0)

Health is tracked by `(canonicalAssetId, feedId)`. Activity on EURUSD cannot keep EURJPY healthy. Candles are also feed-scoped. Eligible multi-timeframe decisions are arbitrated into a single independent `marketEpisodeId`; one PRIMARY decision can become a signal and correlated/overlapping decisions are retained as NO_TRADE audit records with explicit arbitration blockers. The score threshold remains `0.35`.

Analytics reports raw candidate decisions separately from independent market episodes, plus performance by primary timeframe and contributing strategy.
