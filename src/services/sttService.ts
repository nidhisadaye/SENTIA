import { Audio } from "expo-av";
import { Vibration } from "react-native";
import { USE_DIRECT, PROXY_BASE_URL } from "../constants";
import type { LangKey } from "../types";

export async function prepareRecordingSession(): Promise<void> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
}

export async function recordAndTranscribe(
  lang: LangKey,
  groqKey: string,
  durationMs: number,
  opts?: { digitsOnly?: boolean },
): Promise<string> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  Vibration.vibrate(80);
  console.log("STT: recording started, speak now");
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

  const uri = recording.getURI();
    console.log("STT: recording URI:", uri);
    if (!uri) {
      console.log("STT: no URI — recording never actually saved a file");
      return "";
    }

    console.log("STT: groqKey present?", groqKey ? `yes (${groqKey.length} chars)` : "NO — KEY IS EMPTY");

    const formData = new FormData();
    formData.append("file", { uri, type: "audio/m4a", name: "rec.m4a" } as any);
    formData.append("model", "whisper-large-v3");
    if (lang !== "mr") formData.append("language", lang === "hi" ? "hi" : "en");

    let response: Response;
    try {
      if (USE_DIRECT) {
        response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}` },
          body: formData,
        });
      } else {
        response = await fetch(`${PROXY_BASE_URL}/groq/transcribe`, { method: "POST", body: formData });
      }
    } catch (err) {
      console.log("STT: fetch itself threw an error:", err);
      return "";
    }

    console.log("STT: response status:", response.status);
    const data = await response.json();
    console.log("STT: raw response data:", JSON.stringify(data));
    const text = (data?.text ?? "").trim();
  console.log("STT heard:", JSON.stringify(text));
  if (opts?.digitsOnly) return text.replace(/\D/g, "");
  return text;
}

export function collapseSpelledLetters(text: string): string {
  return text.toUpperCase().replace(/[^A-Z\s,]/g, "").split(/[\s,]+/).filter(Boolean).join("");
}

export function parseYesNo(text: string): "yes" | "no" | "unclear" {
  const t = text.toLowerCase().trim();
  const yes = ["yes", "yeah", "correct", "right", "haan", "han", "ho", "बरोबर", "हो", "हां", "सही"];
  const no = ["no", "nope", "incorrect", "wrong", "nahi", "नाही", "नहीं", "गलत"];
  if (yes.some((w) => t.includes(w))) return "yes";
  if (no.some((w) => t.includes(w))) return "no";
  return "unclear";
}