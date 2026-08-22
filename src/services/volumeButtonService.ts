import { DeviceEventEmitter, Platform } from "react-native";

export function onVolumeDownLongPress(callback: () => void): () => void {
  if (Platform.OS !== "android") return () => {};
  const sub = DeviceEventEmitter.addListener("onVolumeDownLongPress", callback);
  return () => sub.remove();
}