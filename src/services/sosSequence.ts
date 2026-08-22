import * as Location from "expo-location";
import { loadGuardians, type GuardianContact } from "./sosService";
import { sendSilentSms } from "./smsService";
import { placeCallAndWaitForOutcome } from "./callService";

// Voice-captured numbers are stored as bare 10-digit numbers (e.g. "7385345914"),
// with no country code. SmsManager and ACTION_CALL are strict about needing a
// fully-qualified number — a bare local number can silently fail to send/dial.
// Google Messages/Dialer infer the country for you when you type manually;
// we have to do it ourselves here. Defaulting to +91 (India) based on this app's context.
function normalizePhoneNumber(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) {
    const withCode = `+91${cleaned}`;
    console.log(`SOS SEQUENCE: normalized phone "${raw}" -> "${withCode}"`);
    return withCode;
  }
  console.warn(`SOS SEQUENCE: phone number "${raw}" doesn't look like a bare 10-digit number — sending as-is`);
  return cleaned;
}

export type SosSequenceResult = {
  smsSent: number;
  guardianReached: GuardianContact | null;
};

type LocationResult = { latitude: number; longitude: number } | null;

async function getLocationCoords(): Promise<LocationResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      console.warn("SOS SEQUENCE: location permission denied");
      return null;
    }

    // BestForNavigation for the most precise fix possible — precision matters
        // far more than speed for a life-safety alert. Given ~12s to get a lock.
        const locationPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000));

        let pos = await Promise.race([locationPromise, timeoutPromise]);

        if (!pos) {
          console.warn("SOS SEQUENCE: high-accuracy fix timed out after 12s — trying a faster, lower-accuracy fix as fallback");
          const fallbackPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const fallbackTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
          pos = await Promise.race([fallbackPromise, fallbackTimeout]);
        }

        if (!pos) {
          console.warn("SOS SEQUENCE: could not get any location fix");
          return null;
        }

        console.log(`SOS SEQUENCE: location fix accuracy: ${pos.coords.accuracy}m`);
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (err) {
    console.warn("SOS SEQUENCE: location fetch threw:", err);
    return null;
  }
}

export async function runRealSosSequence(
  permissionsGranted: boolean,
  problemDescription?: string,
  callbacks?: {
    onSmsResult?: (guardianName: string, success: boolean) => void;
    onCallResult?: (guardianName: string, outcome: string) => void;
  }
): Promise<SosSequenceResult> {
  console.log("SOS SEQUENCE: starting, permissionsGranted =", permissionsGranted);

  if (!permissionsGranted) {
    console.warn("SOS SEQUENCE: SMS/Call permission not granted — cannot send real alerts");
    return { smsSent: 0, guardianReached: null };
  }

  console.log("SOS SEQUENCE: loading guardians...");
  const guardians = await loadGuardians();
  console.log("SOS SEQUENCE: guardians loaded, count =", guardians.length);
  if (guardians.length === 0) {
    console.warn("SOS SEQUENCE: no guardians saved — nothing to alert");
    return { smsSent: 0, guardianReached: null };
  }

  console.log("SOS SEQUENCE: fetching location...");
  console.log("SOS SEQUENCE: fetching location...");
    const coords = await getLocationCoords();
    console.log("SOS SEQUENCE: coords resolved ->", coords);

    // PRIMARY message — this is the one that MUST get through. Proven reliable:
    // plain text, no link, no URL scheme. This is what carries the actual
    // life-safety information and is the one we retry aggressively.
    const primaryMessageBody =
      "SENTIA EMERGENCY ALERT: I may need help." +
      (problemDescription ? ` I said: "${problemDescription}".` : "") +
      (coords
        ? ` My location: Lat ${coords.latitude.toFixed(6)}, Long ${coords.longitude.toFixed(6)}`
        : " Location unavailable.");

    // SECONDARY message — best-effort bonus only. Bare domain, no "https://"
    // prefix, since carrier URL-scanners typically pattern-match on the scheme.
    // Most phones (incl. Google Messages) still auto-link bare domains for the
    // recipient. Sent once, not retried, and its failure never blocks or
    // weakens the primary alert above.
    const secondaryMapsMessageBody = coords
      ? `Sentia: tap to open my location — maps.google.com/?q=${coords.latitude},${coords.longitude}`
      : null;

 console.log(`SOS SEQUENCE: sending PRIMARY SMS to all ${guardians.length} guardian(s) (spaced out)...`);
   const STAGGER_MS = 4000;

   async function sendPrimaryWithRetry(guardian: GuardianContact): Promise<boolean> {
     const phone = normalizePhoneNumber(guardian.phone);
     const MAX_ATTEMPTS = 3;
     let ok = false;
     for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
       ok = await sendSilentSms(phone, primaryMessageBody);
       console.log(`SOS SEQUENCE: PRIMARY SMS to ${guardian.name} (${phone}), attempt ${attempt}/${MAX_ATTEMPTS} -> ${ok ? "sent" : "FAILED"}`);
       if (ok) break;
       if (attempt < MAX_ATTEMPTS) {
         await new Promise((resolve) => setTimeout(resolve, 4000));
       }
     }
     try {
       callbacks?.onSmsResult?.(guardian.name, ok);
     } catch (err) {
       console.warn("SOS SEQUENCE: onSmsResult callback threw (ignored):", err);
     }

     // Best-effort bonus link — fire-and-forget, never retried, never affects
     // the guardian's success/fail feedback tone or the overall smsSent count.
     if (ok && secondaryMapsMessageBody) {
       setTimeout(async () => {
         const linkOk = await sendSilentSms(phone, secondaryMapsMessageBody);
         console.log(`SOS SEQUENCE: bonus map-link SMS to ${guardian.name} -> ${linkOk ? "sent" : "FAILED (not critical)"}`);
       }, 1500);
     }

     return ok;
   }

   const smsPromises = guardians.map((guardian, index) => {
     return new Promise<boolean>((resolve) => {
       setTimeout(() => {
         sendPrimaryWithRetry(guardian).then(resolve);
       }, index * STAGGER_MS);
     });
   });
   const smsResults = await Promise.all(smsPromises);
   const smsSent = smsResults.filter(Boolean).length;
   console.log(`SOS SEQUENCE: PRIMARY SMS batch done, ${smsSent}/${guardians.length} sent`);

  let reached: GuardianContact | null = null;
    console.log(`SOS SEQUENCE: starting call loop, ${guardians.length} guardian(s) to try`);
    for (const [idx, guardian] of guardians.entries()) {
      const phone = normalizePhoneNumber(guardian.phone);
      console.log(`SOS SEQUENCE: [call ${idx + 1}/${guardians.length}] calling ${guardian.name} (${phone})...`);
      const outcome = await placeCallAndWaitForOutcome(phone, 40000);
      console.log(`SOS SEQUENCE: [call ${idx + 1}/${guardians.length}] call to ${guardian.name} -> ${outcome} — moving to next if not answered`);
    try {
      callbacks?.onCallResult?.(guardian.name, outcome);
    } catch (err) {
      console.warn("SOS SEQUENCE: onCallResult callback threw (ignored):", err);
    }
    if (outcome === "answered") {
      reached = guardian;
      break;
    }
  }

  console.log("SOS SEQUENCE: finished", { smsSent, guardianReached: reached?.name ?? null });
  return { smsSent, guardianReached: reached };
}