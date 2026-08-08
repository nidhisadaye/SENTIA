import {
    BoundingBox,
    DetectedObject,
    DistanceCategory,
    WWMZone,
} from "../types";

import { CONFIDENCE_THRESHOLDS } from "../constants";

/**
 * WWM v2 — Object Detector
 *
 * A clean, runtime-agnostic abstraction around "raw detector output ->
 * WWM v2 DetectedObject[]".
 *
 * This class intentionally does NOT:
 * - Run inference (no YOLO / TFLite / ONNX runtime is invoked here)
 * - Estimate real-world physical distance or depth
 * - Track objects across frames (that is ObjectTracker's job)
 * - Score risk, priority, or urgency
 * - Make safety or navigation decisions
 * - Call an LLM
 *
 * It is deliberately decoupled from the legacy `src/yolov8.ts` /
 * `walkWithMeEngine.ts` pipeline: it does not import from either file,
 * and does not use any of their concepts (WwmUrgency, priorityScore,
 * resolveUrgencyFromObjects, WwmDetectedObject, WwmDist, WwmZone).
 * A real YOLO runtime can be wired in later by calling `detect()`
 * with its raw predictions — nothing else in WWM needs to change.
 */

/* -------------------------------------------------------------------------- */
/*                          RAW PREDICTION SHAPE                              */
/* -------------------------------------------------------------------------- */

/**
 * Shape of a single raw prediction coming out of an object-detection
 * model. Defined locally (rather than imported from `yolov8.ts`) to
 * avoid coupling ObjectDetector to the legacy engine.
 *
 * Follows the common YOLO/Roboflow convention: `x` and `y` are the
 * CENTER of the bounding box, not the top-left corner.
 */
export interface RawDetectionPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
  confidence: number;
}

/**
 * Optional configuration for an ObjectDetector instance.
 */
export interface ObjectDetectorConfig {
  /**
   * Minimum confidence a prediction must meet to be kept.
   * Defaults to CONFIDENCE_THRESHOLDS.MINIMUM_PERCEPTION.
   */
  minConfidence?: number;
}

/* -------------------------------------------------------------------------- */
/*                              OBJECT DETECTOR                               */
/* -------------------------------------------------------------------------- */

export class ObjectDetector {
  private readonly minConfidence: number;

  /**
   * Monotonic counter used only to guarantee unique detection IDs
   * within a single process lifetime. It has no semantic meaning and
   * is not a track ID — ObjectTracker is responsible for associating
   * detections across frames into stable tracks.
   */
  private detectionCounter = 0;

  constructor(config: ObjectDetectorConfig = {}) {
    this.minConfidence =
      config.minConfidence ?? CONFIDENCE_THRESHOLDS.MINIMUM_PERCEPTION;
  }

  /**
   * Convert raw detector predictions into WWM v2 DetectedObject[].
   *
   * @param predictions  Raw predictions for a single frame.
   * @param imageWidth   Width (px) of the image the predictions were computed on.
   * @param imageHeight  Height (px) of the image the predictions were computed on.
   * @param timestamp    Optional capture timestamp; defaults to Date.now().
   */
  public detect(
    predictions: RawDetectionPrediction[],
    imageWidth: number,
    imageHeight: number,
    timestamp: number = Date.now(),
  ): DetectedObject[] {
    return predictions
      .filter((prediction) => this.isValidPrediction(prediction))
      .map((prediction, index) =>
        this.toDetectedObject(
          prediction,
          imageWidth,
          imageHeight,
          timestamp,
          index,
        ),
      );
  }

  /* ------------------------------------------------------------------------ */
  /*                              VALIDATION                                  */
  /* ------------------------------------------------------------------------ */

  private isValidPrediction(prediction: RawDetectionPrediction): boolean {
    if (!prediction) {
      return false;
    }

    if (!prediction.class || typeof prediction.class !== "string") {
      return false;
    }

    if (
      !Number.isFinite(prediction.x) ||
      !Number.isFinite(prediction.y) ||
      !Number.isFinite(prediction.width) ||
      !Number.isFinite(prediction.height)
    ) {
      return false;
    }

    if (prediction.width <= 0 || prediction.height <= 0) {
      return false;
    }

    if (
      !Number.isFinite(prediction.confidence) ||
      prediction.confidence < this.minConfidence
    ) {
      return false;
    }

    return true;
  }

  /* ------------------------------------------------------------------------ */
  /*                              CONVERSION                                  */
  /* ------------------------------------------------------------------------ */

  private toDetectedObject(
    prediction: RawDetectionPrediction,
    imageWidth: number,
    imageHeight: number,
    timestamp: number,
    index: number,
  ): DetectedObject {
    return {
      id: this.nextDetectionId(timestamp, index),
      label: this.normalizeLabel(prediction.class),
      confidence: prediction.confidence,
      boundingBox: this.toBoundingBox(prediction),
      zone: this.resolveZone(prediction.x, imageWidth),
      distanceCategory: this.resolveDistanceCategoryHeuristic(
        prediction.height,
        imageHeight,
      ),
      timestamp,
    };
  }

  private normalizeLabel(rawClass: string): string {
    return rawClass.toLowerCase().trim().replace(/\s+/g, "_");
  }

  /**
   * Convert a center-based raw box (x, y = center) into the top-left
   * based BoundingBox shape used by WWM v2.
   */
  private toBoundingBox(prediction: RawDetectionPrediction): BoundingBox {
    return {
      x: prediction.x - prediction.width / 2,
      y: prediction.y - prediction.height / 2,
      width: prediction.width,
      height: prediction.height,
    };
  }

  /**
   * Image-space left/center/right zone, based on the horizontal
   * position of the box center within the frame.
   */
  private resolveZone(centerX: number, imageWidth: number): WWMZone {
    if (!imageWidth || !Number.isFinite(imageWidth)) {
      return "center";
    }

    if (centerX < imageWidth / 3) {
      return "left";
    }

    if (centerX > (imageWidth * 2) / 3) {
      return "right";
    }

    return "center";
  }

  /**
   * TEMPORARY HEURISTIC ONLY.
   *
   * Approximates a near/mid/far bucket purely from how much of the
   * frame's height the bounding box occupies. This is an image-space
   * proxy, NOT a physical distance measurement — it says nothing
   * about actual real-world distance in meters, and will be replaced
   * once real depth estimation is implemented. Do not treat this as
   * ground truth for safety or navigation decisions.
   */
  private resolveDistanceCategoryHeuristic(
    boxHeight: number,
    imageHeight: number,
  ): DistanceCategory {
    if (!imageHeight || !Number.isFinite(imageHeight)) {
      return "unknown";
    }

    const heightRatio = boxHeight / imageHeight;

    if (heightRatio > 0.4) {
      return "near";
    }

    if (heightRatio >= 0.15) {
      return "mid";
    }

    if (heightRatio > 0) {
      return "far";
    }

    return "unknown";
  }

  /**
   * Produce a detection ID that is stable and unique for this
   * detector instance's lifetime, suitable as an input to
   * ObjectTracker for cross-frame association. This is a per-frame
   * detection ID, not a persistent track ID.
   */
  private nextDetectionId(timestamp: number, index: number): string {
    this.detectionCounter += 1;

    return `det-${timestamp}-${index}-${this.detectionCounter}`;
  }
}
