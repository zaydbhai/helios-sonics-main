import type { NasaDatasetRecord } from "../../src/types/nasa.ts";
import {
  connectCustomNasaApi,
  fetchDonkiSpaceWeatherDataset,
  getNasaApiPresets,
} from "./liveNasa.ts";

export async function loadInitialRealNasaDatasets(): Promise<NasaDatasetRecord[]> {
  const results: NasaDatasetRecord[] = [];
  const tasks: Array<Promise<NasaDatasetRecord | null>> = [
    connectCustomNasaApi({
      url: "https://cdaweb.gsfc.nasa.gov/hapi/data?id=OMNI_HRO2_1MIN&parameters=F,flow_speed&time.min=2024-05-10T00:00:00Z&time.max=2024-05-10T04:00:00Z&format=json",
      title: "NASA CDAWeb OMNI Solar Wind & |B| (HAPI)",
      mission: "NASA SPDF CDAWeb (OMNI_HRO2_1MIN)",
      domain: "Heliophysics",
      channelName: "Interplanetary Magnetic Field |B|",
      unit: "nT",
      jsonPath: "data.*.1",
      secondaryJsonPath: "data.*.2",
    })
      .then((r) => ({ ...r.dataset, id: "nasa-cdaweb-omni-hapi" }))
      .catch(() => null),
    fetchDonkiSpaceWeatherDataset("FLR")
      .then((r) => r.dataset)
      .catch(() => null),
    fetchDonkiSpaceWeatherDataset("GST")
      .then((r) => r.dataset)
      .catch(() => null),
    ...getNasaApiPresets().map((preset) =>
      connectCustomNasaApi({
        url: preset.url,
        title: preset.title,
        mission: preset.mission,
        domain: preset.domain,
        channelName: preset.channelName,
        unit: preset.unit,
        jsonPath: preset.jsonPath,
        secondaryJsonPath: preset.secondaryJsonPath,
      })
        .then((r) => ({ ...r.dataset, id: preset.id }))
        .catch(() => null)
    ),
  ];

  const settled = await Promise.all(tasks);
  for (const item of settled) {
    if (item) results.push(item);
  }
  return results;
}
