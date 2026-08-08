import {
    BoundingBox,
    DetectedObject,
    DistanceCategory,
    WWMZone,
} from "../types";

/**
 * WWM v2 — Object Tracker
 *
 * Associates DetectedObject[] across consecutive frames into stable
 * TrackedObject[] with persistent IDs.
 *
 * This class intentionally does NOT:
 * - Perform object detection or run YOLO (input is already DetectedObject[])
 * - Estimate physical depth/distance
 * - Calculate risk or use XGBoost
 * - Make safety decisions
 * - Perform navigation
 * - Generate guidance
 * - Call an LLM
 * - Modify WWMEngine
 *
 * NOTE ON TYPES: `types.ts` does not currently define a TrackedObject
 * (or any track-related) type. Rather than modify `types.ts`, the
 * minimal contract needed for tracking is defined locally below,
 * following the same pattern ObjectDetector.ts uses for
 * RawDetectionPrediction.
 *
 * ASSOCIATION METHOD (baseline, deterministic):
 * A detection may match an existing track only if they share the same
 * normalized label AND either:
 *   - their bounding boxes' IoU >= iouThreshold, OR
 *   - their bounding-box centers are within maxCenterDistancePx
 * Candidate (track, detection) pairs are sorted deterministically
 * (highest IoU first, then closest center distance, then detection
 * index, then track id) and assigned greedily, one-to-one. This is a
 * deliberately simple baseline — no Kalman filter, optical flow,
 * DeepSORT, ByteTrack, or appearance embeddings.
 */

/* -------------------------------------------------------------------------- */
/*                              TRACKED OBJECT                                */
/* -------------------------------------------------------------------------- */

/**
 * Minimal track contract. Not present in types.ts — defined locally.
 * See NOTE ON TYPES above.
 */
export interface TrackedObject {
  /** Stable track ID that persists across frames. */
  id: string;

  /** Normalized label of the most recent matched detection. */
  label: string;

  /** Latest known bounding box for this track. */
  boundingBox: BoundingBox;

  /** Confidence of the most recent matched detection. */
  confidence: number;

  /** Latest image-space zone. */
  zone: WWMZone;

  /**
   * Latest distanceCategory, passed through as-is from the matched
   * DetectedObject. This is an image-space heuristic — NOT physical
   * distance — and must not be treated as such here either.
   */
  distanceCategory: DistanceCategory;

  /**
   * Passed through unchanged from the matched DetectedObject, only
   * when the detector actually supplied it. The tracker never
   * computes or infers movement/velocity itself — doing so reliably
   * would require physical distance data this pipeline does not have.
   */
  isMoving?: boolean;
  velocityMps?: number;

  /** Timestamp this track was first created. */
  firstSeen: number;

  /** Timestamp of the most recent frame this track was matched in. */
  lastSeen: number;

  /**
   * Number of consecutive frames this track has been matched,
   * including the current one. Resets to 0 on any missed frame.
   */
  consecutiveObservations: number;

  /**
   * Number of consecutive frames since this track was last matched.
   * Resets to 0 whenever the track is matched again.
   */
  missedFrames: number;

  /** id of the DetectedObject this track was most recently matched to. */
  lastDetectionId: string;
}

/* -------------------------------------------------------------------------- */
/*                                  CONFIG                                    */
/* -------------------------------------------------------------------------- */

export interface ObjectTrackerConfig {
  /**
   * Minimum IoU (intersection over union) between a track's last
   * bounding box and a candidate detection's bounding box for them to
   * be considered a match. Default: 0.3.
   */
  iouThreshold?: number;

  /**
   * Fallback match criterion: maximum pixel distance between
   * bounding-box centers for a track and a candidate detection to
   * still be considered a match, even if IoU is low (e.g. a small,
   * fast-moving object). Default: 64px.
   */
  maxCenterDistancePx?: number;

  /**
   * Number of consecutive missed frames a track may accumulate before
   * it is removed. Default: 5.
   */
  maxMissedFrames?: number;
}

/* -------------------------------------------------------------------------- */
/*                              OBJECT TRACKER                                */
/* -------------------------------------------------------------------------- */

interface CandidatePair {
  trackId: string;
  detectionIndex: number;
  iou: number;
  centerDistance: number;
}

export class ObjectTracker {
  private readonly iouThreshold: number;
  private readonly maxCenterDistancePx: number;
  private readonly maxMissedFrames: number;

  private tracks = new Map<string, TrackedObject>();

  /**
   * Monotonic counter used to generate stable, deterministic track
   * IDs and preserve creation order for output ordering. Reset by
   * reset().
   */
  private trackCounter = 0;

  /** Creation order per track id, used only for deterministic output ordering. */
  private trackSequence = new Map<string, number>();

  constructor(config: ObjectTrackerConfig = {}) {
    this.iouThreshold = config.iouThreshold ?? 0.3;
    this.maxCenterDistancePx = config.maxCenterDistancePx ?? 64;
    this.maxMissedFrames = config.maxMissedFrames ?? 5;
  }

  /**
   * Advance the tracker by one frame.
   *
   * @param detections  Detections for this frame (from ObjectDetector).
   * @param timestamp   Caller-supplied frame timestamp. Must be a
   *                    finite number. Date.now() is never called
   *                    internally so matching stays deterministic and
   *                    testable.
   */
  public update(
    detections: DetectedObject[],
    timestamp: number,
  ): TrackedObject[] {
    if (!this.isValidTimestamp(timestamp)) {
      // Invalid timestamp: do not mutate state, just return the
      // current snapshot unchanged.
      return this.snapshot();
    }

    const pairs = this.buildCandidatePairs(detections);
    const { matchedTrackIds, matchedDetectionIndices } =
      this.assignGreedy(pairs);

    this.applyMatches(detections, matchedTrackIds, timestamp);
    this.applyMisses(matchedTrackIds);
    this.pruneStaleTracks();
    this.createTracksForUnmatched(
      detections,
      matchedDetectionIndices,
      timestamp,
    );

    return this.snapshot();
  }

  /**
   * Clear all tracks and reset internal counters.
   */
  public reset(): void {
    this.tracks.clear();
    this.trackSequence.clear();
    this.trackCounter = 0;
  }

  /* ------------------------------------------------------------------------ */
  /*                              VALIDATION                                  */
  /* ------------------------------------------------------------------------ */

  private isValidTimestamp(timestamp: number): boolean {
    return Number.isFinite(timestamp);
  }

  /* ------------------------------------------------------------------------ */
  /*                              ASSOCIATION                                 */
  /* ------------------------------------------------------------------------ */

  private buildCandidatePairs(detections: DetectedObject[]): CandidatePair[] {
    const pairs: CandidatePair[] = [];

    for (const track of this.tracks.values()) {
      for (
        let detectionIndex = 0;
        detectionIndex < detections.length;
        detectionIndex += 1
      ) {
        const detection = detections[detectionIndex];

        if (
          this.normalizeLabel(detection.label) !==
          this.normalizeLabel(track.label)
        ) {
          continue;
        }

        const iou = this.computeIoU(track.boundingBox, detection.boundingBox);
        const centerDistance = this.computeCenterDistance(
          track.boundingBox,
          detection.boundingBox,
        );

        if (
          iou >= this.iouThreshold ||
          centerDistance <= this.maxCenterDistancePx
        ) {
          pairs.push({
            trackId: track.id,
            detectionIndex,
            iou,
            centerDistance,
          });
        }
      }
    }

    // Deterministic ordering: best IoU first, then closest center,
    // then earliest detection index, then track id (string compare)
    // as a final, stable tie-break.
    pairs.sort((a, b) => {
      if (b.iou !== a.iou) {
        return b.iou - a.iou;
      }

      if (a.centerDistance !== b.centerDistance) {
        return a.centerDistance - b.centerDistance;
      }

      if (a.detectionIndex !== b.detectionIndex) {
        return a.detectionIndex - b.detectionIndex;
      }

      return a.trackId.localeCompare(b.trackId);
    });

    return pairs;
  }

  private assignGreedy(pairs: CandidatePair[]): {
    matchedTrackIds: Map<string, number>;
    matchedDetectionIndices: Set<number>;
  } {
    const matchedTrackIds = new Map<string, number>();
    const matchedDetectionIndices = new Set<number>();

    for (const pair of pairs) {
      if (
        matchedTrackIds.has(pair.trackId) ||
        matchedDetectionIndices.has(pair.detectionIndex)
      ) {
        continue;
      }

      matchedTrackIds.set(pair.trackId, pair.detectionIndex);
      matchedDetectionIndices.add(pair.detectionIndex);
    }

    return { matchedTrackIds, matchedDetectionIndices };
  }

  private applyMatches(
    detections: DetectedObject[],
    matchedTrackIds: Map<string, number>,
    timestamp: number,
  ): void {
    for (const [trackId, detectionIndex] of matchedTrackIds) {
      const track = this.tracks.get(trackId);

      if (!track) {
        continue;
      }

      const detection = detections[detectionIndex];

      track.label = detection.label;
      track.boundingBox = detection.boundingBox;
      track.confidence = detection.confidence;
      track.zone = detection.zone;
      track.distanceCategory = detection.distanceCategory;
      track.isMoving = detection.isMoving;
      track.velocityMps = detection.velocityMps;
      track.lastSeen = timestamp;
      track.consecutiveObservations += 1;
      track.missedFrames = 0;
      track.lastDetectionId = detection.id;
    }
  }

  private applyMisses(matchedTrackIds: Map<string, number>): void {
    for (const track of this.tracks.values()) {
      if (matchedTrackIds.has(track.id)) {
        continue;
      }

      track.missedFrames += 1;
      track.consecutiveObservations = 0;
    }
  }

  private pruneStaleTracks(): void {
    for (const [id, track] of this.tracks) {
      if (track.missedFrames > this.maxMissedFrames) {
        this.tracks.delete(id);
        this.trackSequence.delete(id);
      }
    }
  }

  private createTracksForUnmatched(
    detections: DetectedObject[],
    matchedDetectionIndices: Set<number>,
    timestamp: number,
  ): void {
    for (
      let detectionIndex = 0;
      detectionIndex < detections.length;
      detectionIndex += 1
    ) {
      if (matchedDetectionIndices.has(detectionIndex)) {
        continue;
      }

      const detection = detections[detectionIndex];
      const id = this.nextTrackId();

      const track: TrackedObject = {
        id,
        label: detection.label,
        boundingBox: detection.boundingBox,
        confidence: detection.confidence,
        zone: detection.zone,
        distanceCategory: detection.distanceCategory,
        isMoving: detection.isMoving,
        velocityMps: detection.velocityMps,
        firstSeen: timestamp,
        lastSeen: timestamp,
        consecutiveObservations: 1,
        missedFrames: 0,
        lastDetectionId: detection.id,
      };

      this.tracks.set(id, track);
      this.trackSequence.set(id, this.trackCounter);
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                                GEOMETRY                                  */
  /* ------------------------------------------------------------------------ */

  private computeIoU(a: BoundingBox, b: BoundingBox): number {
    const aX2 = a.x + a.width;
    const aY2 = a.y + a.height;
    const bX2 = b.x + b.width;
    const bY2 = b.y + b.height;

    const intersectX1 = Math.max(a.x, b.x);
    const intersectY1 = Math.max(a.y, b.y);
    const intersectX2 = Math.min(aX2, bX2);
    const intersectY2 = Math.min(aY2, bY2);

    const intersectWidth = Math.max(0, intersectX2 - intersectX1);
    const intersectHeight = Math.max(0, intersectY2 - intersectY1);
    const intersectArea = intersectWidth * intersectHeight;

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const unionArea = areaA + areaB - intersectArea;

    if (unionArea <= 0) {
      return 0;
    }

    return intersectArea / unionArea;
  }

  private computeCenterDistance(a: BoundingBox, b: BoundingBox): number {
    const aCenterX = a.x + a.width / 2;
    const aCenterY = a.y + a.height / 2;
    const bCenterX = b.x + b.width / 2;
    const bCenterY = b.y + b.height / 2;

    return Math.hypot(aCenterX - bCenterX, aCenterY - bCenterY);
  }

  /* ------------------------------------------------------------------------ */
  /*                                  UTIL                                    */
  /* ------------------------------------------------------------------------ */

  private normalizeLabel(label: string): string {
    return label.toLowerCase().trim().replace(/\s+/g, "_");
  }

  private nextTrackId(): string {
    this.trackCounter += 1;

    return `track-${this.trackCounter}`;
  }

  /**
   * Return active tracks in stable, deterministic creation order.
   */
  private snapshot(): TrackedObject[] {
    return Array.from(this.tracks.values()).sort((a, b) => {
      const seqA = this.trackSequence.get(a.id) ?? 0;
      const seqB = this.trackSequence.get(b.id) ?? 0;

      return seqA - seqB;
    });
  }
}
