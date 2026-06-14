import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import type { SupportedLanguage } from "./intentRouter";

type SpeechState = "idle" | "listening" | "thinking" | "speaking";

export type SpeechServiceEvents = {
  onStateChange?: (state: SpeechState) => void;
  onSpeechStart?: () => void;
  onSpeechDone?: () => void;
};

type QueueItem = {
  text: string;
  language?: SupportedLanguage;
  interrupt?: boolean;
};

const voiceCode: Record<SupportedLanguage, string> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
};

export class SpeechService {
  private queue: QueueItem[] = [];
  private speaking = false;
  private events: SpeechServiceEvents = {};

  configure(events: SpeechServiceEvents) {
    this.events = events;
  }

  async playListeningCue() {
    await this.beep(880, 90);
    await Haptics.selectionAsync();
    this.events.onStateChange?.("listening");
  }

  async playThinkingCue() {
    await this.beep(520, 80);
    await this.beep(660, 80);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    this.events.onStateChange?.("thinking");
  }

  async playRespondingCue() {
    await this.beep(740, 100);
    this.events.onStateChange?.("speaking");
  }

  async speak(text: string, language: SupportedLanguage = "en", interrupt = false) {
    const cleaned = this.voiceFriendly(text);
    if (!cleaned) return;

    if (interrupt) {
      await this.stop();
      this.queue = [];
    }

    this.queue.push({ text: cleaned, language, interrupt });
    void this.drainQueue();
  }

  async stop() {
    this.queue = [];
    this.speaking = false;
    try {
      await Speech.stop();
    } catch {
      // expo-speech stop can reject when nothing is speaking.
    }
    this.events.onStateChange?.("idle");
  }

  async isSpeaking() {
    try {
      return await Speech.isSpeakingAsync();
    } catch {
      return this.speaking;
    }
  }

  private async drainQueue() {
    if (this.speaking) return;
    const item = this.queue.shift();
    if (!item) return;

    this.speaking = true;
    this.events.onSpeechStart?.();
    await this.playRespondingCue();

    Speech.speak(item.text, {
      language: voiceCode[item.language ?? "en"],
      pitch: 1,
      rate: 0.92,
      onDone: () => this.finishItem(),
      onStopped: () => this.finishItem(),
      onError: () => this.finishItem(),
    });
  }

  private finishItem() {
    this.speaking = false;
    this.events.onSpeechDone?.();
    this.events.onStateChange?.("idle");
    void this.drainQueue();
  }

  private voiceFriendly(text: string) {
    return text
      .replace(/\*\*/g, "")
      .replace(/[`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 900);
  }

  private async beep(frequency: number, durationMs: number) {
    try {
      const sampleRate = 44100;
      const samples = Math.floor((sampleRate * durationMs) / 1000);
      const wav = this.makeWavTone(frequency, samples, sampleRate);
      const uri = `data:audio/wav;base64,${wav}`;
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 0.35 });
      setTimeout(() => void sound.unloadAsync(), durationMs + 300);
    } catch {
      await Haptics.selectionAsync();
    }
  }

  private makeWavTone(frequency: number, samples: number, sampleRate: number) {
    const dataSize = samples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const write = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };

    write(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    write(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < samples; i += 1) {
      const envelope = 1 - i / samples;
      const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.25 * envelope;
      view.setInt16(44 + i * 2, value * 32767, true);
    }

    const bytes = new Uint8Array(buffer);
    return this.bytesToBase64(bytes);
  }

  private bytesToBase64(bytes: Uint8Array) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    let i = 0;

    for (; i + 2 < bytes.length; i += 3) {
      result += chars[bytes[i] >> 2];
      result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
      result += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
      result += chars[bytes[i + 2] & 63];
    }

    if (i < bytes.length) {
      result += chars[bytes[i] >> 2];
      if (i + 1 < bytes.length) {
        result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        result += chars[(bytes[i + 1] & 15) << 2];
        result += "=";
      } else {
        result += chars[(bytes[i] & 3) << 4];
        result += "==";
      }
    }

    return result;
  }
}

export const speechService = new SpeechService();
