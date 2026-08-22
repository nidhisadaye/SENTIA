import { Audio } from "expo-av";
import { Vibration } from "react-native";

let cachedSuccessSound: Audio.Sound | null = null;
let cachedFailSound: Audio.Sound | null = null;

async function getSound(type: "success" | "fail"): Promise<Audio.Sound> {
  if (type === "success") {
    if (!cachedSuccessSound) {
      console.log("SOS SOUND: loading success sound...");
      const { sound } = await Audio.Sound.createAsync(require("../../assets/sounds/sos-success.mp3"));
      cachedSuccessSound = sound;
      console.log("SOS SOUND: success sound loaded");
    }
    return cachedSuccessSound;
  } else {
    if (!cachedFailSound) {
      console.log("SOS SOUND: loading fail sound...");
      const { sound } = await Audio.Sound.createAsync(require("../../assets/sounds/sos-fail.mp3"));
      cachedFailSound = sound;
      console.log("SOS SOUND: fail sound loaded");
    }
    return cachedFailSound;
  }
}

// Races the real playback against a hard timeout so a stuck audio call
// can NEVER hang the caller. Always resolves within ~2.5s no matter what.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`SOS SOUND: ${label} timed out after ${ms}ms — giving up, not blocking caller`);
      resolve(null);
    }, ms);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        console.warn(`SOS SOUND: ${label} failed:`, err);
        resolve(null);
      });
  });
}

export async function playSosSound(type: "success" | "fail", earpieceOnly: boolean): Promise<void> {
  console.log(`SOS SOUND: playSosSound called (${type}, earpieceOnly=${earpieceOnly})`);
  const result = await withTimeout(
    (async () => {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: earpieceOnly,
      });
      const sound = await getSound(type);
      await sound.replayAsync();
      await new Promise((resolve) => setTimeout(resolve, 900));
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });
      return true;
    })(),
    2500,
    `playSosSound(${type})`,
  );
  if (!result) {
    // Sound couldn't play — most commonly because the app was backgrounded
    // (silent triggers can fire while the screen is locked). Fall back to a
    // vibration pattern so the person still gets some confirmation.
    console.log(`SOS SOUND: falling back to vibration for (${type})`);
    Vibration.vibrate(type === "success" ? [0, 100] : [0, 100, 80, 100, 80, 100]);
  }
  console.log(`SOS SOUND: playSosSound finished (${type})`);
}