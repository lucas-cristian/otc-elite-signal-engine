# OTC Elite Signal Engine v1.8.0 — Validation Report

## Scope

Version 1.8.0 corrects the scientific interpretation of short, server-driven MAIN-world shadow WebSocket reconnects observed in the v1.7 DEMO dataset.

The v1.7 transport is working: the shadow authenticated and streamed while the broker tab was hidden. The remaining defect was that every shadow connection close was treated as an immediate hard feed-epoch loss, even when the next verified market tick arrived only 4–6 seconds later.

## Implemented corrections

- Added `transportRole: PAGE | SHADOW` to connection events so page and shadow transport lifecycle are no longer conflated.
- A page WebSocket close does not break the quantitative feed when the shadow is primary, streaming and fresh.
- A shadow close records a pending connection interruption instead of immediately ending the feed epoch.
- `continuityGapAfterMs = 15000` is now the actual scientific authority for reconnect continuity.
- Recovery in the same page session/feed within 15 seconds keeps the existing `feedEpochId`.
- Short recovery appends `SHORT_RECONNECT_GAP` continuity evidence.
- Only candles touching the gap boundary are marked `GAP_AFFECTED`.
- Feature extraction consumes `CLEAN` closed candles rather than silently using gap-affected candles as clean evidence.
- Pending results are no longer invalidated as `ASSET_FEED_LOST` at the first socket close.
- A connection interruption that remains unrecovered beyond 15 seconds is promoted to a hard epoch break and fails closed.
- MAIN World remains the reconnect authority; the Service Worker no longer issues a second reconnect while MAIN World is already in BACKOFF/handshake.
- Shadow `lastMessageAt` / `lastPriceAt` telemetry is refreshed directly from semantic shadow price events.
- Build provenance detection now records `GIT`, `ENVIRONMENT`, or `UNAVAILABLE`, uses the real Git root, and includes untracked files in dirty-tree detection.

## Real v1.7 dataset regression

Input dataset: `otc-elite-dataset-70139cc59ff3.json`

Input ticks: **2301**

Observed connection transitions and tick gaps:

```text
ws-3 → shadow-main-1       71 ms
shadow-main-1 → -2       6044 ms
shadow-main-2 → -3       5380 ms
shadow-main-3 → -4       6012 ms
shadow-main-4 → -5       5024 ms
shadow-main-5 → -6       4509 ms
shadow-main-6 → -7       4533 ms
```

All seven gaps are below the frozen 15,000 ms continuity boundary.

v1.8 replay result:

```text
ticks:                    2301
feed epochs:                 1
SHORT_RECONNECT_GAP:         7
decisions:                 472
signals:                    14
results:                    13
resolved results:           13
unresolved results:          0
ASSET_FEED_LOST:             0
pending signals at export:   1
```

Directional results produced by this regression are 5 correct and 8 incorrect (38.46%). This is not a profitability claim; it is only a regression result for pipeline behavior.

The key integrity result is that the five `ASSET_FEED_LOST` outcomes caused by short reconnects in v1.7 are no longer created merely because the transport instance changed.

## Test and build gates

```text
TypeScript strict: PASS
Tests: 36/36 PASS
Build MV3: PASS
Manifest validation: PASS

explicit any: 0
Math.random(): 0
TODO/FIXME: 0
content-script setTimeout: 0
openOrder in production src: 0
old Dataset schema v6 refs: 0
old FeedContinuityEvent schema v1 refs: 0
old CaptureTransport schema v3 refs: 0
```

## Schema versions

```text
Application:                 1.8.0
Tick:                        v4
Candle:                      v4
Decision:                    v5
Signal:                      v4
PayoutSnapshot:              v3
Result:                      v3
FeedContinuityEvent:         v2
CaptureTransportSnapshot:    v4
TransportEvent:              v3
Dataset:                     v7
IndexedDB:                   v9
```

## Build identity

Sandbox build:

```text
buildId: source-50355b15ad781108
sourceTreeSha256: 50355b15ad781108c1dd9c6d910bb67221173bf4d6c6fa43a57a003eb3e60359
gitProvenance: UNAVAILABLE
```

The sandbox package has no `.git` directory, so the sandbox build correctly reports Git provenance as unavailable.

After copying the code into the real Git repository, run `npm run verify` locally before loading the extension. The resulting `dist/build-metadata.json` should then report:

```text
gitProvenance: GIT
gitCommit: <local HEAD>
gitWorkingTreeClean: true | false
```

The `sourceTreeSha256` remains the exact compiled-source identity even when the working tree is dirty.

## Remaining empirical check

Keep the DEMO broker tab hidden through multiple periodic shadow reconnects and export a v1.8 dataset. Short reconnects below 15 seconds should preserve one epoch and should not create `ASSET_FEED_LOST`. A true gap above 15 seconds must still break the epoch and require fresh warmup.
