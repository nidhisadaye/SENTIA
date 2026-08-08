/**
 * WWM v2 — Core Type Definitions
 *
 * This file defines the shared data contracts between:
 * perception, sensors, world model, risk, navigation,
 * safety, guidance, and UI.
 */

/* -------------------------------------------------------------------------- */
/*                              BASIC GEOMETRY                                */
/* -------------------------------------------------------------------------- */

export type WWMZone = "left" | "center" | "right";

export type DistanceCategory = "near" | "mid" | "far" | "unknown";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */
/*                              PERCEPTION                                    */
/* -------------------------------------------------------------------------- */

export interface DetectedObject {
  id: string;
  label: string;

  confidence: number;

  boundingBox: BoundingBox;

  zone: WWMZone;

  distance?: number;
  distanceCategory: DistanceCategory;

  isMoving?: boolean;
  velocityMps?: number;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                              FREE SPACE                                    */
/* -------------------------------------------------------------------------- */

export interface FreeSpace {
  left: number;
  center: number;
  right: number;

  confidence: number;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                                USER STATE                                  */
/* -------------------------------------------------------------------------- */

export interface UserState {
  latitude?: number;
  longitude?: number;

  heading?: number;

  speedMps?: number;

  isWalking: boolean;

  stepRate?: number;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                                ROUTE STATE                                 */
/* -------------------------------------------------------------------------- */

export type NavigationManeuver =
  | "straight"
  | "turn_left"
  | "turn_right"
  | "u_turn"
  | "arrive"
  | "unknown";

export interface RouteState {
  active: boolean;

  maneuver: NavigationManeuver;

  distanceToManeuverM?: number;

  destination?: string;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                                RISK STATE                                  */
/* -------------------------------------------------------------------------- */

export type RiskLevel = "low" | "moderate" | "high" | "critical" | "unknown";

export interface RiskState {
  probability: number;

  level: RiskLevel;

  confidence: number;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                              SAFETY STATE                                  */
/* -------------------------------------------------------------------------- */

export type SafetyAction =
  | "continue"
  | "caution"
  | "avoid_left"
  | "avoid_right"
  | "stop"
  | "unknown";

export interface SafetyState {
  action: SafetyAction;

  reason?: string;

  confidence: number;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                              GUIDANCE STATE                                 */
/* -------------------------------------------------------------------------- */

export type GuidanceState =
  | "idle"
  | "starting"
  | "calibrating"
  | "clear"
  | "caution"
  | "avoid_left"
  | "avoid_right"
  | "turn_left"
  | "turn_right"
  | "stop"
  | "recalculating"
  | "unknown"
  | "error";

export interface GuidanceStateData {
  state: GuidanceState;

  instruction?: string;

  reason?: string;

  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                              WORLD MODEL                                   */
/* -------------------------------------------------------------------------- */

export interface WWMWorldState {
  timestamp: number;

  user: UserState;

  route: RouteState;

  objects: DetectedObject[];

  freeSpace?: FreeSpace;

  risk: RiskState;

  safety: SafetyState;

  guidance: GuidanceStateData;
}

/* -------------------------------------------------------------------------- */
/*                              ENGINE STATE                                  */
/* -------------------------------------------------------------------------- */

export type WWMEngineStatus =
  | "idle"
  | "initializing"
  | "running"
  | "paused"
  | "stopped"
  | "error";

export interface WWMEngineState {
  status: WWMEngineStatus;

  world: WWMWorldState;

  error?: string;
}

/* -------------------------------------------------------------------------- */
/*                              ENGINE EVENTS                                 */
/* -------------------------------------------------------------------------- */

export type WWMEvent =
  | { type: "START" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "RESET" };

export type WWMStateListener = (state: WWMEngineState) => void;
