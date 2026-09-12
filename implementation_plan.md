# OTC Elite Signal Engine — Implemented Architecture and Validation Plan

## Status

Release: **1.3.0**

Scientific runtime status: **DEMO BINARY MARKET SCHEMA VERIFIED FOR `demo-api-eu.po.market`; OTHER FEEDS FAIL CLOSED**.

The exact Engine.IO 4 / Socket.IO binary schema used by the Pocket Option DEMO endpoint was captured and validated on 2026-09-12. Verification is scoped to the observed endpoint and exact parser schemas; it is not generalized to REAL endpoints or unobserved DEMO regions.

## 1. Verified WebSocket transport

Observed price sequence:

```text
451-["updateStream",{"_placeholder":true,"num":0}]
<binary UTF-8 JSON attachment>
```

Attachment:

```text
[[asset, sourceTimestampSeconds, price]]
```

Observed payout sequence:

```text
451-["chafor",{"_placeholder":true,"num":0}]
<binary UTF-8 JSON attachment>
```

Attachment:

```text
[[asset, payoutPercent]]
```

Observed history bootstrap:

```text
451-["updateHistoryNewFast",{"_placeholder":true,"num":0}]
<binary attachment containing asset, period, history and candles>
```

Historical bootstrap packets are consumed but do not generate retrospective live decisions.

## 2. MAIN World

`src/main-world/page-bridge.ts` intercepts only Pocket Option `*.po.market` WebSockets. Each connection owns a stateful `PocketOptionSocketIoDecoder` and a serialized inbound promise chain so Blob decoding cannot reorder WebSocket frames.

Semantic sequence numbers are assigned only after successful semantic decoding. Engine.IO handshakes, heartbeat frames, unknown events and historical bootstrap frames therefore do not create downstream sequence gaps.

PRODUCTION forwards only semantic price/payout events. PROTOCOL_DISCOVERY forwards structural metadata only.

## 3. Strict parser and source identity

`src/common/protocol/pocket-option-parser.ts`:

- accepts the captured `451-` one-attachment form;
- requires the exact Socket.IO placeholder structure;
- decodes Blob, ArrayBuffer and ArrayBufferView attachments;
- accepts only finite positive price values;
- accepts only `_otc` assets into the OTC pipeline;
- attaches feed host and parser schema to `MarketSourceIdentity`;
- marks only `demo-api-eu.po.market` + frozen observed schemas as `VERIFIED`;
- marks matching REAL/unfrozen feeds `INFERRED`;
- rejects malformed or unknown structures instead of guessing.

## 4. Clock model

The captured source clock was approximately two hours ahead of browser receipt time with a stable offset. The model therefore preserves both clocks but treats them as unsynchronized:

```text
sourceTimestampEpochMs = observed platform timestamp
receivedAtEpochMs = browser epoch receipt time
eventTimestampEpochMs = receivedAtEpochMs
timestampBasis = LOCAL_RECEIPT
sourceClockSynchronized = false
observedTimestampDeltaMs = receivedAtEpochMs - sourceTimestampEpochMs
transportLatencyMs = null
```

A stable unsynchronized offset does not by itself mark an otherwise valid tick `SUSPECT`.

## 5. Payout model

`chafor` produces an immutable `PayoutSnapshot` independent of price packets.

The observed frame does not identify an expiration duration, therefore:

```text
expirationSeconds = null
```

Payout is keyed by canonical asset + feed. Cross-feed payout reuse is prohibited.

## 6. ISOLATED World

The content script validates semantic price and payout events, maintains per-connection semantic order, batches them and sends them to the Service Worker. Raw WebSocket bytes never cross the production MAIN → ISOLATED boundary.

The PageBridge is installed before the asynchronous storage lookup for protocol mode, preventing the mode lookup from delaying WebSocket interception.

## 7. Quantitative pipeline

The Service Worker processes price and payout as separate chronological event types. Price events create Tick v3 records. Payout events update immutable journal state and the current feed-scoped payout cache.

Source quality is carried by each Tick. Decision source quality is no longer a global boolean; it is derived from the actual feed/schema that produced the observation.

A REAL endpoint with an otherwise matching schema remains `INFERRED` and is blocked by `UNVERIFIED_SOURCE_SCHEMA`.

## 8. Scientific timeframes and features

Supported timeframes remain exactly:

```text
5s
10s
15s
30s
60s
```

Empty intervals have null OHLC. No synthetic carry-forward is permitted.

Causal feature families, regime detection, five independent strategies, evidence-family caps, deterministic decision IDs, `modelScore` semantics and `calibratedProbability = null` remain unchanged from the scientific remediation baseline.

## 9. Recovery, results and replay

MV3 recovery continues to derive pending entries/results from append-only journal set differences.

Replay now interleaves payout snapshots and ticks by capture time and sends both through the same `QuantPipeline` used live.

IndexedDB version is bumped to 4 to prevent pre-1.3.0 result semantics from mixing with fail-closed economic evaluation.

## 9A. Fail-closed economic evaluation and reproducible export

Directional reference evaluation remains independent from payout. Economic evaluation is eligible only when the immutable payout snapshot is `VERIFIED`, has a non-null `expirationSeconds`, and exactly matches the signal expiration. The observed `chafor` schema does not carry expiration scope, so those snapshots remain scientifically ineligible for economic return.

Result schema v3 records an explicit `economicEvaluationReason`. Dataset schema v2 records deterministic source-tree SHA-256, build ID, optional clean-checkout Git SHA and clean/unknown Git state. Live export and replay finalize pending timeout state through the dataset creation timestamp.

The dashboard exposes live tick/candle telemetry, source quality, feed, latest price, payout scope, regime, blockers and pending entry/result counts.

## 10. Validation gates

```text
npm run typecheck
npm test
npm run build
npm run validate:manifest
npm run verify
```

Release 1.3.0 sandbox result:

```text
typecheck: PASS
tests: 18/18 PASS
captured DEMO raw protocol decoder replay: PASS
captured price semantic events: 234
captured payout semantic events: 24
captured quantitative ticks: 234
captured candles: 64
captured decisions: 54
captured signals: 4
captured resolved results within capture window: 2
all captured ticks integrity: VALID
all captured ticks timestampBasis: LOCAL_RECEIPT
all captured ticks sourceQuality: VERIFIED
```

## 11. Verification boundary

The following are verified:

- `demo-api-eu.po.market`
- `POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1`
- `POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1`
- exact `updateStream` attachment shape observed on 2026-09-12
- exact `chafor` attachment shape observed on 2026-09-12

The following remain fail-closed until separately captured and frozen:

- other DEMO regions;
- REAL endpoints;
- changed Socket.IO attachment counts;
- changed event names;
- changed payload layouts;
- any source-clock synchronization assumption.

No auto-trading, auto-click, order submission or broker execution path is part of the project.
