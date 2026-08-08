/**
 * WWM v2 — Core Configuration
 *
 * Keep tunable values here instead of scattering
 * magic numbers throughout the navigation engine.
 */

/* -------------------------------------------------------------------------- */
/*                              RISK THRESHOLDS                               */
/* -------------------------------------------------------------------------- */

export const RISK_THRESHOLDS = {
  LOW: 0.25,
  MODERATE: 0.5,
  HIGH: 0.75,
  CRITICAL: 0.9,
} as const;

/* -------------------------------------------------------------------------- */
/*                              CONFIDENCE                                    */
/* -------------------------------------------------------------------------- */

export const CONFIDENCE_THRESHOLDS = {
  MINIMUM_PERCEPTION: 0.5,
  MINIMUM_SAFETY: 0.7,
  MINIMUM_GUIDANCE: 0.7,
} as const;

/* -------------------------------------------------------------------------- */
/*                              ENGINE TIMING                                 */
/* -------------------------------------------------------------------------- */

export const ENGINE_CONFIG = {
  /**
   * Initial development tick.
   *
   * This is deliberately conservative.
   * We will benchmark the real perception pipeline before
   * increasing the update frequency.
   */
  UPDATE_INTERVAL_MS: 500,

  /**
   * Prevents repeated guidance from being emitted continuously
   * when the state has not actually changed.
   */
  MIN_GUIDANCE_INTERVAL_MS: 1500,

  /**
   * Maximum time we allow an old world-state snapshot to remain
   * valid before considering it stale.
   */
  MAX_WORLD_STATE_AGE_MS: 2000,
} as const;

/* -------------------------------------------------------------------------- */
/*                              NAVIGATION                                    */
/* -------------------------------------------------------------------------- */

export const NAVIGATION_CONFIG = {
  /**
   * Approximate distance at which a local navigation decision
   * becomes relevant.
   *
   * This will be tuned using real-world testing.
   */
  LOCAL_DECISION_DISTANCE_M: 5,

  /**
   * Distance considered immediately dangerous.
   *
   * This is NOT the final safety threshold.
   * Safety decisions will eventually combine distance,
   * velocity, trajectory and XGBoost risk.
   */
  IMMEDIATE_DANGER_DISTANCE_M: 1,
} as const;

/* -------------------------------------------------------------------------- */
/*                              SENSOR                                         */
/* -------------------------------------------------------------------------- */

export const SENSOR_CONFIG = {
  /**
   * Maximum acceptable GPS accuracy for normal navigation.
   */
  MAX_GPS_ACCURACY_M: 15,

  /**
   * Minimum walking speed used as a preliminary heuristic.
   * The final walking-state detector will use sensor fusion.
   */
  MIN_WALKING_SPEED_MPS: 0.3,
} as const;
