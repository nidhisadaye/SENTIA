import type { WwmUrgency } from "./types";
import type { WwmDetectedObject, WwmDist, WwmZone } from "./walkWithMeEngine";
import { priorityScore, resolveUrgencyFromObjects } from "./walkWithMeEngine";

export interface YoloRawPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
  confidence: number;
}

export interface YoloResponse {
  predictions?: YoloRawPrediction[];
  image?: {
    width: number;
    height: number;
  };
}

export interface YoloDetectionSummary {
  objects: WwmDetectedObject[];
  urgency: WwmUrgency;
}

export function zoneFromCenterX(x: number, imageWidth: number): WwmZone {
  if (!imageWidth || Number.isNaN(imageWidth)) return "UNKNOWN";
  if (x < imageWidth / 3) return "LEFT";
  if (x > (imageWidth * 2) / 3) return "RIGHT";
  return "CENTER";
}

export function distanceFromHeightRatio(height: number, imageHeight: number): WwmDist {
  if (!imageHeight || Number.isNaN(imageHeight)) return "UNKNOWN";
  const ratio = height / imageHeight;
  if (ratio > 0.4) return "NEAR";
  if (ratio >= 0.15) return "MID";
  if (ratio > 0) return "FAR";
  return "UNKNOWN";
}

export function normalizeYoloDetections(
  detections: YoloRawPrediction[],
  imageWidth: number,
  imageHeight: number,
  minConfidence: number = 0.35,
): YoloDetectionSummary {
  const objects = detections
    .filter((prediction) => prediction.class && prediction.confidence >= minConfidence)
    .map((prediction) => {
      const label = prediction.class.toLowerCase().replace(/\s+/g, "_");
      const zone = zoneFromCenterX(prediction.x, imageWidth);
      const distance = distanceFromHeightRatio(prediction.height, imageHeight);
      return {
        label,
        zone,
        distance,
        score: priorityScore(label, zone, distance),
      };
    })
    .filter((object) => object.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    objects,
    urgency: resolveUrgencyFromObjects(objects),
  };
}

export function buildYoloContext(objects: WwmDetectedObject[], maxObjects: number = 4): string {
  if (objects.length === 0) return "";

  const summary = objects
    .slice(0, maxObjects)
    .map((object) => `${object.label}:${object.zone}:${object.distance}`)
    .join(", ");

  return `YOLOv8 detections: ${summary}. Use these as grounding hints, but only mention hazards actually relevant for walking.`;
}

