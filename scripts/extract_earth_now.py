#!/usr/bin/env python3
"""
Member A Frame Extraction & Brightness Analysis Script
Downloads/reads NASA SVS Earth Now videos, cuts them into compact JPEG frames
with ffmpeg into public/earth-now/<track>/, measures per-frame average brightness
and secondary cloud/storm cover intensity, and writes public/earth-now/track.json.
"""

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone

TRACKS = [
    {
        "id": "temperature",
        "title": "GEOS-FP Near-Surface Temperature",
        "svsId": "5147",
        "sourceUrl": "https://svs.gsfc.nasa.gov/5147/",
        "videoPath": "/tmp/nasa_svs/temperature.mp4",
        "primaryMetricName": "Frame Brightness",
        "primaryUnit": "luma (0-255)",
        "secondaryMetricName": "Bright Highlight Cover",
        "secondaryUnit": "% bright pixels",
        "soundPreview": "Warm pentatonic chimes rising with brighter temperature map frames",
        "audioLegend": "Sonifies the brightness of NASA’s Earth Now visualization frames (mapped to C major pentatonic notes); the optional Layer 2 atmospheric noise swells with bright highlight coverage in each frame.",
    },
    {
        "id": "wind",
        "title": "GEOS-FP Near-Surface Wind Speed",
        "svsId": "5148",
        "sourceUrl": "https://svs.gsfc.nasa.gov/5148/",
        "videoPath": "/tmp/nasa_svs/wind.mp4",
        "primaryMetricName": "Frame Brightness",
        "primaryUnit": "luma (0-255)",
        "secondaryMetricName": "Bright Highlight Cover",
        "secondaryUnit": "% bright pixels",
        "soundPreview": "Fluid pentatonic pulses following bright wind-band frame changes",
        "audioLegend": "Sonifies the brightness of NASA’s Earth Now visualization frames (mapped to C major pentatonic notes); the optional Layer 2 atmospheric noise tracks bright highlight regions in each image.",
    },
    {
        "id": "precipitation",
        "title": "GEOS-FP Precipitation & Clouds",
        "svsId": "5149",
        "sourceUrl": "https://svs.gsfc.nasa.gov/5149/",
        "videoPath": "/tmp/nasa_svs/precipitation.mp4",
        "primaryMetricName": "Frame Brightness",
        "primaryUnit": "luma (0-255)",
        "secondaryMetricName": "Bright Cloud / Highlight Cover",
        "secondaryUnit": "% bright pixels",
        "soundPreview": "Crisp pentatonic notes paired with bright cloud-mask noise texture",
        "audioLegend": "Sonifies the brightness of NASA’s Earth Now visualization frames (mapped to C major pentatonic notes); the optional Layer 2 atmospheric noise follows bright white cloud and highlight coverage in each frame.",
    },
]

OUTPUT_BASE = os.path.join("public", "earth-now")
FRAME_COUNT = 36


def extract_frames(video_path: str, out_dir: str) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    pattern = os.path.join(out_dir, "frame_%03d.jpg")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vf",
        f"fps={FRAME_COUNT}/31,scale=960:480",
        "-frames:v",
        str(FRAME_COUNT),
        "-q:v",
        "4",
        pattern,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("frame_") and f.endswith(".jpg"))
    return files


def measure_frame_metrics(image_path: str) -> tuple[float, float]:
    """
    Uses ffmpeg to decode a downsampled 160x80 RGB24 buffer and computes:
    1) Average perceptual brightness (0..255)
    2) Bright cloud/highlight cover fraction (0..1)
    """
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        image_path,
        "-vf",
        "scale=160:80",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
    ]
    raw = subprocess.check_output(cmd)
    total_pixels = len(raw) // 3
    if total_pixels == 0:
        return 0.0, 0.0

    luma_sum = 0.0
    bright_pixels = 0

    for i in range(0, len(raw), 3):
        r = raw[i]
        g = raw[i + 1]
        b = raw[i + 2]
        luma = 0.299 * r + 0.587 * g + 0.114 * b
        luma_sum += luma
        # Measure bright cloud/highlight cover (high luma or bright cyan/white intensity)
        if luma > 165 or (r > 190 and g > 190 and b > 190):
            bright_pixels += 1

    avg_luma = luma_sum / total_pixels
    cloud_cover = bright_pixels / total_pixels
    return avg_luma, cloud_cover


def main():
    os.makedirs(OUTPUT_BASE, exist_ok=True)
    catalog_tracks = []
    start_utc = datetime(2023, 10, 16, 0, 0, tzinfo=timezone.utc)

    for track in TRACKS:
        track_dir = os.path.join(OUTPUT_BASE, track["id"])
        print(f"Extracting frames for {track['title']}...")
        files = extract_frames(track["videoPath"], track_dir)

        raw_metrics = []
        for fname in files:
            avg_luma, cloud_cover = measure_frame_metrics(os.path.join(track_dir, fname))
            raw_metrics.append((fname, avg_luma, cloud_cover))

        lumas = [m[1] for m in raw_metrics]
        clouds = [m[2] for m in raw_metrics]
        min_l, max_l = min(lumas), max(lumas)
        span_l = (max_l - min_l) or 1.0
        min_c, max_c = min(clouds), max(clouds)
        span_c = (max_c - min_c) or 1.0

        frames_data = []
        for idx, (fname, avg_luma, cloud_cover) in enumerate(raw_metrics):
            ts = start_utc + timedelta(hours=idx * 2)
            frames_data.append(
                {
                    "index": idx,
                    "imageUrl": f"/earth-now/{track['id']}/{fname}",
                    "timeLabel": ts.strftime("%Y-%m-%d %H:%M UTC"),
                    "brightness": round(avg_luma, 2),
                    "normalizedBrightness": round((avg_luma - min_l) / span_l, 4),
                    "cloudCover": round(cloud_cover * 100, 1),
                    "normalizedCloudCover": round((cloud_cover - min_c) / span_c, 4),
                }
            )

        catalog_tracks.append(
            {
                "id": track["id"],
                "title": track["title"],
                "svsId": track["svsId"],
                "sourceUrl": track["sourceUrl"],
                "primaryMetricName": track["primaryMetricName"],
                "primaryUnit": track["primaryUnit"],
                "secondaryMetricName": track["secondaryMetricName"],
                "secondaryUnit": track["secondaryUnit"],
                "soundPreview": track["soundPreview"],
                "audioLegend": track["audioLegend"],
                "frameCount": len(frames_data),
                "brightnessRange": [round(min_l, 2), round(max_l, 2)],
                "frames": frames_data,
            }
        )

    output_json = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourceGallery": "https://svs.gsfc.nasa.gov/gallery/earth-now-dashboard/",
        "tracks": catalog_tracks,
    }

    out_path = os.path.join(OUTPUT_BASE, "track.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output_json, f, indent=2)

    print(f"Wrote {out_path} with {len(catalog_tracks)} tracks.")


if __name__ == "__main__":
    main()
