# OTC Elite Signal Engine — Implemented Architecture and Validation Plan

## Status

Release: **1.6.0**

Protocol registry: **2026-09-12.1**

Runtime objective: maintain signal-only OTC market observation without depending on a focused broker tab, while preserving strict scientific continuity boundaries and never executing orders.

## 1. Production transport

### Primary page transport

```text
Pocket Option page WebSocket
→ MAIN interceptor
→ Socket.IO binary decoder
→ semantic event
→ ISOLATED validation/sequencing
→ runtime.Port
→ Service Worker
```

The ISOLATED route uses microtask flushing and no page timer for market delivery.

### Shadow market transport

The Service Worker receives ephemeral recovery context from the already-authenticated page:

```text
market endpoint
auth packet
safe subscription packets
```

It opens an independent market WebSocket and performs the observed Engine.IO/Socket.IO handshake. It may replay only:

```text
changeSymbol
subfor
subscribeSymbol for *_otc
ps
```

Trade/order events are outside the whitelist and cannot be sent by `ShadowMarketConnection`.

Auth/session context is memory-only and excluded from storage, journal, logs and dataset export.

Reconnect backoff is 1/2/5/10/20 seconds. A 15-second price silence is a stall. Chrome 116+ is required for resilient extension Service Worker WebSockets.

## 2. Protocol authority

Verification requires the frozen tuple:

```text
feed host
+ event kind
+ Socket.IO event name
+ parser schema ID
+ payload shape ID
+ OTC semantics
```

Verified captured hosts:

```text
demo-api-eu.po.market
api-us-north.po.market
api-us-south.po.market
```

Unknown feeds remain `INFERRED` and fail closed.

## 3. Feed continuity

Every asset/feed owns a deterministic `feedEpochId`.

Epoch-breaking conditions:

```text
explicit CLOSE / ERROR
shadow stall
connection ID change
pageSessionId change
tick gap > 15 s
```

On break:

```text
persist continuity event
invalidate pending entry/result
invalidate active market episode
reset hot ticks/candles/features/regimes
start new feed epoch
first recovered candle = GAP_AFFECTED
fresh warmup required
```

The model requires five fresh CLEAN closed candles before leaving warmup. No pre-gap feature history may cross an epoch.

## 4. Health authority

Health is per asset + feed, not global:

```text
<= 5 s    HEALTHY
<= 15 s   DEGRADED
<= 60 s   STALE
> 60 s    DATA_UNAVAILABLE
```

`continuityBroken = true` overrides age and immediately reports `DATA_UNAVAILABLE / CONTINUITY_BROKEN`.

## 5. Multi-timeframe episode arbitration

Timeframes:

```text
5s / 10s / 15s / 30s / 60s
```

Raw candidates are journaled, but correlated/overlapping decisions share one `marketEpisodeId`. Only a `PRIMARY` arbitration result may become a signal. Near-tied opposite directions fail closed as conflict.

Frozen defaults:

```text
minModelScore = 0.35
expirationSeconds = 60
arbitrationConflictScoreMargin = 0.10
episodeHorizonMs = 68000
continuityGapAfterMs = 15000
```

## 6. Payout/economic semantics

`chafor` is verified as a payout value event but does not bind the value to an expiration in the observed protocol:

```text
quality = VERIFIED
expirationBinding = UNBOUND
expirationSeconds = null
```

Economic return therefore remains unavailable. Directional reference evaluation is separate from economic eligibility.

## 7. Persistence and recovery

IndexedDB v7 stores append-only:

```text
ticks
payout snapshots
candles
decisions
entry resolutions
decision-signal links
signals
results
feed continuity events
transport events
```

Runtime pending maps are caches only. Startup recovery derives unresolved work from the journal and refuses to resolve records across mismatched feed epochs.

## 8. Scientific dataset v5

Export includes all quantitative records plus:

```text
continuityEvents
transportEvents
reconnectEventCount
assetFeedHealthAtExport
captureTransportAtExport
sourceTreeSha256
gitCommit when Git HEAD is available
gitWorkingTreeClean
checksumSha256
datasetId
```

Authentication/session packets are never exported.

## 9. Latest real-dataset regression

The v1.5 dataset `ccb1e2896d74…` contained the observed hidden-tab interruption:

```text
last old tick: 1789235400427 / ws-3
first recovered tick: 1789235682355 / ws-4
gap: 281928 ms
```

Replaying all 1704 ticks through v1.6 produced two feed epochs. The source switch recorded the exact 281928 ms gap. The first post-recovery signal appeared 88394 ms after the recovered epoch began, rather than roughly 3 seconds after recovery as in v1.5.

This validates fresh warmup and prevents pre-gap features from leaking across the outage.

## 10. Validation gates

Before release:

```text
npm run typecheck
npm test
npm run build
npm run validate:manifest
```

Required static invariants:

```text
explicit any = 0
Math.random = 0
TODO/FIXME = 0
order/trade event sender in production source = 0
content-script market setTimeout = 0
auth/session persistence in journal/export = 0
```

## 11. Remaining empirical gate

The sandbox can validate code, replay captured data and verify protocol state machines, but it cannot authenticate a live Pocket Option browser session. Therefore live DEMO validation of the extension-owned shadow WebSocket is still required.

The empirical acceptance condition is:

1. log into Pocket Option DEMO;
2. verify shadow state reaches `STREAMING`;
3. leave the broker tab hidden long enough that its chart would previously stop;
4. confirm shadow ticks remain fresh and counters keep growing;
5. if a socket is deliberately interrupted, confirm reconnect transport events and a new feed epoch are recorded;
6. confirm no order event is ever sent by the extension.
