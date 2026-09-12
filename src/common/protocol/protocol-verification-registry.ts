import type { SourceQuality } from '../models/types.js';

export type ProtocolEventKind = 'PRICE_STREAM' | 'PAYOUT';
export type ProtocolPayloadShapeId = 'OTC_STREAM_TRIPLE_V1' | 'OTC_PAYOUT_PAIR_V1';
export type SourceClockPolicy = 'UNSYNCHRONIZED_LOCAL_RECEIPT' | 'NOT_APPLICABLE';

export interface ProtocolVerificationDescriptor {
  verificationId: string;
  feedHost: string;
  eventKind: ProtocolEventKind;
  socketIoEventName: 'updateStream' | 'chafor';
  parserSchemaId: string;
  payloadShapeId: ProtocolPayloadShapeId;
  marketType: 'OTC';
  sourceClockPolicy: SourceClockPolicy;
  verifiedAtEpochMs: number;
  evidenceArtifactSha256: string;
  evidenceLabel: string;
}

export interface ProtocolVerificationQuery {
  feedHost: string;
  eventKind: ProtocolEventKind;
  socketIoEventName: string;
  parserSchemaId: string;
  payloadShapeId: ProtocolPayloadShapeId;
  marketType: 'OTC';
}

export interface ProtocolVerificationResult {
  quality: SourceQuality;
  verificationId: string | null;
  sourceClockPolicy: SourceClockPolicy | null;
}

export const PROTOCOL_VERIFICATION_REGISTRY_VERSION = '2026-09-12.1';
export const POCKET_OPTION_STREAM_SCHEMA_ID = 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1';
export const POCKET_OPTION_PAYOUT_SCHEMA_ID = 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1';

const RAW_CAPTURE_SHA256 = 'e7bd373a547861b7af6a784dbf49b48c7ec8f9a16e8735e8e62bafdafb38b67e';
const VERIFIED_AT_EPOCH_MS = Date.UTC(2026, 8, 12, 14, 28, 53, 874);

const VERIFIED_FEEDS = [
  'demo-api-eu.po.market',
  'api-us-north.po.market',
  'api-us-south.po.market',
] as const;

function descriptor(
  feedHost: string,
  eventKind: ProtocolEventKind,
): ProtocolVerificationDescriptor {
  const price = eventKind === 'PRICE_STREAM';
  return {
    verificationId: `POCKET_OPTION_${feedHost.replaceAll('.', '_').replaceAll('-', '_').toUpperCase()}_${price ? 'STREAM' : 'PAYOUT'}_2026_09_12_V1`,
    feedHost,
    eventKind,
    socketIoEventName: price ? 'updateStream' : 'chafor',
    parserSchemaId: price ? POCKET_OPTION_STREAM_SCHEMA_ID : POCKET_OPTION_PAYOUT_SCHEMA_ID,
    payloadShapeId: price ? 'OTC_STREAM_TRIPLE_V1' : 'OTC_PAYOUT_PAIR_V1',
    marketType: 'OTC',
    sourceClockPolicy: price ? 'UNSYNCHRONIZED_LOCAL_RECEIPT' : 'NOT_APPLICABLE',
    verifiedAtEpochMs: VERIFIED_AT_EPOCH_MS,
    evidenceArtifactSha256: RAW_CAPTURE_SHA256,
    evidenceLabel: 'USER_CDP_CAPTURE_2026_09_12',
  };
}

const REGISTRY: readonly ProtocolVerificationDescriptor[] = VERIFIED_FEEDS.flatMap((feedHost) => [
  descriptor(feedHost, 'PRICE_STREAM'),
  descriptor(feedHost, 'PAYOUT'),
]);

export function protocolVerificationRegistry(): readonly ProtocolVerificationDescriptor[] {
  return REGISTRY;
}

export function resolveProtocolVerification(query: ProtocolVerificationQuery): ProtocolVerificationResult {
  const match = REGISTRY.find((entry) => entry.feedHost === query.feedHost
    && entry.eventKind === query.eventKind
    && entry.socketIoEventName === query.socketIoEventName
    && entry.parserSchemaId === query.parserSchemaId
    && entry.payloadShapeId === query.payloadShapeId
    && entry.marketType === query.marketType);
  if (!match) return { quality: 'INFERRED', verificationId: null, sourceClockPolicy: null };
  return {
    quality: 'VERIFIED',
    verificationId: match.verificationId,
    sourceClockPolicy: match.sourceClockPolicy,
  };
}
