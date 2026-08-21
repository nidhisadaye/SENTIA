import { PermissionsAndroid, Platform } from "react-native";

function withHardTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`PERMISSIONS: ${label} timed out after ${ms}ms — giving up, using fallback`);
      resolve(fallback);
    }, ms);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        console.warn(`PERMISSIONS: ${label} threw:`, err);
        resolve(fallback);
      });
  });
}

export async function requestSosPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  console.log("PERMISSIONS: requesting SMS/CALL_PHONE/READ_PHONE_STATE...");

 const result = await withHardTimeout(
     PermissionsAndroid.requestMultiple([
       PermissionsAndroid.PERMISSIONS.SEND_SMS,
       PermissionsAndroid.PERMISSIONS.CALL_PHONE,
       PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
     ]),
     30000, // generous: some phones show SMS and Phone as 2 separate sequential dialogs
     null,
     "requestMultiple",
   );

    if (!result) return false;

    // Log the REAL per-permission status, not just a collapsed true/false —
    // "never_ask_again" means Android will silently refuse to show the dialog
    // again until the user manually enables it from phone Settings.
    console.log("PERMISSIONS: SEND_SMS ->", result[PermissionsAndroid.PERMISSIONS.SEND_SMS]);
    console.log("PERMISSIONS: CALL_PHONE ->", result[PermissionsAndroid.PERMISSIONS.CALL_PHONE]);
    console.log("PERMISSIONS: READ_PHONE_STATE ->", result[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE]);

    const smsBlocked = result[PermissionsAndroid.PERMISSIONS.SEND_SMS] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
    const callBlocked = result[PermissionsAndroid.PERMISSIONS.CALL_PHONE] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
    if (smsBlocked || callBlocked) {
      console.warn(
        "PERMISSIONS: Android has permanently blocked this dialog for SMS and/or Call. " +
        "The in-app prompt will never appear again — the user must open phone Settings " +
        "> Apps > Sentia > Permissions and enable SMS/Phone manually."
      );
    }

    const granted =
      result[PermissionsAndroid.PERMISSIONS.SEND_SMS] === PermissionsAndroid.RESULTS.GRANTED &&
      result[PermissionsAndroid.PERMISSIONS.CALL_PHONE] === PermissionsAndroid.RESULTS.GRANTED;

    console.log("PERMISSIONS: overall granted ->", granted);
    return granted;
}