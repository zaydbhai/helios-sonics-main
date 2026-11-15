export interface EarthNowFrame {
  index: number;
  imageUrl: string;
  timeLabel: string;
  brightness: number;
  normalizedBrightness: number;
  cloudCover: number;
  normalizedCloudCover: number;
}

export interface EarthNowTrack {
  id: string;
  title: string;
  svsId: string;
  sourceUrl: string;
  primaryMetricName: string;
  primaryUnit: string;
  secondaryMetricName: string;
  secondaryUnit: string;
  soundPreview?: string;
  audioLegend: string;
  frameCount: number;
  brightnessRange: [number, number];
  frames: EarthNowFrame[];
}

export interface EarthNowCatalog {
  generatedAtUtc: string;
  sourceGallery: string;
  tracks: EarthNowTrack[];
}

export type MusicalScaleType = 'pentatonic' | 'dorian' | 'minor';

export type SynthVoiceType = 'triangle' | 'marimba' | 'warm-pad' | 'plucked-sine';

export interface NormalizedRoiBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

