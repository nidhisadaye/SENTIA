import { NativeEventEmitter, NativeModules } from "react-native";

const { SentiaCall } = NativeModules;
const callEmitter = SentiaCall ? new NativeEventEmitter(SentiaCall) : null;

export type CallOutcome = "answered" | "not_answered" | "unknown";

// NOTE: Android can't reliably confirm "the other person picked up" for an
// outgoing call. This uses a duration heuristic: calls lasting longer than
// 8 seconds are treated as answered. Not perfect — see the SOS plan notes.
export function placeCallAndWaitForOutcome(phoneNumber: string, timeoutMs = 25000): Promise<CallOutcome> {
  return new Promise((resolve) => {
    if (!SentiaCall || !callEmitter) {
      console.warn("SentiaCall native module not found — did you rebuild natively after adding it?");
      resolve("unknown");
      return;
    }

    let settled = false;
    const finish = (outcome: CallOutcome) => {
      if (settled) return;
      settled = true;
      sub.remove();
      clearTimeout(timeoutHandle);
      resolve(outcome);
    };

    const sub = callEmitter.addListener("onSentiaCallStateChanged", (event: any) => {
      if (event.state === "ended") {
              // NOTE: CALL_STATE_OFFHOOK begins the moment dialing starts — it
              // includes ringing time, not just time actually spent talking. So
              // this duration is "how long from dial-attempt to hang-up," not a
              // true "did they answer" signal — Android gives us no better one.
              // 30s per your preference: fewer false "answered" verdicts on a
              // quick reject, at the cost of waiting longer before trying the
              // next guardian if this one is genuinely unreachable.
              const outcome: CallOutcome = event.durationMs > 30000 ? "answered" : "not_answered";
        console.log(`CALL: ended after ${event.durationMs}ms -> treating as ${outcome}`);
        finish(outcome);
      }
    });

    const timeoutHandle = setTimeout(() => {
      console.log("CALL: timed out waiting for outcome");
      finish("unknown");
    }, timeoutMs);

    SentiaCall.placeCall(phoneNumber).catch((err: any) => {
      console.warn("Call failed to place:", err);
      finish("unknown");
    });
  });
}