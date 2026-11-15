import type {
  MissionDomain,
  NasaDatasetRecord,
  NasaDatasetSummary,
  TelemetrySample,
} from "../../src/types/nasa.ts";
import { loadInitialRealNasaDatasets } from "./datasets.ts";

export interface CustomDatasetIngestInput {
  id?: string;
  title: string;
  mission?: string;
  instrument?: string;
  domain?: MissionDomain;
  primaryChannelName?: string;
  primaryUnit?: string;
  secondaryChannelName?: string;
  secondaryUnit?: string;
  cadenceLabel?: string;
  description?: string;
  values: number[];
  secondaryValues?: number[];
  baseFrequencyHz?: number;
}

export interface NasaDatasetProvider {
  readonly mode: "live-nasa-api";
  listDatasets(domain?: string): Promise<NasaDatasetSummary[]>;
  getDatasetById(id: string): Promise<NasaDatasetRecord | null>;
  ingestDataset(input: CustomDatasetIngestInput): Promise<NasaDatasetRecord>;
  registerDataset(record: NasaDatasetRecord): Promise<NasaDatasetRecord>;
}

function toSummary(record: NasaDatasetRecord): NasaDatasetSummary {
  const {
    id, title, mission, instrument, domain, sourceType,
    epochStart, epochEnd, cadenceLabel, primaryUnit, secondaryUnit,
    primaryChannelName, secondaryChannelName, sampleCount, description, accentColor,
  } = record;
  return {
    id, title, mission, instrument, domain, sourceType,
    epochStart, epochEnd, cadenceLabel, primaryUnit, secondaryUnit,
    primaryChannelName, secondaryChannelName, sampleCount, description, accentColor,
  };
}

export function normalizeSeriesToSamples(
  primaryValues: number[],
  secondaryValues?: number[]
): TelemetrySample[] {
  const cleanPrimary = primaryValues.filter((v) => Number.isFinite(v));
  if (cleanPrimary.length < 4) {
    throw new Error("Dataset must contain at least 4 finite numeric samples.");
  }
  const minP = Math.min(...cleanPrimary);
  const maxP = Math.max(...cleanPrimary);
  const spanP = maxP - minP || 1;

  const cleanSecondary =
    secondaryValues && secondaryValues.length === cleanPrimary.length
      ? secondaryValues.map((v) => (Number.isFinite(v) ? v : 0))
      : cleanPrimary.map((v, i, arr) => (i === 0 ? 0 : Math.abs(v - arr[i - 1])));

  const minS = Math.min(...cleanSecondary);
  const maxS = Math.max(...cleanSecondary);
  const spanS = maxS - minS || 1;

  const nowMs = Date.now();
  return cleanPrimary.map((val, idx) => {
    const normalized = Math.max(0, Math.min(1, (val - minP) / spanP));
    const secVal = cleanSecondary[idx];
    const secondaryNormalized = Math.max(0, Math.min(1, (secVal - minS) / spanS));
    const prevNorm =
      idx > 0 ? Math.max(0, Math.min(1, (cleanPrimary[idx - 1] - minP) / spanP)) : normalized;
    const spectralFlux = Math.max(
      0,
      Math.min(1, Math.abs(normalized - prevNorm) * 3.5 + secondaryNormalized * 0.25)
    );
    return {
      t: idx,
      timestamp: new Date(nowMs + idx * 1000).toISOString(),
      primaryValue: Number(val.toFixed(4)),
      normalized,
      secondaryValue: Number(secVal.toFixed(4)),
      secondaryNormalized,
      spectralFlux,
    };
  });
}

class LiveNasaCatalogProvider implements NasaDatasetProvider {
  public readonly mode = "live-nasa-api" as const;
  private readonly store = new Map<string, NasaDatasetRecord>();
  private hydrationPromise: Promise<void> | null = null;

  private async ensureHydrated(): Promise<void> {
    if (this.store.size > 0) return;
    if (!this.hydrationPromise) {
      this.hydrationPromise = loadInitialRealNasaDatasets()
        .then((records) => {
          for (const rec of records) {
            this.store.set(rec.id, rec);
          }
        })
        .finally(() => {
          this.hydrationPromise = null;
        });
    }
    await this.hydrationPromise;
  }

  async listDatasets(domain?: string): Promise<NasaDatasetSummary[]> {
    await this.ensureHydrated();
    const all = Array.from(this.store.values());
    const filtered =
      domain && domain !== "All"
        ? all.filter((d) => d.domain.toLowerCase() === domain.toLowerCase())
        : all;
    return filtered.map(toSummary);
  }

  async getDatasetById(id: string): Promise<NasaDatasetRecord | null> {
    await this.ensureHydrated();
    return this.store.get(id) ?? null;
  }

  async ingestDataset(input: CustomDatasetIngestInput): Promise<NasaDatasetRecord> {
    const samples = normalizeSeriesToSamples(input.values, input.secondaryValues);
    const slugBase = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    const id = input.id?.trim() || `custom-${slugBase || "telemetry"}-${Date.now().toString(36)}`;
    const record: NasaDatasetRecord = {
      id,
      title: input.title.trim(),
      mission: input.mission?.trim() || "Custom NASA Feed",
      instrument: input.instrument?.trim() || "User Ingested Telemetry",
      domain: input.domain || "Heliophysics",
      sourceType: "ingested-custom",
      epochStart: samples[0].timestamp,
      epochEnd: samples[samples.length - 1].timestamp,
      cadenceLabel: input.cadenceLabel?.trim() || "Normalized step",
      primaryUnit: input.primaryUnit?.trim() || "units",
      secondaryUnit: input.secondaryUnit?.trim() || "Δ/step",
      primaryChannelName: input.primaryChannelName?.trim() || "Primary Telemetry Channel",
      secondaryChannelName: input.secondaryChannelName?.trim() || "Derived Derivative Flux",
      sampleCount: samples.length,
      description: input.description?.trim() || "Custom telemetry series normalized by the Express backend.",
      accentColor: "#06B6D4",
      sonification: {
        baseFrequencyHz: input.baseFrequencyHz && input.baseFrequencyHz >= 30 ? input.baseFrequencyHz : 98.0,
        harmonicSpread: 1.5,
        filterCutoffHz: 1850,
        filterQ: 1.7,
        waveform: "triangle",
        modulationDepth: 0.24,
        recommendedScale: "pentatonic",
      },
      samples,
      integrationNotes: {
        targetNasaArchive: "Custom Ingested Payload (/api/datasets/ingest)",
        expectedEndpoint: "POST /api/datasets/ingest",
        physicalCoordinateFrame: "Normalized [0..1] Audio Scalar",
      },
    };
    this.store.set(record.id, record);
    return record;
  }

  async registerDataset(record: NasaDatasetRecord): Promise<NasaDatasetRecord> {
    this.store.set(record.id, record);
    return record;
  }
}

export const nasaProvider: NasaDatasetProvider = new LiveNasaCatalogProvider();
