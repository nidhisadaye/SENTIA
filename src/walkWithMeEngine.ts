import type { MutableRefObject, RefObject } from "react";
import type { WwmUrgency } from "./types";

export const MIN_FRAME_INTERVAL_MS = 800;
export const WWM_REQUEST_TIMEOUT_MS = 6000;

export const WWM_INTERVAL_DANGER = 600;
export const WWM_INTERVAL_STOP = 1000;
export const WWM_INTERVAL_CAUTION = 1800;
export const WWM_SCAN_INTERVAL_MS = 2800;

export const WWM_IMG_QUALITY = 0.55;
export const WWM_IMG_WIDTH = 480;
export const WWM_MAX_TOKENS = 220;
export const WWM_MIN_RESPONSE_LENGTH = 8;
export const WWM_CONTEXT_WINDOW = 4;
export const WWM_SILENCE_AFTER_CLEAR = 2;
export const WWM_MAX_CONSECUTIVE_ERRORS = 4;

export const WWM_ALWAYS_SPEAK_URGENCIES: WwmUrgency[] = ["DANGER", "STOP"];

export const WWM_VIBRATION: Record<WwmUrgency, number[]> = {
  CLEAR: [0, 50],
  CAUTION: [0, 80, 60, 80],
  STOP: [0, 200, 100, 200],
  DANGER: [0, 400, 100, 400, 100, 400],
};

export type WwmZone = "LEFT" | "CENTER" | "RIGHT" | "UNKNOWN";
export type WwmDist = "NEAR" | "MID" | "FAR" | "UNKNOWN";

export interface WwmDetectedObject {
  label: string;
  zone: WwmZone;
  distance: WwmDist;
  score: number;
}

export interface WwmFrameResult {
  urgency: WwmUrgency;
  spokenText: string;
  objects: WwmDetectedObject[];
  rawJson: WwmLlmResponse | null;
}

export interface WwmLlmResponse {
  urgency: string;
  message: string;
  objects: {
    label: string;
    zone: string;
    distance: string;
  }[];
}

export const CLASS_TIERS: Record<string, WwmUrgency> = {
  car: "DANGER",
  truck: "DANGER",
  bus: "DANGER",
  motorcycle: "DANGER",
  bicycle: "CAUTION",
  scooter: "DANGER",
  auto: "DANGER",
  vehicle: "DANGER",
  moving_car: "DANGER",
  train: "DANGER",
  tram: "DANGER",
  step: "STOP",
  stairs: "STOP",
  staircase: "STOP",
  curb: "STOP",
  pothole: "STOP",
  construction: "STOP",
  barrier: "STOP",
  bollard: "STOP",
  pole: "STOP",
  pillar: "STOP",
  gate: "STOP",
  door: "STOP",
  low_ceiling: "STOP",
  ramp: "CAUTION",
  slope: "CAUTION",
  puddle: "CAUTION",
  person: "CAUTION",
  dog: "CAUTION",
  animal: "CAUTION",
  crowd: "CAUTION",
  child: "CAUTION",
  cyclist: "CAUTION",
  sign: "CAUTION",
  cart: "CAUTION",
  stroller: "CAUTION",
  bench: "CAUTION",
  dustbin: "CAUTION",
  bin: "CAUTION",
  box: "CAUTION",
  luggage: "CAUTION",
  bag: "CAUTION",
  chair: "CAUTION",
  table: "CAUTION",
  cable: "STOP",
  wire: "STOP",
  sky: "CLEAR",
  wall: "CLEAR",
  floor: "CLEAR",
  pavement: "CLEAR",
  road: "CLEAR",
  path: "CLEAR",
  tree: "CLEAR",
  building: "CLEAR",
  window: "CLEAR",
  grass: "CLEAR",
};

const IGNORED_LABELS = new Set([
  "sky",
  "wall",
  "floor",
  "pavement",
  "road",
  "path",
  "tree",
  "building",
  "window",
  "grass",
  "ceiling",
]);

const URGENCY_BASE: Record<WwmUrgency, number> = {
  CLEAR: 0,
  CAUTION: 30,
  STOP: 60,
  DANGER: 100,
};

const DISTANCE_MULTIPLIER: Record<WwmDist, number> = {
  NEAR: 1.0,
  MID: 0.65,
  FAR: 0.3,
  UNKNOWN: 0.55,
};

const ZONE_MULTIPLIER: Record<WwmZone, number> = {
  CENTER: 1.0,
  LEFT: 0.75,
  RIGHT: 0.75,
  UNKNOWN: 0.6,
};

const URGENCY_TAG_RE = /\[(CLEAR|CAUTION|STOP|DANGER)\]/i;

export function priorityScore(label: string, zone: WwmZone, distance: WwmDist): number {
  const normalized = label.toLowerCase().replace(/\s+/g, "_");
  if (IGNORED_LABELS.has(normalized)) return 0;

  const tier = CLASS_TIERS[normalized] ?? "CAUTION";
  const base = URGENCY_BASE[tier];
  return Math.round(base * DISTANCE_MULTIPLIER[distance] * ZONE_MULTIPLIER[zone]);
}

export function scoreToUrgency(score: number): WwmUrgency {
  if (score >= 90) return "DANGER";
  if (score >= 55) return "STOP";
  if (score >= 20) return "CAUTION";
  return "CLEAR";
}

export function resolveUrgencyFromObjects(objects: WwmDetectedObject[]): WwmUrgency {
  if (objects.length === 0) return "CLEAR";
  const maxScore = Math.max(...objects.map((object) => object.score));
  return scoreToUrgency(maxScore);
}

export function getWwmStructuredPrompt(
  lang: string,
  compassHeading: number | null | undefined,
  contextBuffer: string[],
): string {
  const directionHint =
    compassHeading != null
      ? `The user is walking roughly ${Math.round(compassHeading)} degrees by compass.`
      : "";

  const ctxBlock =
    contextBuffer.length > 0
      ? `Recent frames: ${contextBuffer.slice(-2).join(" | ")}`
      : "";

  const langNote =
    lang === "hi"
      ? 'Write the "message" field in simple Hindi (Devanagari).'
      : lang === "mr"
        ? 'Write the "message" field in simple Marathi (Devanagari).'
        : 'Write the "message" field in plain English.';

  return `You are a real-time navigation assistant for a blind pedestrian. Analyze this camera frame.

${directionHint}
${ctxBlock}

Detect obstacles and hazards. For each object that matters for safe walking, note:
- label (single English word or short phrase, e.g. "car", "step", "person")
- zone: where it appears - LEFT, CENTER, or RIGHT third of the frame
- distance: NEAR (fills >40% height), MID (15-40%), or FAR (<15%)

Then choose the overall urgency:
- CLEAR   -> no meaningful obstacles
- CAUTION -> pedestrians, animals, minor obstacles
- STOP    -> steps, poles, construction blocking path
- DANGER  -> moving vehicles or immediate collision risk

${langNote}
The "message" must be 18 words or fewer, actionable, and spoken aloud to a blind person.

Respond ONLY with valid JSON matching this schema exactly:
{
  "urgency": "CLEAR"|"CAUTION"|"STOP"|"DANGER",
  "message": "<spoken text>",
  "objects": [
    { "label": "<string>", "zone": "LEFT"|"CENTER"|"RIGHT", "distance": "NEAR"|"MID"|"FAR" }
  ]
}`;
}

function parseZone(zone: string): WwmZone {
  const upper = zone?.toUpperCase();
  if (upper === "LEFT" || upper === "CENTER" || upper === "RIGHT") return upper;
  return "UNKNOWN";
}

function parseDist(distance: string): WwmDist {
  const upper = distance?.toUpperCase();
  if (upper === "NEAR" || upper === "MID" || upper === "FAR") return upper;
  return "UNKNOWN";
}

function parseUrgency(urgency: string): WwmUrgency {
  const upper = urgency?.toUpperCase();
  if (upper === "CLEAR" || upper === "CAUTION" || upper === "STOP" || upper === "DANGER") return upper;
  return "CLEAR";
}

function urgencyMax(a: WwmUrgency, b: WwmUrgency): WwmUrgency {
  const rank: Record<WwmUrgency, number> = { CLEAR: 0, CAUTION: 1, STOP: 2, DANGER: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export function parseWwmLlmResponse(raw: string): WwmFrameResult | null {
  if (!raw || raw.length < WWM_MIN_RESPONSE_LENGTH) return null;

  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const parsed: WwmLlmResponse = JSON.parse(cleaned);
    if (typeof parsed.urgency === "string" && typeof parsed.message === "string") {
      const llmUrgency = parseUrgency(parsed.urgency);

      const objects: WwmDetectedObject[] = (parsed.objects ?? [])
        .filter((object) => object?.label)
        .map((object) => {
          const zone = parseZone(object.zone);
          const distance = parseDist(object.distance);
          const label = object.label.toLowerCase().replace(/\s+/g, "_");
          return {
            label,
            zone,
            distance,
            score: priorityScore(label, zone, distance),
          };
        })
        .filter((object) => !IGNORED_LABELS.has(object.label));

      const computedUrgency = resolveUrgencyFromObjects(objects);
      const finalUrgency = urgencyMax(llmUrgency, computedUrgency);

      return {
        urgency: finalUrgency,
        spokenText: parsed.message.trim(),
        objects,
        rawJson: parsed,
      };
    }
  } catch {
    // Fall back to the legacy plain-text parser.
  }

  const tagMatch = raw.match(URGENCY_TAG_RE);
  const urgency = tagMatch ? parseUrgency(tagMatch[1]) : "CAUTION";
  const spokenText = raw
    .replace(URGENCY_TAG_RE, "")
    .replace(/\[.*?\]/g, "")
    .trim();

  if (!spokenText) return null;

  return {
    urgency,
    spokenText,
    objects: [],
    rawJson: null,
  };
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = WWM_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function shouldCaptureFrame(
  lastFrameTime: number,
  minIntervalMs: number = MIN_FRAME_INTERVAL_MS,
): boolean {
  return Date.now() - lastFrameTime >= minIntervalMs;
}

export function zonePrefix(object: WwmDetectedObject, lang: string): string {
  if (lang === "hi") {
    const zoneHi: Record<WwmZone, string> = {
      LEFT: "बाईं तरफ",
      CENTER: "सामने",
      RIGHT: "दाईं तरफ",
      UNKNOWN: "आगे",
    };
    const distHi: Record<WwmDist, string> = {
      NEAR: "बिल्कुल पास",
      MID: "पास",
      FAR: "दूर",
      UNKNOWN: "",
    };
    return `${zoneHi[object.zone]} ${distHi[object.distance]}`.trim();
  }

  if (lang === "mr") {
    const zoneMr: Record<WwmZone, string> = {
      LEFT: "डावीकडे",
      CENTER: "समोर",
      RIGHT: "उजवीकडे",
      UNKNOWN: "पुढे",
    };
    const distMr: Record<WwmDist, string> = {
      NEAR: "अगदी जवळ",
      MID: "जवळ",
      FAR: "दूर",
      UNKNOWN: "",
    };
    return `${zoneMr[object.zone]} ${distMr[object.distance]}`.trim();
  }

  const label = object.label.replace(/_/g, " ");
  const zoneEn: Record<WwmZone, string> = {
    LEFT: "on your left",
    CENTER: "straight ahead",
    RIGHT: "on your right",
    UNKNOWN: "ahead",
  };
  const distEn: Record<WwmDist, string> = {
    NEAR: "very close",
    MID: "nearby",
    FAR: "ahead",
    UNKNOWN: "",
  };

  return `${label} ${zoneEn[object.zone]}${object.distance !== "UNKNOWN" ? `, ${distEn[object.distance]}` : ""}`.trim();
}

function addSpatialContext(spokenText: string, object: WwmDetectedObject | undefined, lang: string): string {
  if (!object) return spokenText;

  const lower = spokenText.toLowerCase();
  const hasDirection = /left|right|ahead|straight|बाईं|दाईं|सामने|डावीकडे|उजवीकडे|समोर/.test(lower);
  if (hasDirection) return spokenText;

  const prefix = zonePrefix(object, lang);
  if (!prefix) return spokenText;
  return `${prefix}. ${spokenText}`.trim();
}

function mergeObjects(primary: WwmDetectedObject[], secondary: WwmDetectedObject[]): WwmDetectedObject[] {
  const byKey = new Map<string, WwmDetectedObject>();

  for (const object of [...primary, ...secondary]) {
    const key = `${object.label}:${object.zone}:${object.distance}`;
    const existing = byKey.get(key);
    if (!existing || object.score > existing.score) {
      byKey.set(key, object);
    }
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

function buildFallbackSpeech(object: WwmDetectedObject | undefined, lang: string, urgency: WwmUrgency): string {
  if (!object) {
    if (lang === "hi") return urgency === "CLEAR" ? "रास्ता साफ है" : "सावधानी से चलें";
    if (lang === "mr") return urgency === "CLEAR" ? "रस्ता मोकळा आहे" : "जपून चला";
    return urgency === "CLEAR" ? "Path clear" : "Move carefully";
  }

  const location = zonePrefix(object, lang);
  const label = object.label.replace(/_/g, " ");

  if (lang === "hi") {
    if (urgency === "DANGER") return `${location} ${label}, तुरंत रुकें`;
    if (urgency === "STOP") return `${location} ${label}, रुकें`;
    return `${location} ${label}, सावधानी से चलें`;
  }

  if (lang === "mr") {
    if (urgency === "DANGER") return `${location} ${label}, लगेच थांबा`;
    if (urgency === "STOP") return `${location} ${label}, थांबा`;
    return `${location} ${label}, जपून चला`;
  }

  if (urgency === "DANGER") return `${label} ${location}, stop immediately`;
  if (urgency === "STOP") return `${label} ${location}, stop`;
  return `${label} ${location}, move carefully`;
}

export interface WwmFrameDependencies {
  cameraRef: RefObject<any>;
  lang: string;
  cameraReady: boolean;
  phoneTilted: boolean;
  isWalkWithMe: boolean;
  compassHeading: number | null | undefined;
  contextBuffer: string[];
  lastFrameTime: number;
  setLastFrameTime: (time: number) => void;
  setStatus: (status: string) => void;
  setDescription: (description: string) => void;
  setWwmStatus: (urgency: WwmUrgency) => void;
  onUrgencyChange: (urgency: WwmUrgency) => void;
  onSpeak: (text: string, urgency: WwmUrgency) => Promise<void>;
  onVibrate: (pattern: number[]) => void;
  onContextAppend: (entry: string) => void;
  onTiltSkip: () => void;
  onError: (error: Error) => void;
  detectObjectsWithYolo?: (base64: string, signal: AbortSignal) => Promise<WwmDetectedObject[]>;
  callVisionWithSignal: (
    base64: string,
    lang: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<string>;
  ImageManipulator: {
    manipulateAsync: (...args: any[]) => Promise<any>;
    SaveFormat: { JPEG: any };
  };
}

export async function processWwmFrame(
  deps: WwmFrameDependencies,
  wwmProcessingRef: MutableRefObject<boolean>,
  wwmLastResponseRef: MutableRefObject<string>,
  wwmClearStreakRef: MutableRefObject<number>,
  wwmCurrentUrgencyRef: MutableRefObject<WwmUrgency>,
  wwmTiltSkipsRef: MutableRefObject<number>,
): Promise<WwmFrameResult | null> {
  const {
    cameraRef,
    lang,
    cameraReady,
    phoneTilted,
    isWalkWithMe,
    compassHeading,
    contextBuffer,
    lastFrameTime,
    setLastFrameTime,
    setStatus,
    setDescription,
    setWwmStatus,
    onUrgencyChange,
    onSpeak,
    onVibrate,
    onContextAppend,
    onTiltSkip,
    onError,
    detectObjectsWithYolo,
    callVisionWithSignal,
    ImageManipulator,
  } = deps;

  if (phoneTilted) {
    wwmTiltSkipsRef.current = Math.min(wwmTiltSkipsRef.current + 1, 9999);
    onTiltSkip();
    return null;
  }

  if (!shouldCaptureFrame(lastFrameTime)) return null;
  if (wwmProcessingRef.current) return null;
  if (!cameraRef.current || !cameraReady) return null;

  wwmProcessingRef.current = true;
  setLastFrameTime(Date.now());

  try {
    setStatus("WWM: capturing...");

    const photo = await cameraRef.current.takePictureAsync({
      quality: WWM_IMG_QUALITY,
      base64: true,
      skipProcessing: false,
    });

    if (!photo?.base64 || !isWalkWithMe) return null;

    setStatus("WWM: resizing...");

    const resized = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ resize: { width: WWM_IMG_WIDTH } }],
      {
        base64: true,
        compress: WWM_IMG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );

    if (!resized.base64 || !isWalkWithMe) return null;

    let yoloObjects: WwmDetectedObject[] = [];
    if (detectObjectsWithYolo) {
      try {
        yoloObjects = await withTimeout(
          (signal) => detectObjectsWithYolo(resized.base64, signal),
          Math.min(WWM_REQUEST_TIMEOUT_MS, 4500),
        );
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          // Keep the frame alive even if YOLO fails; the LLM remains the fallback.
          console.log("YOLOv8 detection failed:", error?.message ?? error);
        }
      }
    }

    const yoloContext =
      yoloObjects.length > 0
        ? `\nGrounding detections from YOLOv8: ${yoloObjects
            .slice(0, 4)
            .map((object) => `${object.label}:${object.zone}:${object.distance}`)
            .join(", ")}.`
        : "";
    const prompt = `${getWwmStructuredPrompt(lang, compassHeading, contextBuffer)}${yoloContext}`;
    setStatus("WWM: analyzing...");

    let rawResult = "";
    try {
      rawResult = await withTimeout(
        (signal) => callVisionWithSignal(resized.base64, lang, prompt, signal),
        WWM_REQUEST_TIMEOUT_MS,
      );
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setStatus("WWM: timeout - skipping frame");
        return null;
      }
      throw error;
    }

    if (!isWalkWithMe) return null;

    const parsedResult =
      rawResult && rawResult.length >= WWM_MIN_RESPONSE_LENGTH ? parseWwmLlmResponse(rawResult) : null;
    const objects = mergeObjects(parsedResult?.objects ?? [], yoloObjects);
    const topObject = objects[0];
    const detectorUrgency = resolveUrgencyFromObjects(objects);
    const urgency = parsedResult ? urgencyMax(parsedResult.urgency, detectorUrgency) : detectorUrgency;
    const baseSpokenText = parsedResult?.spokenText?.trim() || buildFallbackSpeech(topObject, lang, urgency);
    const spokenText = addSpatialContext(baseSpokenText, topObject, lang);

    if (!parsedResult && objects.length === 0) {
      setStatus("WWM: no response");
      return null;
    }

    wwmCurrentUrgencyRef.current = urgency;
    setWwmStatus(urgency);
    onUrgencyChange(urgency);
    setStatus(`WWM: ${urgency.toLowerCase()}`);

    const contextEntry = topObject
      ? `[${urgency}] ${spokenText} (${topObject.label} ${topObject.zone} ${topObject.distance})`
      : `[${urgency}] ${spokenText}`;
    onContextAppend(contextEntry);

    const isDuplicate = spokenText === wwmLastResponseRef.current;
    const mustSpeak = WWM_ALWAYS_SPEAK_URGENCIES.includes(urgency);

    if (urgency === "CLEAR") {
      wwmClearStreakRef.current += 1;
      onVibrate(WWM_VIBRATION.CLEAR);

      if (wwmClearStreakRef.current <= WWM_SILENCE_AFTER_CLEAR) {
        wwmLastResponseRef.current = spokenText;
        setDescription(spokenText);
        await onSpeak(spokenText, "CLEAR");
      } else if (wwmClearStreakRef.current % 4 === 0) {
        onVibrate(WWM_VIBRATION.CLEAR);
      }
    } else {
      wwmClearStreakRef.current = 0;

      if (!isDuplicate || mustSpeak) {
        wwmLastResponseRef.current = spokenText;
        setDescription(spokenText);
        onVibrate(WWM_VIBRATION[urgency]);

        if (urgency === "DANGER") {
          await onSpeak(spokenText, urgency);
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          if (isWalkWithMe) await onSpeak(spokenText, urgency);
        } else {
          await onSpeak(spokenText, urgency);
        }
      } else {
        onVibrate(WWM_VIBRATION.CAUTION);
      }
    }

    return {
      urgency,
      spokenText,
      objects,
      rawJson: parsedResult?.rawJson ?? null,
    };
  } catch (error: any) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return null;
  } finally {
    wwmProcessingRef.current = false;
  }
}
