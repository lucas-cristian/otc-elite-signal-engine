import { canonicalJson } from '../../common/hashing/canonical-hash.js';
import type {
  Phase4AuditEvent,
  Phase4DatasetImportRecord,
  Phase4EpisodeRecord,
  Phase4Evaluation,
  Phase4ExclusionRecord,
  Phase4Experiment,
  Phase4StartAttestation,
} from './types.js';

export interface Phase4Snapshot {
  experiments: Phase4Experiment[];
  attestations: Phase4StartAttestation[];
  datasets: Phase4DatasetImportRecord[];
  episodes: Phase4EpisodeRecord[];
  exclusions: Phase4ExclusionRecord[];
  auditEvents: Phase4AuditEvent[];
  evaluations: Phase4Evaluation[];
}

export interface Phase4Repository {
  appendExperiment(value: Phase4Experiment): Promise<void>;
  appendStartAttestation(value: Phase4StartAttestation): Promise<void>;
  appendDataset(value: Phase4DatasetImportRecord): Promise<void>;
  appendEpisode(value: Phase4EpisodeRecord): Promise<void>;
  appendExclusion(value: Phase4ExclusionRecord): Promise<void>;
  appendAuditEvent(value: Phase4AuditEvent): Promise<void>;
  appendEvaluation(value: Phase4Evaluation): Promise<void>;
  snapshot(): Promise<Phase4Snapshot>;
}

export class MemoryPhase4Repository implements Phase4Repository {
  private readonly experiments = new Map<string, Phase4Experiment>();
  private readonly attestations = new Map<string, Phase4StartAttestation>();
  private readonly datasets = new Map<string, Phase4DatasetImportRecord>();
  private readonly episodes = new Map<string, Phase4EpisodeRecord>();
  private readonly exclusions = new Map<string, Phase4ExclusionRecord>();
  private readonly auditEvents = new Map<string, Phase4AuditEvent>();
  private readonly evaluations = new Map<string, Phase4Evaluation>();

  public appendExperiment(value: Phase4Experiment): Promise<void> { return this.append(this.experiments, value.experimentId, value); }
  public appendStartAttestation(value: Phase4StartAttestation): Promise<void> { return this.append(this.attestations, value.experimentId, value); }
  public appendDataset(value: Phase4DatasetImportRecord): Promise<void> { return this.append(this.datasets, value.key, value); }
  public appendEpisode(value: Phase4EpisodeRecord): Promise<void> { return this.append(this.episodes, value.key, value); }
  public appendExclusion(value: Phase4ExclusionRecord): Promise<void> { return this.append(this.exclusions, value.exclusionId, value); }
  public appendAuditEvent(value: Phase4AuditEvent): Promise<void> { return this.append(this.auditEvents, value.auditEventId, value); }
  public appendEvaluation(value: Phase4Evaluation): Promise<void> { return this.append(this.evaluations, value.experimentId, value); }

  public snapshot(): Promise<Phase4Snapshot> {
    return Promise.resolve({
      experiments: [...this.experiments.values()],
      attestations: [...this.attestations.values()],
      datasets: [...this.datasets.values()],
      episodes: [...this.episodes.values()],
      exclusions: [...this.exclusions.values()],
      auditEvents: [...this.auditEvents.values()],
      evaluations: [...this.evaluations.values()],
    });
  }

  private append<T>(store: Map<string, T>, key: string, value: T): Promise<void> {
    const existing = store.get(key);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(value)) return Promise.reject(new Error('Phase 4 append-only conflict'));
    store.set(key, value);
    return Promise.resolve();
  }
}
