import {
    GuidanceState,
    WWMEngineState,
    WWMEngineStatus,
    WWMEvent,
    WWMStateListener,
    WWMWorldState,
} from "./types";

import { ENGINE_CONFIG, RISK_THRESHOLDS } from "./constants";

/**
 * WWM v2 — Core Engine
 *
 * Responsibilities:
 * - Own the current WWM state
 * - Start / pause / resume / stop the engine
 * - Notify subscribers when state changes
 * - Provide a controlled entry point for future
 *   perception, sensors, risk, navigation and guidance modules
 *
 * This class intentionally does NOT perform:
 * - Camera processing
 * - YOLO inference
 * - Depth estimation
 * - XGBoost inference
 * - GPS processing
 * - LLM calls
 *
 * Those responsibilities will be added as independent modules.
 */

export class WWMEngine {
  private state: WWMEngineState;

  private listeners = new Set<WWMStateListener>();

  private updateTimer?: ReturnType<typeof setInterval>;

  private lastGuidanceTimestamp = 0;

  constructor() {
    this.state = this.createInitialState();
  }

  /* ------------------------------------------------------------------------ */
  /*                              PUBLIC API                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * Start the WWM engine.
   */
  public start(): void {
    if (
      this.state.status === "running" ||
      this.state.status === "initializing"
    ) {
      return;
    }

    this.setStatus("initializing");

    this.setGuidance("starting", "Starting Walk With Me");

    this.startUpdateLoop();

    this.setStatus("running");

    this.setGuidance("calibrating", "Calibrating sensors");
  }

  /**
   * Pause WWM processing without destroying the current state.
   */
  public pause(): void {
    if (this.state.status !== "running") {
      return;
    }

    this.stopUpdateLoop();

    this.setStatus("paused");
  }

  /**
   * Resume WWM processing.
   */
  public resume(): void {
    if (this.state.status !== "paused") {
      return;
    }

    this.startUpdateLoop();

    this.setStatus("running");
  }

  /**
   * Stop WWM completely.
   */
  public stop(): void {
    this.stopUpdateLoop();

    this.setStatus("stopped");
  }

  /**
   * Reset the engine back to its initial state.
   */
  public reset(): void {
    this.stopUpdateLoop();

    this.state = this.createInitialState();

    this.notifyListeners();
  }

  /**
   * Return the current engine state.
   */
  public getState(): WWMEngineState {
    return this.state;
  }

  /**
   * Subscribe to WWM state updates.
   *
   * Returns an unsubscribe function.
   */
  public subscribe(listener: WWMStateListener): () => void {
    this.listeners.add(listener);

    // Immediately provide the current state to the new subscriber.
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Send an engine event.
   */
  public dispatch(event: WWMEvent): void {
    switch (event.type) {
      case "START":
        this.start();
        break;

      case "PAUSE":
        this.pause();
        break;

      case "RESUME":
        this.resume();
        break;

      case "STOP":
        this.stop();
        break;

      case "RESET":
        this.reset();
        break;

      default:
        break;
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                         DEVELOPMENT / TEST API                           */
  /* ------------------------------------------------------------------------ */

  /**
   * Development-only helper.
   *
   * This allows us to simulate WWM states before real perception,
   * navigation and ML systems are connected.
   *
   * Later this method can be removed or restricted to development builds.
   */
  public simulateGuidance(
    guidance: GuidanceState,
    instruction?: string,
    reason?: string,
  ): void {
    this.setGuidance(guidance, instruction, reason);
  }

  /**
   * Development-only helper for testing risk thresholds.
   */
  public simulateRisk(probability: number): void {
    const clampedProbability = Math.max(0, Math.min(1, probability));

    const level = this.getRiskLevel(clampedProbability);

    this.state = {
      ...this.state,
      world: {
        ...this.state.world,
        risk: {
          probability: clampedProbability,
          level,
          confidence: 1,
          timestamp: Date.now(),
        },
      },
    };

    this.notifyListeners();
  }

  /* ------------------------------------------------------------------------ */
  /*                         INTERNAL ENGINE LOOP                              */
  /* ------------------------------------------------------------------------ */

  private startUpdateLoop(): void {
    if (this.updateTimer) {
      return;
    }

    this.updateTimer = setInterval(() => {
      this.processTick();
    }, ENGINE_CONFIG.UPDATE_INTERVAL_MS);
  }

  private stopUpdateLoop(): void {
    if (!this.updateTimer) {
      return;
    }

    clearInterval(this.updateTimer);

    this.updateTimer = undefined;
  }

  /**
   * Main WWM processing cycle.
   *
   * At this stage this is intentionally minimal.
   *
   * Future pipeline:
   *
   * sensors
   *    ↓
   * perception
   *    ↓
   * world model
   *    ↓
   * risk engine
   *    ↓
   * safety controller
   *    ↓
   * local planner
   *    ↓
   * guidance
   */
  private processTick(): void {
    if (this.state.status !== "running") {
      return;
    }

    const now = Date.now();

    this.state = {
      ...this.state,
      world: {
        ...this.state.world,
        timestamp: now,
      },
    };

    this.notifyListeners();
  }

  /* ------------------------------------------------------------------------ */
  /*                            STATE MANAGEMENT                               */
  /* ------------------------------------------------------------------------ */

  private setStatus(status: WWMEngineStatus): void {
    this.state = {
      ...this.state,
      status,
    };

    this.notifyListeners();
  }

  private setGuidance(
    guidance: GuidanceState,
    instruction?: string,
    reason?: string,
  ): void {
    const now = Date.now();

    /*
     * Prevent excessive guidance events.
     *
     * Critical states such as STOP should eventually bypass this
     * mechanism through the SafetyController.
     */
    if (
      guidance !== "stop" &&
      now - this.lastGuidanceTimestamp < ENGINE_CONFIG.MIN_GUIDANCE_INTERVAL_MS
    ) {
      return;
    }

    this.lastGuidanceTimestamp = now;

    this.state = {
      ...this.state,
      world: {
        ...this.state.world,
        guidance: {
          state: guidance,
          instruction,
          reason,
          timestamp: now,
        },
      },
    };

    this.notifyListeners();
  }

  private getRiskLevel(probability: number): WWMWorldState["risk"]["level"] {
    if (probability >= RISK_THRESHOLDS.CRITICAL) {
      return "critical";
    }

    if (probability >= RISK_THRESHOLDS.HIGH) {
      return "high";
    }

    if (probability >= RISK_THRESHOLDS.MODERATE) {
      return "moderate";
    }

    if (probability >= RISK_THRESHOLDS.LOW) {
      return "low";
    }

    return "low";
  }

  /* ------------------------------------------------------------------------ */
  /*                            INITIAL STATE                                 */
  /* ------------------------------------------------------------------------ */

  private createInitialState(): WWMEngineState {
    const now = Date.now();

    const world: WWMWorldState = {
      timestamp: now,

      user: {
        isWalking: false,
        timestamp: now,
      },

      route: {
        active: false,
        maneuver: "unknown",
        timestamp: now,
      },

      objects: [],

      risk: {
        probability: 0,
        level: "low",
        confidence: 1,
        timestamp: now,
      },

      safety: {
        action: "continue",
        confidence: 1,
        timestamp: now,
      },

      guidance: {
        state: "idle",
        timestamp: now,
      },
    };

    return {
      status: "idle",
      world,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*                              OBSERVERS                                    */
  /* ------------------------------------------------------------------------ */

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
