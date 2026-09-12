# OTC Elite Signal Engine v1.7.0 — Validation Report

Date: 2026-09-12

## Scope

Release 1.7.0 addresses the hidden-tab market-feed interruption observed in the v1.5 dataset and closes the scientific continuity flaw that allowed pre-gap history to influence post-reconnection decisions.

The extension remains signal-only. It contains no order execution, auto-click or `openOrder` sender.

## Implemented changes

### Extension-owned shadow market WebSocket

A new `ShadowMarketConnection` runs in the Manifest V3 Service Worker. It receives ephemeral context from the authenticated Pocket Option page and establishes a separate market-data Socket.IO connection to the observed `*.po.market` endpoint.

The only replayable market subscription events are:

```text
changeSymbol
subfor
subscribeSymbol for *_otc only
ps
```

The page's captured `auth` packet can be sent only as the authentication step for the shadow market socket. It is never journaled, logged, exported or persisted.

Any trade/order event is rejected by the whitelist. Production source contains no `openOrder` sender.

Reconnect backoff:

```text
1 s / 2 s / 5 s / 10 s / 20 s
```

Price silence above 15 seconds triggers shadow stall recovery.

### Chrome lifecycle hardening

- `minimum_chrome_version` is 116.
- WebSocket access is controlled by extension CSP `connect-src wss://*.po.market`.
- Invalid `wss://` Manifest V3 host match patterns are not used.
- The broker tab remains `autoDiscardable = false` when available.
- Page semantic delivery still uses `runtime.Port` + microtask flush and no content-script timer.

### Feed continuity epochs

Every asset/feed runtime now owns a deterministic `feedEpochId`.

A new epoch is forced by:

- explicit connection loss;
- shadow stall;
- connection ID change;
- page session change;
- tick gap above 15 seconds.

The old epoch is closed, pending work is invalidated fail-closed, active market episode state is cleared, quantitative history is reset, and the first recovered candle is `GAP_AFFECTED`.

Fresh warmup requires five CLEAN closed candles before normal quantitative decisions are permitted.

### Scientific audit trail

IndexedDB v7 adds append-only:

- feed continuity events;
- transport lifecycle/reconnect events.

Dataset schema v5 includes these events, reconnect counts, export health and shadow transport status. Authentication/session content is excluded.

## Full verification gate

Command:

```bash
npm run verify
```

Result:

```text
TypeScript strict: PASS
Tests: 31/31 PASS
Build: PASS
Manifest MV3 validation: PASS
```

Test coverage includes:

- binary Socket.IO market parsing;
- exact protocol registry authority;
- deterministic hashing;
- causal entry resolution;
- payout fail-closed semantics;
- per-asset watchdog;
- independent market episodes;
- replay determinism;
- safe shadow subscription whitelist;
- long-gap epoch reset;
- explicit connection-loss invalidation;
- captured-style ws-3 → ws-4 source switch after multi-minute outage.

## Regression against the user's v1.5 dataset

Input dataset:

```text
datasetId: ccb1e2896d74d57ff90ae012832802703aa364c6b840c9724a8137291a621473
input ticks: 1704
```

Observed v1.5 outage:

```text
last pre-gap tick: 1789235400427 / ws-3
first recovered tick: 1789235682355 / ws-4
gap: 281928 ms
```

Reprocessing all 1704 ticks through v1.6 produced:

```text
feed epochs: 2
continuity events: 4
source-switch gap recorded: 281928 ms
previous connection: ws-3
next connection: ws-4
first post-recovery signal delay: 88394 ms
```

This eliminates the v1.5 behavior in which a signal could be emitted only a few seconds after recovery using feature history from before the outage.

## Static integrity scan

```text
explicit any: 0
Math.random(): 0
TODO/FIXME: 0
trade/order sender strings in production src: 0
auth/session references in persistence/export/model layers: 0
content-script timers: 0
raw WebSocket capture or user dataset bundled in project: 0
```

## Build identity

The sandbox build generated:

```text
appVersion: 1.7.0
buildId: source-f24c6369e5b5878e
sourceTreeSha256: f24c6369e5b5878e93913d25cf688de8647f6f71e0de4f84033499586039289d
```

The sandbox checkout has no Git metadata, so its generated `gitCommit` is null. The build script now records Git HEAD whenever it is run inside the user's repository, together with `gitWorkingTreeClean`, while the source-tree SHA-256 remains the exact content identity.

## Remaining empirical runtime gate

The sandbox cannot authenticate a live Pocket Option session, so the extension-owned shadow socket has not been empirically authenticated here. Its state machine is based on the captured Engine.IO 4 / Socket.IO protocol and passes the local invariant suite.

The next DEMO test must confirm:

1. shadow state reaches `STREAMING`;
2. ticks continue while the broker tab is hidden and its own chart becomes idle;
3. a forced/real socket drop produces reconnect events;
4. reconnection creates a new feed epoch and fresh warmup;
5. no order event is sent by the extension.

Until that live DEMO gate passes, shadow transport should be considered implemented and test-validated, but not yet empirically verified against a live authenticated broker session.
