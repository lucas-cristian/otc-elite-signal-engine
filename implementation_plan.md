# OTC Elite Signal Engine — Implemented Architecture and Validation Plan

## Status

Release: **1.4.0**

Protocol registry: **2026-09-12.1**

Scientific runtime status: exact captured Socket.IO binary schemas are verified only through frozen registry evidence; unregistered feeds fail closed.

## 1. Protocol authority

The runtime no longer equates DEMO hostname with verification. `protocol-verification-registry.ts` requires the exact tuple:

```text
feed host
+ event kind
+ Socket.IO event name
+ parser schema ID
+ payload shape ID
+ OTC market semantics
```

Frozen captured hosts:

```text
demo-api-eu.po.market
api-us-north.po.market
api-us-south.po.market
```

Frozen event schemas:

```text
updateStream -> POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1 -> OTC_STREAM_TRIPLE_V1
chafor       -> POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1 -> OTC_PAYOUT_PAIR_V1
```

Each registry record stores verification ID, evidence time and capture SHA-256. Unregistered hosts remain `INFERRED` even if they parse structurally.

## 2. Market protocol

Price sequence:

```text
451-["updateStream",{"_placeholder":true,"num":0}]
<binary UTF-8 JSON attachment>
```

Attachment:

```text
[[asset, sourceTimestampSeconds, price]]
```

Payout sequence:

```text
451-["chafor",{"_placeholder":true,"num":0}]
<binary UTF-8 JSON attachment>
```

Attachment:

```text
[[asset, payoutPercent]]
```

Historical bootstrap remains non-causal for live signals.

## 3. Tick and source semantics

Tick schema v4 adds `protocolVerificationId`. VERIFIED source quality is valid only with a non-null registry evidence ID. The decision record (schema v3) stores the source protocol verification ID used at decision time.

Pocket Option source time remains unsynchronized from browser epoch in the captured evidence, so `LOCAL_RECEIPT` remains the causal event time and transport latency remains null.

## 4. Data-health watchdog

The old latest-decision health display was insufficient because it could remain `HEALTHY` forever after the feed stopped. Release 1.4.0 adds wall-clock health independent from market arrival:

```text
<= 5 s   HEALTHY
<= 15 s  DEGRADED
<= 60 s  STALE
> 60 s   DATA_UNAVAILABLE
```

The watchdog runs on analytics refresh/export and through `chrome.alarms`. Pending entry/result deadlines are processed even when no market tick arrives. `FEED_STALE` and `DATA_UNAVAILABLE` are therefore real terminal reasons rather than unreachable enum values.

## 5. Payout binding

PayoutSnapshot schema v3 separates protocol verification from expiration binding:

```text
quality = VERIFIED        # observed chafor schema/value is verified
expirationBinding = UNBOUND
expirationSeconds = null  # current captured chafor does not expose scope
```

Future eligibility requires `EXPLICIT_PROTOCOL` or `EXPLICIT_DOM` binding and an exact expiration match. No economic WIN/LOSS is produced while the payout is unbound.

## 6. Pipeline and recovery

The pipeline restores the latest persisted tick and latest payout-per-asset/feed on MV3 restart. The protocol registry version is part of the scientific config hash so changing registry authority necessarily changes configuration identity.

IndexedDB version is 5.

## 7. Dataset and replay

Dataset schema v3 records:

- source-tree SHA-256;
- optional clean Git SHA;
- config hashes;
- protocol registry version;
- verification IDs actually used;
- export-time operational state/reason;
- latest tick age at export;
- complete append-only scientific journal;
- deterministic dataset checksum/ID.

Replay uses the same watchdog and quantitative pipeline as live mode.

## 8. Dashboard

Telemetry now separates:

```text
source quality / protocol verification
current wall-clock operational state
latest decision-time operational state
watchdog reason and freshness thresholds
payout protocol verification
payout expiration binding
```

This prevents a historical `HEALTHY` decision from being mistaken for a currently healthy feed.

## 9. Validation gates

```text
npm run typecheck
npm test
npm run build
npm run validate:manifest
npm run verify
```

Sandbox result:

```text
typecheck: PASS
tests: 23/23 PASS
build: PASS
manifest: PASS
```

Raw capture registry replay:

```text
demo-api-eu:   234 price + 24 payout VERIFIED
api-us-north:   38 price +  2 payout VERIFIED
api-us-south:  127 price +  6 payout VERIFIED
```

Regression of the user-exported v1.3.0 session under v1.4.0 semantics:

```text
692 ticks
140 decisions
18 CALL/PUT
15 CALL / 3 PUT
18 signals
18 entries resolved
6 directional results resolved
12 results DATA_UNAVAILABLE after feed loss
economic sample 0
export state DATA_UNAVAILABLE
latest tick age at export 243836 ms
```

The 6 directional results contain 2 correct and 4 incorrect. This tiny descriptive sample is not scientific evidence of profitability.

## 10. Frozen safety boundary

No auto-trading, auto-click, CALL/PUT click, order submission or realized-P&L path is part of the project. Protocol verification only authorizes scientific signal processing of an observed feed schema; it does not authorize broker execution and does not establish strategy validity.
