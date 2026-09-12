# OTC Elite Signal Engine — Implemented Architecture and Validation Plan

## Status

Release: **1.8.0**

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

The MAIN World observes ephemeral recovery context from the already-authenticated page and owns the independent native shadow WebSocket. Authentication never crosses into the Service Worker.

The MAIN-world shadow may replay only:

```text
changeSymbol
subfor
subscribeSymbol for *_otc
ps
```

Trade/order events are outside the whitelist and cannot be sent by the MAIN-world shadow market connection.

Auth/session context is MAIN-world memory-only and excluded from the isolated world, Service Worker, storage, journal, logs and dataset export.

Reconnect backoff is 1/2/5/10/20 seconds. MAIN World is the reconnect authority. The Service Worker supervises only a genuinely stale STREAMING socket and never schedules a second reconnect while MAIN World is already in BACKOFF or handshake states.

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

A transport connection ID is not itself an epoch boundary.

Short reconnect policy:

```text
same page session
same verified asset/feed identity
gap <= 15 s
→ same feedEpochId
→ CONNECTION_LOST evidence
→ SHORT_RECONNECT_GAP evidence on recovery
→ mark boundary candles GAP_AFFECTED
→ preserve causally valid pending results
→ no full warmup reset
```

Hard epoch-breaking conditions:

```text
tick/connection gap > 15 s
pageSessionId change
confirmed connection loss beyond grace
incompatible source/feed transition
```

On a hard break:

```text
persist continuity evidence
invalidate pending work fail-closed
invalidate active market episode
reset hot ticks/candles/features/regimes
start new feed epoch
first recovered candle = GAP_AFFECTED
fresh warmup required
```

Feature calculation consumes CLEAN closed candles only; GAP_AFFECTED candles remain in the journal but do not masquerade as clean evidence.

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

IndexedDB v9 stores append-only:

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

## 8. Scientific dataset v7

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

The v1.7 dataset `70139cc59ff3…` contains 2301 ticks collected while the broker tab was hidden and the MAIN-world shadow remained functional.

Observed transport instances:

```text
ws-3
shadow-main-1
shadow-main-2
shadow-main-3
shadow-main-4
shadow-main-5
shadow-main-6
shadow-main-7
```

The measured transport-switch gaps were:

```text
71 ms
6044 ms
5380 ms
6012 ms
5024 ms
4509 ms
4533 ms
```

All are below the frozen 15000 ms continuity threshold.

Replaying all 2301 ticks through v1.8 therefore produces:

```text
feed epochs: 1
SHORT_RECONNECT_GAP events: 7
hard epoch resets from those short reconnects: 0
signals: 14
results resolved by export horizon: 13
ASSET_FEED_LOST caused by those short gaps: 0
```

The same v1.7 runtime had discarded five results as `ASSET_FEED_LOST` because every socket close was treated as a hard epoch break. v1.8 preserves the scientific epoch for short verified reconnects and marks only the gap boundary as affected.

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

Live DEMO validation has already confirmed that the MAIN-world shadow can authenticate, reach `STREAMING`, remain primary while the source tab is hidden, and reconnect repeatedly without namespace rejection.

The remaining v1.8 acceptance test is narrower:

1. load a locally rebuilt v1.8 extension;
2. keep the Pocket Option DEMO tab hidden through multiple periodic server-driven shadow reconnects;
3. confirm the same `feedEpochId` survives reconnects whose measured tick gap is <= 15 seconds;
4. confirm `SHORT_RECONNECT_GAP` appears and only boundary candles become `GAP_AFFECTED`;
5. confirm pending results are not marked `ASSET_FEED_LOST` solely because of those short reconnects;
6. force or observe a gap above 15 seconds and confirm that it still starts a new epoch with fresh warmup;
7. confirm no order event is ever sent by the extension.
