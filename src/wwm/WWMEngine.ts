import {
    GuidanceState,
    WWMEngineState,
    WWMEngineStatus,
    WWMEvent,
    WWMStateListener,
    WWMWorldState,
} from "./types";

/**
 * WWM v2 — Core Engine
 *
 * Responsibilities:
 * - Own the current WWM state
 * - Start / pause / resume / stop the engine
 * - Notify subscribers when state changes
 * - Accept state updates pushed in by external modules
 *   (perception, sensors, risk, navigation, safety, guidance)
 *
 * This class intentionally does NOT perform:
 * - Camera processing
 * - YOLO inference
 * - Depth estimation
 * - XGBoost inference
 * - GPS processing
 * - LLM calls
 * - Navigation planning
 * - Safety decisions
 * - UI rendering
 *
 * It has no update loop of its own. It is purely reactive: it holds
 * state, and other modules call updateWorld() / updateGuidance() when
 * they have something new to report. Those calls are only accepted
 * while the engine is "running" — at all other times they are
 * ignored so the last known state is preserved untouched.
 */

export class WWMEngine {
  private state: WWMEngineState;

  private listeners = new Set<WWMStateListener>();

  constructor() {
    this.state = this.createInitialState();
  }

  /* ------------------------------------------------------------------------ */
  /*                              PUBLIC API                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * Start the WWM engine.
   *
   * idle/stopped → initializing → running
   */
  public start(): void {
    if (this.state.status !== "idle" && this.state.status !== "stopped") {
      return;
    }

    this.setStatus("initializing");

    this.setStatus("running");
  }

  /**
   * Pause WWM processing without destroying the current state.
   *
   * running → paused
   *
   * While paused, updateWorld() / updateGuidance() calls are ignored.
   */
  public pause(): void {
    if (this.state.status !== "running") {
      return;
    }

    this.setStatus("paused");
  }

  /**
   * Resume WWM processing.
   *
   * paused → running
   */
  public resume(): void {
    if (this.state.status !== "paused") {
      return;
    }

    this.setStatus("running");
  }

  /**
   * Stop WWM completely.
   *
   * running/paused → stopped
   */
  public stop(): void {
    if (this.state.status !== "running" && this.state.status !== "paused") {
      return;
    }

    this.setStatus("stopped");
  }

  /**
   * Reset the engine back to its initial state.
   *
   * any state → idle, with a fresh initial world state
   */
  public reset(): void {
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

  /**
   * Merge a partial world-state update into the current state.
   *
   * This is the entry point future modules (perception, sensors,
   * risk, navigation, safety) use to report new data. The engine
   * does not compute any of these values itself — it only stores
   * and broadcasts what it's given.
   *
   * Only accepted while the engine is running.
   */
  public updateWorld(
    partial: Partial<Omit<WWMWorldState, "timestamp" | "guidance">>,
  ): void {
    if (this.state.status !== "running") {
      return;
    }

    this.state = {
      ...this.state,
      world: {
        ...this.state.world,
        ...partial,
        timestamp: Date.now(),
      },
    };

    this.notifyListeners();
  }

  /**
   * Report a new guidance state.
   *
   * This is the entry point a future GuidanceController uses to push
   * guidance updates. The engine applies it as-is — no debouncing,
   * no rate limiting; that policy belongs to whichever module decides
   * when guidance should change.
   *
   * Only accepted while the engine is running.
   */
  public updateGuidance(
    guidance: GuidanceState,
    instruction?: string,
    reason?: string,
  ): void {
    if (this.state.status !== "running") {
      return;
    }

    this.state = {
      ...this.state,
      world: {
        ...this.state.world,
        guidance: {
          state: guidance,
          instruction,
          reason,
          timestamp: Date.now(),
        },
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
