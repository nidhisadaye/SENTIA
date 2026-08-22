import { NativeModules } from "react-native";

const { SentiaSms } = NativeModules;

export async function sendSilentSms(phoneNumber: string, message: string): Promise<boolean> {
  if (!SentiaSms) {
    console.warn("SentiaSms native module not found — did you rebuild natively after adding it?");
    return false;
  }
  try {
    await SentiaSms.sendSms(phoneNumber, message);
    return true;
  } catch (err) {
    console.warn("SMS send failed:", err);
    return false;
  }
}