# OTC Elite Signal Engine v1.7.0 — Validation Report

## Scope

Version 1.7.0 replaces the failed Service Worker shadow WebSocket design with a MAIN-world native shadow market connection created from the original `window.WebSocket` constructor captured before interception.

The v1.6.0 runtime dataset showed that the Service Worker socket repeatedly reached WebSocket OPEN but the remote Socket.IO namespace closed before successful authentication. The new design keeps the captured authentication packet and subscription packets only in MAIN World memory. They are not forwarded to the isolated content script, Service Worker, IndexedDB, scientific dataset, or logs.

## Shadow state machine

`WAITING_CONTEXT -> ENGINE_CONNECTING -> ENGINE_OPEN -> NAMESPACE_CONNECTING -> NAMESPACE_OPEN -> AUTH_SENT -> AUTHENTICATED -> SUBSCRIPTIONS_REPLAYED -> STREAMING`

Failures enter `BACKOFF`. Five consecutive namespace rejections open `CIRCUIT_OPEN`. A refreshed page authentication context or explicit supervisor reset is required before further attempts.

Reconnect delay is frozen at `1s -> 2s -> 5s -> 10s -> 20s`, capped at 20 seconds. Recovery context updates cannot cancel an active backoff timer.

## Service Worker supervision

The Service Worker no longer authenticates directly with Pocket Option. It supervises the MAIN-world shadow through the existing `runtime.Port` channel and may send only:

- `ENSURE_CONNECTED`
- `FORCE_RECONNECT`
- `RESET_CIRCUIT`

A page WebSocket close/error triggers immediate shadow supervision. The periodic MV3 watchdog also requests recovery when semantic market data is stale.

## Safety boundary

The replay whitelist contains only market-related packets observed in the protocol:

- `changeSymbol`
- `subfor`
- `subscribeSymbol` for `_otc` assets only
- `ps`

Order/trade packets are not whitelisted. Production `src/` contains no `openOrder` sender.

## Scientific continuity

Feed epochs remain fail-closed. Connection loss, source switch, or prolonged tick gaps close the current epoch, invalidate pending evaluations that depend on it, clear hot quantitative state, and require fresh clean-candle warmup before a new CALL/PUT can be emitted.

## Gate results

- TypeScript strict: PASS
- Tests: 34/34 PASS
- MV3 build: PASS
- Manifest validation: PASS
- Explicit `any`: 0
- `Math.random()`: 0
- TODO/FIXME: 0
- `openOrder` in production `src/`: 0
- Service Worker `ShadowMarketConnection`: removed
- Content-script `AUTH_PACKET`: 0
- Content-script `SHADOW_RECOVERY_CONTEXT`: 0

## Build identity

- App version: `1.7.0`
- Build ID: `source-0c6fbba991071baa`
- Source tree SHA-256: `0c6fbba991071baafc46bfa67f577791bb509683ea4245a6a3019e44529e58e8`
- Dataset schema: v6
- Capture transport schema: v3
- Transport event schema: v2
- IndexedDB: v8

`gitCommit` is null in the distributed sandbox build because the sandbox package is not a Git checkout. Running `npm run verify` inside the user's repository rebuilds `dist/build-metadata.json` from that repository and records the local Git HEAD as the build baseline plus `gitWorkingTreeClean`.

## Remaining empirical gate

The MAIN-world shadow socket must still be tested in an authenticated Pocket Option DEMO session. Static validation cannot prove that the live server will accept the second market-only connection. The dashboard now exposes the exact state (`NAMESPACE_OPEN`, `AUTH_SENT`, `AUTHENTICATED`, `STREAMING`, or `CIRCUIT_OPEN`) so a live failure is diagnosable without reconnect spam.
