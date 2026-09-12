# OTC Elite Signal Engine

OTC Elite Signal Engine is a signal-only Chrome Manifest V3 quantitative research extension for Pocket Option OTC reference-feed analysis. It observes market data, builds causal multi-timeframe state, evaluates versioned strategies, journals decisions, resolves reference entries/results, exports scientific datasets, and supports deterministic replay.

## Safety boundary

The extension never clicks CALL/PUT, never sends `openOrder`, never executes a trade, and never reports reference-feed outcomes as realized P&L. Market transport recovery is restricted to authentication of a market-data socket and an explicit whitelist of subscription-only Socket.IO events.

Authentication/session packets used by the recovery socket are ephemeral runtime context. They are not written to IndexedDB, extension storage, logs, datasets, build artifacts, or source control.

## Release 1.7.0

Release 1.7.0 adds two protections that are required for unattended data collection:

1. **MAIN-world native shadow market WebSocket** — an independent market-only socket is created in the Pocket Option page context with the native WebSocket constructor, while the Service Worker only supervises health/reconnect commands;
2. **feed continuity epochs** — any disconnect, connection switch, page-session switch, or tick gap above the frozen continuity threshold ends the old quantitative epoch. Candles, features, regimes, pending entry/result work, and active market episodes cannot cross that boundary.

Chrome 116+ is required because resilient WebSockets in extension Service Workers depend on the Chrome 116 lifecycle behavior.

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

The page feed remains a fallback. Once the shadow feed is authenticated, streaming and fresh, duplicate page events for the same feed are ignored. If the shadow feed becomes unavailable, page events can take over, but that transport switch creates a new feed continuity epoch.

## Feed continuity epochs

A quantitative epoch is scoped by:

```text
canonicalAssetId
feedId
feedEpochId
connectionId
pageSessionId
```

A new epoch is mandatory when any of these continuity conditions occurs:

- explicit WebSocket `CLOSE` or `ERROR`;
- shadow socket stall;
- connection ID changes;
- page session changes;
- tick gap > 15,000 ms.

On an epoch boundary the runtime:

- writes continuity evidence to the append-only journal;
- invalidates pending entries/results fail-closed;
- closes the active market episode;
- resets hot tick/candle/feature/regime state;
- starts a new deterministic `feedEpochId`;
- marks the first recovered candle `GAP_AFFECTED`;
- requires at least five fresh `CLEAN` closed candles before quantitative decisions can leave warmup.

Therefore pre-gap history cannot be used to create a post-reconnection signal.

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

Dataset schema v5 includes:

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

The dataset never contains the shadow authentication packet or account session secret.

## Schema versions

```text
Application              1.7.0
Tick                     v4
Candle                   v4
Decision                 v5
Signal                   v4
PayoutSnapshot           v3
Result                   v3
FeedContinuityEvent      v1
CaptureTransportSnapshot v2
TransportEvent           v1
Dataset                  v5
IndexedDB                v7
```

The IndexedDB version bump intentionally clears incompatible pre-1.6 runtime records once after upgrade.

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

## Runtime validation for v1.6

The shadow transport state machine is validated by tests and was built from the captured Pocket Option Engine.IO/Socket.IO protocol. A live authenticated shadow connection still must be verified inside Chrome against the user's Pocket Option DEMO session because the sandbox cannot authenticate to the broker.

Expected dashboard state after successful DEMO validation:

```text
Shadow market socket: true
Shadow state: STREAMING
Shadow endpoint: demo-api-eu.po.market
Current operational state: HEALTHY
```

With the broker tab hidden, ticks should continue increasing even if the broker page's own chart stops updating. If the shadow socket falls, transport events and continuity events must record the outage and reconnect instead of silently joining pre-gap and post-gap observations.
