import type { NasaDatasetRecord, TelemetrySample } from '../../src/types/nasa.ts';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildVoyagerSamples(count: number): TelemetrySample[] {
  const baseEpoch = Date.parse('2012-08-25T00:00:00Z');
  const samples: TelemetrySample[] = [];
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const t = i * 600;
    // Heliopause boundary density step + plasma oscillation ripples
    const boundaryStep = 1 / (1 + Math.exp(-(progress - 0.52) * 18));
    const ripple =
      0.14 * Math.sin(i * 0.37) +
      0.09 * Math.cos(i * 0.91) +
      0.05 * Math.sin(i * 2.13);
    const shockSpike =
      Math.exp(-Math.pow((progress - 0.54) * 28, 2)) * 0.35 +
      Math.exp(-Math.pow((progress - 0.78) * 35, 2)) * 0.22;

    const normalized = clamp01(0.14 + boundaryStep * 0.56 + ripple + shockSpike);
    const primaryValue = Number((0.002 + normalized * 0.118).toFixed(5)); // cm^-3
    const secondaryNormalized = clamp01(
      0.22 + 0.45 * Math.abs(Math.sin(i * 0.21 + 0.5)) + shockSpike * 0.8
    );
    const secondaryValue = Number((0.05 + secondaryNormalized * 4.8).toFixed(3)); // mV/m
    const spectralFlux = clamp01(
      Math.abs(Math.sin(i * 0.65)) * 0.55 + shockSpike * 1.15
    );

    samples.push({
      t,
      timestamp: new Date(baseEpoch + t * 1000).toISOString(),
      primaryValue,
      normalized,
      secondaryValue,
      secondaryNormalized,
      spectralFlux,
    });
  }
  return samples;
}

function buildParkerSolarSamples(count: number): TelemetrySample[] {
  const baseEpoch = Date.parse('2021-04-28T06:00:00Z');
  const samples: TelemetrySample[] = [];
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const t = i * 12;
    // Magnetic switchback inversions near perihelion
    const perihelionEnvelope = Math.exp(-Math.pow((progress - 0.5) * 2.4, 2));
    const switchback =
      Math.sin(i * 0.48) > 0.58 ? 0.34 * Math.sin(i * 1.7) : 0.08 * Math.cos(i * 0.8);
    const alfvenWave = 0.16 * Math.sin(i * 0.29) + 0.1 * Math.cos(i * 0.73);

    const normalized = clamp01(0.24 + perihelionEnvelope * 0.48 + switchback + alfvenWave);
    const primaryValue = Number((18 + normalized * 310).toFixed(2)); // nT
    const secondaryNormalized = clamp01(
      0.35 + 0.38 * Math.sin(i * 0.19 + 1.2) + (switchback > 0.1 ? 0.25 : 0)
    );
    const secondaryValue = Number((280 + secondaryNormalized * 460).toFixed(1)); // km/s
    const spectralFlux = clamp01(
      0.2 + Math.abs(switchback) * 1.8 + 0.25 * Math.abs(Math.cos(i * 1.1))
    );

    samples.push({
      t,
      timestamp: new Date(baseEpoch + t * 1000).toISOString(),
      primaryValue,
      normalized,
      secondaryValue,
      secondaryNormalized,
      spectralFlux,
    });
  }
  return samples;
}

function buildInsightSeismicSamples(count: number): TelemetrySample[] {
  const baseEpoch = Date.parse('2022-05-04T23:27:00Z');
  const samples: TelemetrySample[] = [];
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const t = i * 2;
    // P-wave arrival at 0.18, S-wave arrival at 0.36, long coda decay
    const pWave =
      progress > 0.18
        ? Math.exp(-(progress - 0.18) * 10) *
          Math.abs(Math.sin((progress - 0.18) * 95)) *
          0.45
        : 0;
    const sWave =
      progress > 0.36
        ? Math.exp(-(progress - 0.36) * 4.2) *
          (0.6 + 0.4 * Math.sin((progress - 0.36) * 130)) *
          0.88
        : 0;
    const microseism = 0.045 * Math.abs(Math.sin(i * 1.3)) + 0.025;

    const normalized = clamp01(microseism + pWave + sWave);
    const primaryValue = Number((normalized * 14.8).toFixed(4)); // um/s
    const secondaryNormalized = clamp01(
      0.18 + sWave * 0.65 + 0.15 * Math.sin(i * 0.55)
    );
    const secondaryValue = Number((0.4 + secondaryNormalized * 4.6).toFixed(3)); // Hz
    const spectralFlux = clamp01(pWave * 1.3 + sWave * 0.95);

    samples.push({
      t,
      timestamp: new Date(baseEpoch + t * 1000).toISOString(),
      primaryValue,
      normalized,
      secondaryValue,
      secondaryNormalized,
      spectralFlux,
    });
  }
  return samples;
}

function buildChandraXraySamples(count: number): TelemetrySample[] {
  const baseEpoch = Date.parse('2020-01-14T12:00:00Z');
  const samples: TelemetrySample[] = [];
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const t = i * 0.5;
    // Radial sweep across Cassiopeia A supernova remnant emission lines (Si, S, Fe-K)
    const siLine = Math.exp(-Math.pow((progress - 0.25) * 16, 2)) * 0.72;
    const sLine = Math.exp(-Math.pow((progress - 0.46) * 18, 2)) * 0.58;
    const feLine = Math.exp(-Math.pow((progress - 0.78) * 20, 2)) * 0.66;
    const continuum = 0.22 * Math.exp(-progress * 1.2) + 0.06 * Math.sin(i * 0.8);

    const normalized = clamp01(continuum + siLine + sLine + feLine);
    const primaryValue = Number((12 + normalized * 485).toFixed(1)); // counts/s
    const secondaryNormalized = clamp01(0.12 + progress * 0.82);
    const secondaryValue = Number((0.5 + secondaryNormalized * 7.5).toFixed(3)); // keV
    const spectralFlux = clamp01(siLine + sLine + feLine + 0.12);

    samples.push({
      t,
      timestamp: new Date(baseEpoch + t * 1000).toISOString(),
      primaryValue,
      normalized,
      secondaryValue,
      secondaryNormalized,
      spectralFlux,
    });
  }
  return samples;
}

function buildJunoWavesSamples(count: number): TelemetrySample[] {
  const baseEpoch = Date.parse('2017-05-19T06:00:00Z');
  const samples: TelemetrySample[] = [];
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const t = i * 5;
    // Auroral decametric radio sweep arcs
    const arc1 = Math.sin(progress * Math.PI * 3.5);
    const arc2 = Math.cos(progress * Math.PI * 7.0);
    const burst = Math.exp(-Math.pow((progress - 0.62) * 14, 2)) * 0.42;

    const normalized = clamp01(0.32 + 0.28 * arc1 + 0.16 * arc2 + burst);
    const primaryValue = Number((-95 + normalized * 68).toFixed(2)); // dB
    const secondaryNormalized = clamp01(0.2 + 0.65 * Math.abs(Math.sin(progress * Math.PI * 2.2)));
    const secondaryValue = Number((18 + secondaryNormalized * 380).toFixed(1)); // kHz
    const spectralFlux = clamp01(0.25 + 0.4 * Math.abs(arc2) + burst);

    samples.push({
      t,
      timestamp: new Date(baseEpoch + t * 1000).toISOString(),
      primaryValue,
      normalized,
      secondaryValue,
      secondaryNormalized,
      spectralFlux,
    });
  }
  return samples;
}

export const TEST_NASA_DATASETS: NasaDatasetRecord[] = [
  {
    id: 'voyager-1-pws',
    title: 'Voyager 1 Heliopause Plasma Crossing',
    mission: 'Voyager 1',
    instrument: 'Plasma Wave Science (PWS)',
    domain: 'Deep Space Plasma',
    sourceType: 'test-catalog',
    epochStart: '2012-08-25T00:00:00Z',
    epochEnd: '2012-08-26T16:00:00Z',
    cadenceLabel: '10 min cadence',
    primaryUnit: 'cm⁻³',
    secondaryUnit: 'mV/m',
    primaryChannelName: 'Electron Plasma Density',
    secondaryChannelName: 'Electric Field Wave',
    sampleCount: 240,
    description:
      'Test telemetry curve modeled on Voyager 1 PWS electron plasma density jumps and electrostatic oscillations across the heliopause boundary.',
    accentColor: '#06B6D4',
    sonification: {
      baseFrequencyHz: 98.0,
      harmonicSpread: 1.5,
      filterCutoffHz: 1550,
      filterQ: 1.8,
      waveform: 'triangle',
      modulationDepth: 0.24,
      recommendedScale: 'pentatonic',
    },
    samples: buildVoyagerSamples(240),
    integrationNotes: {
      targetNasaArchive: 'NASA SPDF CDAWeb / Planetary Data System',
      expectedEndpoint: 'https://cdaweb.gsfc.nasa.gov/WS/cdasr/1/dataviews/sp_phys/datasets/VG1_PWS_LR',
      physicalCoordinateFrame: 'Heliocentric Inertial (HCI)',
    },
  },
  {
    id: 'parker-solar-fields',
    title: 'Parker Solar Probe Magnetic Switchbacks',
    mission: 'Parker Solar Probe',
    instrument: 'FIELDS Magnetometer',
    domain: 'Heliophysics',
    sourceType: 'test-catalog',
    epochStart: '2021-04-28T06:00:00Z',
    epochEnd: '2021-04-28T06:48:00Z',
    cadenceLabel: '12 s cadence',
    primaryUnit: 'nT',
    secondaryUnit: 'km/s',
    primaryChannelName: 'Magnetic Field |B|',
    secondaryChannelName: 'Solar Wind Radial Velocity',
    sampleCount: 240,
    description:
      'Test Alfvénic magnetic field reversals and solar wind velocity surges recorded during inner heliosphere perihelion encounters.',
    accentColor: '#F59E0B',
    sonification: {
      baseFrequencyHz: 87.31,
      harmonicSpread: 1.5,
      filterCutoffHz: 1700,
      filterQ: 1.9,
      waveform: 'triangle',
      modulationDepth: 0.28,
      recommendedScale: 'pentatonic',
    },
    samples: buildParkerSolarSamples(240),
    integrationNotes: {
      targetNasaArchive: 'NASA HelioCloud / SPDF PSP FIELDS',
      expectedEndpoint: 'https://cdaweb.gsfc.nasa.gov/WS/cdasr/1/dataviews/sp_phys/datasets/PSP_FLD_L2_MAG_RTN',
      physicalCoordinateFrame: 'Radial-Tangential-Normal (RTN)',
    },
  },
  {
    id: 'insight-seis-sol1222',
    title: 'Mars InSight Sol 1222 Seismic Event',
    mission: 'InSight Lander',
    instrument: 'SEIS Very Broad Band Seismometer',
    domain: 'Planetary Science',
    sourceType: 'test-catalog',
    epochStart: '2022-05-04T23:27:00Z',
    epochEnd: '2022-05-04T23:35:00Z',
    cadenceLabel: '2 s envelope',
    primaryUnit: 'µm/s',
    secondaryUnit: 'Hz',
    primaryChannelName: 'Vertical Ground Velocity',
    secondaryChannelName: 'Dominant Resonant Mode',
    sampleCount: 240,
    description:
      'Test seismic waveform envelope depicting P-wave onset, high-amplitude S-wave packet, and Martian crustal coda reverberation.',
    accentColor: '#06B6D4',
    sonification: {
      baseFrequencyHz: 65.41,
      harmonicSpread: 1.5,
      filterCutoffHz: 1150,
      filterQ: 1.5,
      waveform: 'sine',
      modulationDepth: 0.2,
      recommendedScale: 'harmonic',
    },
    samples: buildInsightSeismicSamples(240),
    integrationNotes: {
      targetNasaArchive: 'NASA PDS Geosciences / IRIS Mars Data',
      expectedEndpoint: 'https://service.iris.edu/fdsnws/dataselect/1/query?net=XB&sta=ELYSE',
      physicalCoordinateFrame: 'UVWE / ZNE Local Lander Frame',
    },
  },
  {
    id: 'chandra-cas-a',
    title: 'Chandra Cassiopeia A X-Ray Spectrum',
    mission: 'Chandra X-Ray Observatory',
    instrument: 'ACIS-S Imaging Spectrometer',
    domain: 'Astrophysics',
    sourceType: 'test-catalog',
    epochStart: '2020-01-14T12:00:00Z',
    epochEnd: '2020-01-14T12:02:00Z',
    cadenceLabel: '0.5 s sweep',
    primaryUnit: 'counts/s',
    secondaryUnit: 'keV',
    primaryChannelName: 'X-Ray Photon Flux',
    secondaryChannelName: 'Photon Energy Band',
    sampleCount: 240,
    description:
      'Test energy-ordered X-ray spectral sweep highlighting silicon, sulfur, and iron K-shell emission peaks across Cassiopeia A.',
    accentColor: '#06B6D4',
    sonification: {
      baseFrequencyHz: 130.81,
      harmonicSpread: 2.0,
      filterCutoffHz: 2200,
      filterQ: 1.6,
      waveform: 'sine',
      modulationDepth: 0.2,
      recommendedScale: 'pentatonic',
    },
    samples: buildChandraXraySamples(240),
    integrationNotes: {
      targetNasaArchive: 'NASA HEASARC / Chandra Data Archive',
      expectedEndpoint: 'https://cda.harvard.edu/chaser/ocatList.do',
      physicalCoordinateFrame: 'ICRS Celestial (RA/Dec) + keV Energy',
    },
  },
  {
    id: 'juno-waves-aurora',
    title: 'Juno Jovian Auroral Radio Sweep',
    mission: 'Juno',
    instrument: 'Waves Radio & Plasma Instrument',
    domain: 'Planetary Science',
    sourceType: 'test-catalog',
    epochStart: '2017-05-19T06:00:00Z',
    epochEnd: '2017-05-19T06:20:00Z',
    cadenceLabel: '5 s cadence',
    primaryUnit: 'dB',
    secondaryUnit: 'kHz',
    primaryChannelName: 'Electric Spectral Power',
    secondaryChannelName: 'Cyclotron Frequency',
    sampleCount: 240,
    description:
      'Test Jovian polar magnetosphere radio arcs capturing cyclotron maser instability sweeps during Perijove transit.',
    accentColor: '#F59E0B',
    sonification: {
      baseFrequencyHz: 110.0,
      harmonicSpread: 1.5,
      filterCutoffHz: 1850,
      filterQ: 2.0,
      waveform: 'triangle',
      modulationDepth: 0.26,
      recommendedScale: 'harmonic',
    },
    samples: buildJunoWavesSamples(240),
    integrationNotes: {
      targetNasaArchive: 'NASA PDS Planetary Plasma Interactions (PPI)',
      expectedEndpoint: 'https://pds-ppi.igpp.ucla.edu/search/view/?id=pds://PPI/JNO-E_J_SS-WAV-3-CDR-BSTFULL-V2.0',
      physicalCoordinateFrame: 'System III Jovigraphic',
    },
  },
];
