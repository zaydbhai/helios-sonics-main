import { useEffect, useRef, useState } from 'react';
import type { EarthNowCatalog } from '../types/earthNow';

interface PreloadState {
  /** Maps original imageUrl -> preloaded & decoded blob: URL */
  srcMap: Record<string, string>;
  /** Number of frames preloaded for the currently selected track */
  activeLoaded: number;
  /** Total frames in the currently selected track */
  activeTotal: number;
  /** True once all frames for the active track are decoded in RAM */
  isActiveReady: boolean;
}

/**
 * Fetches and decodes Earth Now JPEG frames into memory-backed blob URLs so
 * playback and timeline scrubbing swap frames instantaneously with zero network lag.
 */
export function useFramePreloader(
  catalog: EarthNowCatalog | null,
  activeTrackId: string
): PreloadState {
  const [srcMap, setSrcMap] = useState<Record<string, string>>({});
  const objectUrlsRef = useRef<string[]>([]);
  const decodedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
      decodedImagesRef.current.clear();
      inFlightRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!catalog || catalog.tracks.length === 0) return;

    let cancelled = false;

    const activeTrack =
      catalog.tracks.find((t) => t.id === activeTrackId) ?? catalog.tracks[0];
    const otherTracks = catalog.tracks.filter((t) => t.id !== activeTrack.id);

    // Prioritize active track frames first, then preload remaining Jukebox tracks
    const orderedUrls = [
      ...activeTrack.frames.map((f) => f.imageUrl),
      ...otherTracks.flatMap((t) => t.frames.map((f) => f.imageUrl)),
    ];

    const preloadOne = async (imageUrl: string): Promise<void> => {
      if (cancelled || decodedImagesRef.current.has(imageUrl) || inFlightRef.current.has(imageUrl)) {
        return;
      }
      inFlightRef.current.add(imageUrl);

      try {
        const res = await fetch(imageUrl);
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;

        const blobUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.push(blobUrl);

        const img = new Image();
        img.src = blobUrl;
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
        if (cancelled) return;

        decodedImagesRef.current.set(imageUrl, img);
        setSrcMap((prev) => (prev[imageUrl] ? prev : { ...prev, [imageUrl]: blobUrl }));
      } catch {
        // Leave fallback to direct imageUrl if fetch fails
      } finally {
        inFlightRef.current.delete(imageUrl);
      }
    };

    const runQueue = async () => {
      const concurrency = 6;
      let cursor = 0;

      const worker = async () => {
        while (!cancelled && cursor < orderedUrls.length) {
          const url = orderedUrls[cursor++];
          await preloadOne(url);
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    };

    void runQueue();

    return () => {
      cancelled = true;
    };
  }, [catalog, activeTrackId]);

  const activeTrack =
    catalog?.tracks.find((t) => t.id === activeTrackId) ?? catalog?.tracks[0] ?? null;
  const activeTotal = activeTrack?.frames.length ?? 0;
  const activeLoaded = activeTrack
    ? activeTrack.frames.filter((f) => Boolean(srcMap[f.imageUrl])).length
    : 0;

  return {
    srcMap,
    activeLoaded,
    activeTotal,
    isActiveReady: activeTotal > 0 && activeLoaded === activeTotal,
  };
}
