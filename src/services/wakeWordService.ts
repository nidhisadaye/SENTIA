export type WakeWordState = "standby" | "command";

export type WakeWordEvents = {
  onWake?: () => void;
  onCommand?: (command: string) => void;
  onStateChange?: (state: WakeWordState) => void;
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export class WakeWordService {
  private state: WakeWordState = "standby";
  private events: WakeWordEvents = {};
  private commandTimeout: ReturnType<typeof setTimeout> | null = null;

  configure(events: WakeWordEvents) {
    this.events = events;
  }

  resetToStandby() {
    this.clearTimer();
    this.state = "standby";
    this.events.onStateChange?.("standby");
  }

  consumeTranscript(transcript: string, isFinal: boolean) {
    const text = normalize(transcript);
    if (!text) return;

    if (this.state === "standby") {
      const index = this.findWakePhraseIndex(text);
      if (index === -1) return;

      this.state = "command";
      this.events.onWake?.();
      this.events.onStateChange?.("command");
      this.startCommandTimer();

      const afterWake = text.slice(index).replace(/^(hey sentia|hi sentia|sentia)\s*/, "").trim();
      if (afterWake && isFinal) this.emitCommand(afterWake);
      return;
    }

    if (this.state === "command" && isFinal && text) {
      this.emitCommand(text);
    }
  }

  private findWakePhraseIndex(text: string) {
    const phrases = ["hey sentia", "hi sentia", "sentia"];
    const indexes = phrases.map((phrase) => text.indexOf(phrase)).filter((index) => index >= 0);
    return indexes.length ? Math.min(...indexes) : -1;
  }

  private emitCommand(command: string) {
    this.clearTimer();
    this.events.onCommand?.(command);
  }

  private startCommandTimer() {
    this.clearTimer();
    this.commandTimeout = setTimeout(() => this.resetToStandby(), 9000);
  }

  private clearTimer() {
    if (this.commandTimeout) clearTimeout(this.commandTimeout);
    this.commandTimeout = null;
  }
}

export const wakeWordService = new WakeWordService();
