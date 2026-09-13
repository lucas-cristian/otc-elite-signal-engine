import { createPhase4StartAttestation, Phase4ValidationEngine } from './engine.js';
import { MemoryPhase4Repository } from './repository.js';
import type { Phase4Experiment, Phase4Report } from './types.js';

function createdAtFromJson(json: string): number {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Phase 4 replay dataset');
  const manifest = (value as { manifest?: unknown }).manifest;
  if (typeof manifest !== 'object' || manifest === null) throw new Error('Invalid Phase 4 replay manifest');
  const createdAt = (manifest as { createdAt?: unknown }).createdAt;
  if (typeof createdAt !== 'number') throw new Error('Phase 4 replay createdAt missing');
  return createdAt;
}

function datasetIdFromJson(json: string): string {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Phase 4 replay dataset');
  const manifest = (value as { manifest?: unknown }).manifest;
  if (typeof manifest !== 'object' || manifest === null) throw new Error('Invalid Phase 4 replay manifest');
  const datasetId = (manifest as { datasetId?: unknown }).datasetId;
  if (typeof datasetId !== 'string') throw new Error('Phase 4 replay datasetId missing');
  return datasetId;
}

export class Phase4ReplayEngine {
  public async replay(experiment: Phase4Experiment, datasetJsons: string[]): Promise<Phase4Report> {
    const repository = new MemoryPhase4Repository();
    await repository.appendExperiment(experiment);
    await repository.appendStartAttestation(createPhase4StartAttestation(experiment));
    const engine = new Phase4ValidationEngine(repository);
    const sorted = [...datasetJsons].sort((a, b) => datasetIdFromJson(a).localeCompare(datasetIdFromJson(b)));
    for (const json of sorted) await engine.importDatasetJson(json, createdAtFromJson(json));
    return engine.report();
  }
}
