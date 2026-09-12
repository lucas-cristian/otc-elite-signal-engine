# OTC Elite Signal Engine

OTC Elite Signal Engine is a signal-only Chrome Manifest V3 quantitative research extension for Pocket Option OTC reference-feed analysis. It observes market data, builds causal multi-timeframe state, evaluates versioned strategies, journals decisions, resolves reference entries/results, exports scientific datasets, and supports deterministic replay.

## Safety boundary

The extension never clicks CALL/PUT, never sends `openOrder`, never executes a trade, and never reports reference-feed outcomes as realized P&L. Market transport recovery is restricted to authentication of a market-data socket and an explicit whitelist of subscription-only Socket.IO events.

Authentication/session packets used by the recovery socket are ephemeral runtime context. They are not written to IndexedDB, extension storage, logs, datasets, build artifacts, or source control.

## Release 1.8.2

Release 1.8.2 is the final infrastructure hardening pass before longer scientific collection. It does not tune strategy scores, evidence weights, payout rules, or the 15-second continuity threshold.

The release adds:

1. contextual page → shadow primary handoff classification based on transport role, page session, continuity state, feed identity, and monotonic source timestamps instead of a fixed 250 ms cutoff;
2. semantic cross-transport tick deduplication during the handoff using exact feed + instrument + source timestamp + price identity within the frozen 2-second dedupe window;
3. separate STRICT (`expiryTimingErrorMs <= 1000`) and RELAXED (`expiryTimingErrorMs <= 5000`) directional evaluation samples, Wilson intervals, timeframe slices, and contributing-strategy slices;
4. scientific dataset export blocked when the running build has no Git commit provenance, preventing accidental export from the prebuilt sandbox artifact;
5. dashboard build-provenance telemetry so the loaded extension visibly reports build ID, source-tree hash, Git commit, working-tree state, and scientific-export readiness;
6. IndexedDB v11 to prevent mixing v1.8.1 decisions with the new v1.8.2 frozen configuration hash.

A `PRIMARY_TRANSPORT_HANDOFF` is now recognized only for PAGE → SHADOW takeover in the same page session with no pending connection-loss signal and source-timestamp continuity inside the normal 15-second feed-continuity window. Reverse SHADOW → PAGE transitions remain ordinary reconnect evidence.


## Verified protocol

The captured transport is Engine.IO 4 / Socket.IO over WebSocket. Live market data uses a binary Socket.IO header followed by one UTF-8 JSON attachment:

```text
451-["updateStream",{"_placeholder":true,"num":0}]
<binary attachment>
```

Verified `updateStream` attachment:

```text
[[asset, sourceTimestampSeconds, price]]
```

Payout arrives independently through `chafor`:

```text
451-["chafor",{"_placeholder":true,"num":0}]
<binary attachment>
```

with attachment:

```text
[[asset, payoutPercent]]
```

`chafor` does not expose the payout expiration scope in the captured evidence, so payout remains `expirationBinding = UNBOUND` and is excluded from economic return calculations.

## Protocol Verification Registry

`src/common/protocol/protocol-verification-registry.ts` is the frozen source-quality authority. `VERIFIED` requires an exact match on feed host, event kind, Socket.IO event name, parser schema, payload shape, and OTC semantics.

Registry version `2026-09-12.1` contains captured evidence for:

```text
demo-api-eu.po.market
api-us-north.po.market
api-us-south.po.market
```

Unknown `*.po.market` endpoints may be structurally parsed, but remain `INFERRED` and fail closed before CALL/PUT.

## Resilient market transport

The normal path remains:

```text
Pocket Option page WebSocket
        ↓
MAIN World interceptor
        ↓
strict Socket.IO binary decoder
        ↓
semantic market events
        ↓
ISOLATED content script
        ↓ runtime.Port / microtask flush
Service Worker QuantPipeline
```

The recovery path is:

```text
Page observes market endpoint + auth + safe subscriptions
        ↓ ephemeral only
ISOLATED content script
        ↓ runtime.Port
MAIN World native shadow connection + Service Worker supervisor
        ↓
independent wss://*.po.market Socket.IO connection
        ↓
verified updateStream / chafor decoder
        ↓
QuantPipeline
```

Only these outbound subscription events are replayable by the shadow connection:

```text
changeSymbol
subfor
subscribeSymbol   # only *_otc
ps
```

`auth` is allowed only as the captured authentication packet required to authenticate the market socket. It is never considered a replayable subscription. Any event outside the subscription whitelist—including `openOrder`—is rejected.

The shadow connection implements Engine.IO ping/pong handling and automatic reconnect backoff:

```text
1 s → 2 s → 5 s → 10 s → 20 s
```

A market stream with no price for 15 seconds is treated as stalled and reconnected. The regular 30-second extension alarm provides an additional watchdog wake-up path.

The page feed remains a fallback. Once the shadow feed is authenticated, streaming and fresh, duplicate page events for the same feed are ignored. If the active transport changes but observations resume within 15 seconds in the same page session and verified feed identity, the same `feedEpochId` is preserved and the boundary candles are marked `GAP_AFFECTED`. A new epoch is created only when the frozen continuity boundary is truly crossed.

## Feed continuity epochs

A quantitative epoch is scoped by:

```text
canonicalAssetId
feedId
feedEpochId
pageSessionId
```

Connection IDs are transport instances inside an epoch. They are no longer scientific epoch boundaries by themselves.

For a disconnect/reconnect in the same page session and verified feed:

```text
gap <= 15,000 ms
→ preserve feedEpochId
→ append CONNECTION_LOST + SHORT_RECONNECT_GAP evidence
→ mark the candle(s) touching the transport gap as GAP_AFFECTED
→ keep pending results/episodes when still causally resolvable
→ do not perform full warmup reset
```

A hard epoch boundary remains mandatory when:

- the observation gap exceeds 15,000 ms;
- the page session changes;
- a connection loss remains unrecovered beyond the continuity grace threshold;
- the feed/source transition is incompatible with the frozen source identity.

On a hard boundary the runtime writes continuity evidence, invalidates pending work fail-closed, closes active market episodes, resets hot quantitative state, starts a new deterministic `feedEpochId`, marks recovery as gap-affected, and requires fresh warmup.

Feature extraction uses only `CLEAN` closed candles. A `GAP_AFFECTED` boundary candle is journaled for audit but is not silently treated as clean quantitative evidence.

## Data-health watchdog

Health is tracked per `canonicalAssetId + feedId`:

```text
<= 5 s    HEALTHY
<= 15 s   DEGRADED
<= 60 s   STALE
> 60 s    DATA_UNAVAILABLE
```

An explicit continuity break immediately reports `DATA_UNAVAILABLE / CONTINUITY_BROKEN`, even before the age threshold expires.

## Independent market episodes

Raw eligible decisions are not treated as independent samples. Multi-timeframe candidates for the same market episode are arbitrated into one primary operational signal. Correlated and overlapping decisions remain in the scientific journal but are marked suppressed.

The frozen defaults include:

```text
minModelScore = 0.35
expirationSeconds = 60
episodeHorizonMs = 68000
arbitrationConflictScoreMargin = 0.10
```

No threshold is automatically tuned from live outcomes.

## Economic evaluation

Economic evaluation is fail-closed. A directional result can be resolved independently, but economic return is eligible only when a payout is verified and explicitly bound to exactly the signal expiration.

For the currently captured `chafor` schema:

```text
quality = VERIFIED
expirationBinding = UNBOUND
expirationSeconds = null
```

so:

```text
economicOutcome = UNKNOWN
economicReturn = null
```

## Scientific dataset

Dataset schema v8 includes:

- ticks and payout snapshots;
- candles;
- decisions and arbitration metadata;
- entry resolutions, signals and results;
- feed continuity history;
- transport lifecycle/reconnect history;
- asset/feed health at export;
- capture/shadow transport state;
- source-tree SHA-256 and Git HEAD/working-tree state when available;
- canonical dataset checksum and ID.
- STRICT and RELAXED settlement-timing analytics are computed at runtime; the raw result keeps its exact `expiryTimingErrorMs`.

The dataset never contains the shadow authentication packet or account session secret.

## Schema versions

```text
Application              1.8.2
Tick                     v4
Candle                   v4
Decision                 v5
Signal                   v4
PayoutSnapshot           v3
Result                   v3
FeedContinuityEvent      v3
CaptureTransportSnapshot v4
TransportEvent           v3
Dataset                  v8
IndexedDB                v11
```

The IndexedDB v11 bump intentionally clears pre-v1.8.2 runtime records once after upgrade so analytics never mix the old and new frozen configuration hashes.

## Build and validation

Requirements:

```text
Chrome 116+
Node.js 20+
```

Run:

```bash
npm run verify
```

`verify` executes strict TypeScript typecheck, the invariant test suite, deterministic build, and Manifest V3 validation.

Load `dist/` as an unpacked extension through `chrome://extensions`.

## Runtime validation for v1.8

The expected hidden-tab state is:

```text
Shadow market socket: true
Shadow primary feed: true
Shadow state: STREAMING
Shadow circuit open: false
Latest tick age: low
Current operational state: HEALTHY
```

Periodic server-driven shadow reconnects are acceptable when they recover within 15 seconds. They should produce `SHORT_RECONNECT_GAP` continuity evidence while preserving the same feed epoch. The dashboard must not show repeated full warmup resets solely because the Socket.IO transport instance changed.

A reconnect that does not recover within 15 seconds is a hard scientific continuity break and must start a new epoch before new CALL/PUT signals are eligible.
