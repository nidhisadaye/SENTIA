import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import { runRealSosSequence } from "./services/sosSequence";
import { requestSosPermissions } from "./services/permissions";
import Constants from "expo-constants";
import * as ImageManipulator from "expo-image-manipulator";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import { Accelerometer, Barometer, Gyroscope, Magnetometer, Pedometer } from "expo-sensors";
import * as Speech from "expo-speech";
import { playSosSound } from "./services/sosSound";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Dimensions,
  Image,
  PanResponder,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View
} from "react-native";
import {
  BARO_INDOOR_THRESHOLD_HPA,
  BARO_OUTDOOR_THRESHOLD_HPA,
  BARO_SAMPLE_WINDOW_MS,
  BARO_WARN_COOLDOWN_MS,
  DOUBLE_SHAKE_WINDOW_MS,
  FALL_FREEFALL_THRESHOLD_G,
  FALL_IMPACT_THRESHOLD_G,
  FALL_FREEFALL_MIN_MS,
  FALL_STILLNESS_CONFIRM_MS,
  FALL_STILLNESS_THRESHOLD_G,
  GYRO_TILT_COOLDOWN_MS,
  GYRO_TILT_THRESHOLD,
  LISTEN_DURATION_MS,
  LONG_PRESS_DELAY,
  MAX_CONV_HISTORY,
  MAX_FACES,
  MIN_VALID_RESPONSE_LENGTH,
  PROXY_BASE_URL,
  SCAN_INTERVAL_MS,
  SHAKE_COOLDOWN_MS,
  SHAKE_THRESHOLD,
  SILENCE_BUFFER_MS,
  USE_DIRECT,
} from "./constants";
import { D, DIALOGUE_PREFIXES, FS } from "./dialogue";
import { LANG_SELECT_AUDIO, LANGUAGES, WELCOME } from "./languages";
import {
  getConversationPrompt,
  getFaceDescPrompt,
  getScanPrompt,
  READ_PROMPTS
} from "./prompts";
import { intentRouter } from "./services/intentRouter";
import { navigationService } from "./services/navigationService";
import { runGuardianSetup, type SosFlowIO } from "./services/sosFlow";
import { loadGuardians, removeGuardian, type GuardianContact } from "./services/sosService";

import type { AppMode, ConvMessage, LangKey, OcrType, SavedFace, WwmUrgency } from "./types";
import {
  detectCurrencyByColor,
  detectOcrHint,
  isHallucination,
  isHazard,
  isVisualQuestion,
  isWalkWithMeRequest,
  isHelpTrigger,
} from "./utils";
import {
  processWwmFrame,
  WWM_CONTEXT_WINDOW,
  WWM_IMG_WIDTH,
  WWM_INTERVAL_CAUTION,
  WWM_INTERVAL_DANGER,
  WWM_INTERVAL_STOP,
  WWM_MAX_CONSECUTIVE_ERRORS,
  WWM_MAX_TOKENS,
  WWM_MIN_RESPONSE_LENGTH,
  WWM_SCAN_INTERVAL_MS,
  type WwmDetectedObject,
} from "./walkWithMeEngine";
import { normalizeYoloDetections, type YoloResponse } from "./yolov8";
import { onVolumeDownLongPress } from "./services/volumeButtonService";

const GOOGLE_MAPS_EXPO_KEY: string =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_EXPO_KEY ?? "";

const GOOGLE_MAPS_EAS_KEY: string =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_EAS_KEY ?? "";
const USE_EAS_GOOGLE_MAPS_KEY: boolean =
  Constants.expoConfig?.extra?.useEasGoogleMapsKey === true;

const GOOGLE_MAPS_KEY: string = USE_EAS_GOOGLE_MAPS_KEY
  ? GOOGLE_MAPS_EAS_KEY
  : GOOGLE_MAPS_EXPO_KEY;

const GROQ_KEY: string = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "";
const OPENROUTER_KEY: string = process.env.EXPO_PUBLIC_OPENROUTER_KEY ?? "";
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const RIGHT_EDGE_ZONE = 24;         // px from the right edge that "counts" as a swipe start
const EDGE_SWIPE_MIN_DISTANCE = 60; // px the finger must travel left to confirm it's a real swipe
const ROBOFLOW_API_KEY: string = Constants.expoConfig?.extra?.roboflowApiKey ?? "";
const ROBOFLOW_MODEL_ID: string = Constants.expoConfig?.extra?.roboflowModelId ?? "";

const playEarcon = async () => {
  Vibration.vibrate(30);
};

const SENTIA_LOGO = require("../assets/images/sentia-logo.png");

const checkInternetConnection = async (): Promise<boolean> => {
  try {
    const response = await fetch("https://dns.google/resolve?name=google.com", { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
};

export default function SentiaApp() {
  const [permission, requestPermission] = useCameraPermissions();
  const [audioPermission, setAudioPermission] = useState(false);
  const [language, setLanguage] = useState<LangKey | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [mode, setMode] = useState<AppMode>("idle");
  const [isHazardAlert, setIsHazardAlert] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [savedFaces, setSavedFaces] = useState<SavedFace[]>([]);
  const [guardians, setGuardians] = useState<GuardianContact[]>([]);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [isSavingFace, setIsSavingFace] = useState(false);
  const [faceToDelete, setFaceToDelete] = useState<SavedFace | null>(null);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isWalkWithMe, setIsWalkWithMe] = useState(false);
  const [wwmStatus, setWwmStatus] = useState<WwmUrgency>("CLEAR");
  const [wwmStepCount, setWwmStepCount] = useState(0);
  const [privacyConsented, setPrivacyConsented] = useState<boolean | null>(null);
  const [sosCountdown, setSosCountdown] = useState(5);

  const alwaysListeningRef = useRef(false);
  const autoListenStartedRef = useRef(false);
const wakeDetectedRef = useRef(false);
const voiceCommandBusyRef = useRef(false);
const speechRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const recognitionWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const voiceFlowActiveRef = useRef(false);
const sosPermissionsGrantedRef = useRef(false);

  const cameraRef = useRef<CameraView>(null);
  const isScanningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastTapTimeRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsDraggingRef = useRef(false);
  const tapCountRef = useRef(0);
  const voiceGenderRef = useRef<"female" | "male">("female");
  const [voiceState, setVoiceState] = useState("idle");
  const [isListening, setIsListening] = useState(false);
  const [alwaysListening, setAlwaysListening] = useState(false);
  const savedFacesRef = useRef<SavedFace[]>([]);
  const currentModeRef = useRef<AppMode>("idle");
  const isConversationModeRef = useRef(false);
  const conversationHistoryRef = useRef<ConvMessage[]>([]);
  const langRef = useRef<LangKey | null>(null);
  const lastDescriptionRef = useRef("");
  const compassHeadingRef = useRef<number | undefined>(undefined);
  const appStateRef = useRef<AppStateStatus>("active");
  const lastShakeTimeRef = useRef(0);
  const sosTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silentSosPendingRef = useRef(false);
  const silentSosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallStateRef = useRef<"idle" | "freefall" | "impact">("idle");
  const fallFreefallStartRef = useRef(0);
  const fallImpactTimeRef = useRef(0);
  const fallStillnessSamplesRef = useRef<number[]>([]);
  const emergencyContactRef = useRef<string | null>(null);
  const lastShakeForSosRef = useRef(0);
 const cameraReadyRef = useRef(false);
   const scanConsecutiveFailuresRef = useRef(0);
  const isOnlineRef = useRef(true);
  const netPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isWalkWithMeRef = useRef(false);
  const wwmProcessingRef = useRef(false);
  const wwmClearCountRef = useRef(0);
  const wwmStepCountRef = useRef(0);
  const wwmLastResponseRef = useRef("");
  const wwmContextBufferRef = useRef<string[]>([]);
  const wwmCurrentUrgencyRef = useRef<WwmUrgency>("CLEAR");
  const wwmClearStreakRef = useRef(0);
  const wwmTiltSkipsRef = useRef(0);
  const wwmUseAccelStepsRef = useRef(false);
  const lastAccelStepTimeRef = useRef(0);
  const wwmErrorCountRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  const micTapCountRef = useRef(0);
  const micTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runScanCycleRef = useRef<() => Promise<void>>(async () => {});

  const phoneTiltedRef = useRef(false);
  const lastTiltTimeRef = useRef(0);

  const baroBaselineRef = useRef<number | null>(null);
  const baroLastSampleTimeRef = useRef(0);
  const baroLastWarnTimeRef = useRef(0);
  const baroIsIndoorRef = useRef(false);

  const gyroSubRef = useRef<{ remove: () => void } | null>(null);
  const baroSubRef = useRef<{ remove: () => void } | null>(null);
  const pedometerSubRef = useRef<{ remove: () => void } | null>(null);

  const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: (evt) => {
          if (evt.nativeEvent.touches.length === 2) {
            const lang = langRef.current;
            if (!lang) return true;
            const last = lastDescriptionRef.current;
            if (!last) {
              Speech.speak(D("no_repeat", lang), { language: LANGUAGES[lang].tts, rate: 0.78, pitch: 1.1 });
            } else {
              Speech.speak(D("repeat_last", lang), { language: LANGUAGES[lang].tts, rate: 0.78, pitch: 1.1 });
              setTimeout(() => Speech.speak(last, { language: LANGUAGES[lang].tts, rate: 0.78, pitch: 1.1 }), 800);
            }
            return true;
          }
          if (evt.nativeEvent.touches.length === 1) {
            const touchX = evt.nativeEvent.pageX;
            if (touchX > SCREEN_WIDTH - RIGHT_EDGE_ZONE) {
              edgeSwipeStartXRef.current = touchX;
              edgeSwipeActiveRef.current = true;
            } else {
              edgeSwipeActiveRef.current = false;
            }
          }
          return false;
        },
        onMoveShouldSetPanResponderCapture: (evt) => {
          if (!edgeSwipeActiveRef.current) return false;
          if (evt.nativeEvent.touches.length !== 1) {
            edgeSwipeActiveRef.current = false;
            return false;
          }
          const touchX = evt.nativeEvent.touches[0].pageX;
          const delta = edgeSwipeStartXRef.current - touchX;
          return delta > EDGE_SWIPE_MIN_DISTANCE;
        },
        onPanResponderGrant: () => {
          if (edgeSwipeActiveRef.current) {
            edgeSwipeActiveRef.current = false;
            console.log("SOS: right-edge swipe detected");
            Vibration.vibrate([0, 100, 60, 100]);
            if (currentModeRef.current !== "sos") triggerSOS("edge");
          }
        },
        onPanResponderRelease: () => {
          edgeSwipeActiveRef.current = false;
        },
        onPanResponderTerminate: () => {
          edgeSwipeActiveRef.current = false;
        },
      }),
    ).current;


useEffect(() => {
  console.log("VOLUME listener registered");
  const unsubscribe = onVolumeDownLongPress(() => {
      console.log("VOLUME long-press received in JS! mode:", currentModeRef.current);
      if (currentModeRef.current !== "sos") triggerSOS("volume");
    });
  return unsubscribe;
}, []);

  useEffect(() => {
    voiceGenderRef.current = voiceGender;
  }, [voiceGender]);
  useEffect(() => {
  alwaysListeningRef.current = alwaysListening;
}, [alwaysListening]);
  useEffect(() => {
    savedFacesRef.current = savedFaces;
  }, [savedFaces]);
useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);
  useEffect(() => {
    guardiansRef.current = guardians;
  }, [guardians]);
  useEffect(() => {
    currentModeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    isConversationModeRef.current = isConversationMode;
  }, [isConversationMode]);
  useEffect(() => {
    langRef.current = language;
  }, [language]);
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);
  useEffect(() => {
    isWalkWithMeRef.current = isWalkWithMe;
  }, [isWalkWithMe]);
useSpeechRecognitionEvent("result", (event) => {
  const text = event.results[0]?.transcript?.trim() ?? "";
  if (!text) return;
  if (event.isFinal) {
    console.log("VOICE heard:", text, "| alwaysListening:", alwaysListeningRef.current, "| mode:", currentModeRef.current);
  }

  if (event.isFinal && currentModeRef.current === "sos" && /\bcancel\b|रद्द|थांबवा/i.test(text)) {
    cancelSOS();
    return;
  }

  if (event.isFinal && isHelpTrigger(text) && currentModeRef.current !== "sos") {
      triggerSOS("voice");
      return;
    }

  if (!alwaysListeningRef.current || voiceCommandBusyRef.current) return;
  if (!text) return;

  setStatus(`Heard: ${text}`);

  if (event.isFinal) {
    handleExpoVoiceCommand(text);
  }
});
useSpeechRecognitionEvent("start", () => {
  console.log("VOICE recognition STARTED");
  if (recognitionWatchdogRef.current) {
    clearTimeout(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = null;
  }
});

useSpeechRecognitionEvent("end", () => {
  console.log("VOICE recognition ENDED — restarting. alwaysListening:", alwaysListeningRef.current, "| voiceFlowActive:", voiceFlowActiveRef.current);
  if (recognitionWatchdogRef.current) {
    clearTimeout(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = null;
  }
  if (voiceFlowActiveRef.current) return; // guardian setup owns the mic right now — don't fight it
  restartExpoSpeechRecognitionSoon();
});

useSpeechRecognitionEvent("error", (event) => {
  if (event.error === "aborted") return;

  console.warn("VOICE recognition ERROR:", event.error, event.message, "| alwaysListening:", alwaysListeningRef.current);
  if (recognitionWatchdogRef.current) {
    clearTimeout(recognitionWatchdogRef.current);
    recognitionWatchdogRef.current = null;
  }
  if (voiceFlowActiveRef.current) return;
  restartExpoSpeechRecognitionSoon(1000);
});

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    AsyncStorage.multiGet([
      "sentia_lang",
      "sentia_voice",
      "sentia_faces",
      "sentia_emergency",
      "sentia_privacy_consent",
    ]).then((pairs) => {
      const map = Object.fromEntries(pairs);
      setPrivacyConsented(map.sentia_privacy_consent === "true");
      if (map.sentia_privacy_consent !== "true") return;
      if (map.sentia_lang) setLanguage(map.sentia_lang as LangKey);
      if (map.sentia_voice) {
        setVoiceGender(map.sentia_voice as "female" | "male");
        voiceGenderRef.current = map.sentia_voice as "female" | "male";
      }
      if (map.sentia_faces) {
        const faces = JSON.parse(map.sentia_faces) as SavedFace[];
        setSavedFaces(faces);
        savedFacesRef.current = faces;
      }
      if (map.sentia_emergency) emergencyContactRef.current = map.sentia_emergency;
    });
loadGuardians().then(setGuardians);

    Audio.requestPermissionsAsync().then(({ granted }) => setAudioPermission(granted));
        // SOS (SMS/Call/phone-state) permission request moved out of here — it used to
        // fire at the same time as this Audio request and the camera request, and
        // Android can only show one permission dialog at a time. Racing them caused
        // some requests to silently auto-deny with no dialog ever appearing. It's
        // now requested separately, only after camera permission is settled — see
        // the effect below.
    const pollNetwork = async () => {
      const online = await checkInternetConnection();
      if (online !== isOnlineRef.current) {
        setIsOnline(online);
        isOnlineRef.current = online;
        const lang = langRef.current;
        if (lang) {
          if (!online) speak(D("offline_warn", lang), lang);
          else speak(D("wifi_back", lang), lang);
        }
      }
    };

    pollNetwork();
    netPollRef.current = setInterval(pollNetwork, 5000);

    const appStateSub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState !== "active") {
        if (isScanningRef.current) {
          isScanningRef.current = false;
          setIsScanning(false);
        }
        if (isWalkWithMeRef.current) stopWalkWithMe();
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
          recordingRef.current = null;
        }
      }
    });

    const magSub = Magnetometer.addListener(({ x, y }) => {
      const angle = Math.atan2(y, x) * (180 / Math.PI);
      compassHeadingRef.current = (angle + 360) % 360;
    });
    Magnetometer.setUpdateInterval(500);

    Gyroscope.setUpdateInterval(80);
    gyroSubRef.current = Gyroscope.addListener(({ x, y, z }) => {
      const rotationMagnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (rotationMagnitude > GYRO_TILT_THRESHOLD) {
        phoneTiltedRef.current = true;
        lastTiltTimeRef.current = now;
      } else if (phoneTiltedRef.current && now - lastTiltTimeRef.current > GYRO_TILT_COOLDOWN_MS) {
        phoneTiltedRef.current = false;
      }
    });

    Barometer.setUpdateInterval(300);
    baroSubRef.current = Barometer.addListener(({ pressure }) => {
      if (!pressure || !isFinite(pressure)) return;
      const now = Date.now();
      if (baroBaselineRef.current === null) {
        baroBaselineRef.current = pressure;
        baroLastSampleTimeRef.current = now;
        return;
      }
      if (now - baroLastSampleTimeRef.current < BARO_SAMPLE_WINDOW_MS) return;
      baroLastSampleTimeRef.current = now;
      const delta = Math.abs(pressure - baroBaselineRef.current);
      baroBaselineRef.current = 0.85 * baroBaselineRef.current + 0.15 * pressure;
      if (!isWalkWithMeRef.current) return;
      const threshold = baroIsIndoorRef.current ? BARO_INDOOR_THRESHOLD_HPA : BARO_OUTDOOR_THRESHOLD_HPA;
      if (delta < threshold) return;
      if (now - baroLastWarnTimeRef.current < BARO_WARN_COOLDOWN_MS) return;
      baroLastWarnTimeRef.current = now;
      Vibration.vibrate([0, 100, 80, 100, 80, 100]);
      const lang = langRef.current;
      if (lang) speak(D("wwm_elevation", lang), lang, true);
    });

    Accelerometer.setUpdateInterval(100);
        let lastX = 0;
        let lastY = 0;
        let lastZ = 0;
        const accelSub = Accelerometer.addListener(({ x, y, z }) => {
          const dx = Math.abs(x - lastX);
          const dy = Math.abs(y - lastY);
          const dz = Math.abs(z - lastZ);
          lastX = x;
          lastY = y;
          lastZ = z;
          const now = Date.now();
          const magnitude = Math.sqrt(x * x + y * y + z * z);

          if (isWalkWithMeRef.current && wwmUseAccelStepsRef.current) {
            const motionPulse = dx + dy + dz;
            if (motionPulse > 0.42 && now - lastAccelStepTimeRef.current > 350) {
              lastAccelStepTimeRef.current = now;
              wwmStepCountRef.current += 1;
              setWwmStepCount(wwmStepCountRef.current);
            }
          }

          // --- Fall detection: free-fall dip -> impact spike -> stillness = real fall ---
                if (fallStateRef.current === "idle") {
                  if (magnitude < FALL_FREEFALL_THRESHOLD_G) {
                    console.log("FALL: possible free-fall dip detected, magnitude:", magnitude.toFixed(2));
                    fallStateRef.current = "freefall";
                    fallFreefallStartRef.current = now;
                  }
                } else if (fallStateRef.current === "freefall") {
                  const freefallDuration = now - fallFreefallStartRef.current;
                  if (magnitude > FALL_IMPACT_THRESHOLD_G && freefallDuration > FALL_FREEFALL_MIN_MS) {
                    console.log("FALL: impact detected after", freefallDuration, "ms of free-fall — checking stillness...");
                    fallStateRef.current = "impact";
                    fallImpactTimeRef.current = now;
                    fallStillnessSamplesRef.current = [];
                  } else if (freefallDuration > 1000) {
                    fallStateRef.current = "idle"; // dip too long with no impact — not a fall, reset
                  }
                } else if (fallStateRef.current === "impact") {
            fallStillnessSamplesRef.current.push(magnitude);
            if (now - fallImpactTimeRef.current > FALL_STILLNESS_CONFIRM_MS) {
              const samples = fallStillnessSamplesRef.current;
              const avgDeviation = samples.reduce((sum, m) => sum + Math.abs(m - 1), 0) / (samples.length || 1);
              console.log("FALL: stillness check, avgDeviation =", avgDeviation.toFixed(3));
              fallStateRef.current = "idle";
              fallStillnessSamplesRef.current = [];
              if (avgDeviation < FALL_STILLNESS_THRESHOLD_G) {
                triggerSOS("fall");
              }
            }
          }

          // --- Shake detection: double-shake triggers/cancels; single shake only cancels a LOUD (voice) SOS ---
          // --- Shake detection: double-shake triggers/cancels; single shake only cancels a LOUD (voice) SOS ---
                const isRealShake = dx > 1.2 && dy > 1.0 && dz > 0.8;
                const totalAcc = dx + dy + dz;

                if (isRealShake && totalAcc > SHAKE_THRESHOLD && now - lastShakeTimeRef.current > SHAKE_COOLDOWN_MS) {
                  lastShakeTimeRef.current = now;
                  const isDoubleShake = now - lastShakeForSosRef.current < DOUBLE_SHAKE_WINDOW_MS;
                  console.log("SHAKE: real shake detected, totalAcc:", totalAcc.toFixed(2), "| isDoubleShake:", isDoubleShake);

                  if (isDoubleShake) {
                    lastShakeForSosRef.current = 0;
                    if (silentSosPendingRef.current) {
                      console.log("SOS: double-shake cancelling silent countdown");
                      cancelSOS(); // double-shake cancels a silent fall/shake countdown
                    } else if (currentModeRef.current !== "sos") {
                      console.log("SOS: double-shake starting silent countdown");
                      triggerSOS("shake");
                    }
                    return;
                  }

                  lastShakeForSosRef.current = now;

            if (currentModeRef.current === "sos" && sosSourceRef.current === "voice") {
              cancelSOS(); // single shake cancels only the loud, visible voice-triggered SOS
              return;
            }
            if (silentSosPendingRef.current) {
              return; // single shake must NOT cancel a silent countdown — only double-shake can
            }
            if (currentModeRef.current === "walkwithme") {
              stopWalkWithMe();
              return;
            }
            if (currentModeRef.current === "facemanage" || currentModeRef.current === "facedeleteconfirm") {
              setMode("settings");
              setFaceToDelete(null);
              return;
            }
            setShowSettings((prev) => {
              const lang = langRef.current;
              if (!prev) {
                isScanningRef.current = false;
                setIsScanning(false);
                Speech.stop();
                isSpeakingRef.current = false;
              } else if (lang) {
                speak(FS("settingsClosed", lang), lang);
              }
              return !prev;
            });
          }
        });


    return () => {
      if (netPollRef.current) clearInterval(netPollRef.current);
      appStateSub.remove();
      magSub.remove();
      accelSub.remove();
      gyroSubRef.current?.remove();
      gyroSubRef.current = null;
      baroSubRef.current?.remove();
      baroSubRef.current = null;
      pedometerSubRef.current?.remove();
      pedometerSubRef.current = null;
      if (sosTimerRef.current) clearTimeout(sosTimerRef.current);
            if (silentSosTimerRef.current) clearTimeout(silentSosTimerRef.current);
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (language) {
      langRef.current = language;
      setTimeout(() => speakRaw(WELCOME[language], language), 600);
    }
  }, [language]);
useEffect(() => {
    if (language && audioPermission && !autoListenStartedRef.current) {
      autoListenStartedRef.current = true;
      const timer = setTimeout(() => {
        alwaysListeningRef.current = true;
        setAlwaysListening(true);
        startExpoSpeechRecognition();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [language, audioPermission]);
  useEffect(() => {
    if (showSettings && language) {
      Speech.stop();
      setTimeout(() => speakRaw(FS("settingsOpen", language), language), 400);
    }
  }, [showSettings, language]);

  useEffect(() => {
    navigationService.configure({
      googleMapsApiKey: GOOGLE_MAPS_KEY,
    });
  }, []);

  useEffect(() => {
    // Only request SOS (SMS/Call/phone-state) permission once camera permission
    // is already settled — and wait a beat for the camera dialog's own closing
    // animation to fully finish before opening the next one, so they don't overlap.
    if (permission?.granted) {
      const timer = setTimeout(() => {
        requestSosPermissions().then((granted) => {
          console.log("SOS permissions (SMS/Call) granted?", granted);
          sosPermissionsGrantedRef.current = granted;
        });
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [permission?.granted]);

  useEffect(() => {
    isScanningRef.current = isScanning;
    if (isScanning) {
      setMode("scanning");
      currentModeRef.current = "scanning";
      const delay = cameraReadyRef.current ? 400 : 1200;
      setTimeout(() => {
        if (isScanningRef.current) runScanCycleRef.current();
      }, delay);
    } else {
      Speech.stop();
      isSpeakingRef.current = false;
      isProcessingRef.current = false;
      setStatus("Ready");
      setIsLoading(false);
      setIsHazardAlert(false);
      setMode((prev) => (prev === "scanning" ? "idle" : prev));
    }
  }, [isScanning]);

const sosSourceRef = useRef<"shake" | "voice" | "volume" | "edge" | "fall">("voice");
const edgeSwipeActiveRef = useRef(false);
const edgeSwipeStartXRef = useRef(0);
const sosSequenceRunningRef = useRef(false);

 // Fires the actual SOS silently — no red screen, no spoken announcement.
   // Step 2 will replace the console.log below with the real SMS + guardian-calling sequence.
   const fireSilentSOS = (source: "shake" | "volume" | "edge" | "fall") => {
       if (sosSequenceRunningRef.current) {
         console.log(`SOS: ignoring ${source} trigger — a sequence is already in progress`);
         return;
       }
       console.log(`SOS: silently firing (source: ${source})`);
       currentModeRef.current = "sos";
       setMode("sos");
       sosSequenceRunningRef.current = true;
       Vibration.vibrate([0, 80, 100, 80]);
          runRealSosSequence(sosPermissionsGrantedRef.current, undefined, {
                   onSmsResult: (name, success) => {
                     playSosSound(success ? "success" : "fail", true);
                   },
                   onCallResult: (name, outcome) => {
                     playSosSound(outcome === "answered" ? "success" : "fail", true);
                   },
                 }).then((result) => {
                   console.log("SOS: real sequence finished", result);
                 }).finally(() => {
                   sosSequenceRunningRef.current = false;
                 });
                 setTimeout(() => {
            setMode("idle");
            currentModeRef.current = "idle";
          }, 1500);
        };

   const triggerSOS = (source: "shake" | "voice" | "volume" | "edge" | "fall" = "voice") => {
     const lang = langRef.current ?? "en";
     if (sosTimerRef.current || silentSosPendingRef.current || currentModeRef.current === "sos") return;
     if (isWalkWithMeRef.current) stopWalkWithMe(true);
     sosSourceRef.current = source;

    if (source === "voice") {
          if (sosSequenceRunningRef.current) {
            console.log("SOS: ignoring voice trigger — a sequence is already in progress");
            return;
          }
          // Already spoken out loud by the user — no secrecy to protect. Stays loud/visible.
          setShowSettings(false);
          setMode("sos");
          currentModeRef.current = "sos";
          sosSequenceRunningRef.current = true;
          Vibration.vibrate([0, 300, 200, 300, 200, 300]);
          setSosCountdown(0);
          speak(D("sos_warning_direct", lang), lang, true);
          speak(D("sos_placeholder_trigger", lang), lang);
                         runRealSosSequence(sosPermissionsGrantedRef.current, undefined, {
                            onSmsResult: (name, success) => {
                              playSosSound(success ? "success" : "fail", false);
                            },
                            onCallResult: (name, outcome) => {
                              playSosSound(outcome === "answered" ? "success" : "fail", false);
                            },
                          }).then((result) => {
                            console.log("SOS: real sequence finished", result);
                          }).finally(() => {
                            sosSequenceRunningRef.current = false;
                          });
                          return;
            }

     if (source === "volume" || source === "edge") {
       // Deliberate, hard to trigger by accident — fire immediately, silently, no cancel window.
       fireSilentSOS(source);
       return;
     }

     // source === "shake" or "fall": could plausibly be accidental —
         // silent 5-second window, cancellable only by a double-shake.
         console.log(`SOS: silent 5s countdown started (source: ${source})`);
         currentModeRef.current = "sos";
         setMode("sos"); // internal state only — the screen stays completely normal for these sources
         silentSosPendingRef.current = true;
         Vibration.vibrate(60); // tiny private pulse, felt only by whoever's holding the phone
         silentSosTimerRef.current = setTimeout(() => {
           silentSosTimerRef.current = null;
           if (silentSosPendingRef.current) {
             silentSosPendingRef.current = false;
             console.log(`SOS: 5s countdown elapsed with no cancel (source: ${source}) — firing now`);
             fireSilentSOS(source);
           }
         }, 5000);
   };

 const cancelSOS = () => {
     if (sosTimerRef.current) {
       clearInterval(sosTimerRef.current);
       sosTimerRef.current = null;
     }
     if (silentSosTimerRef.current) {
       clearTimeout(silentSosTimerRef.current);
       silentSosTimerRef.current = null;
     }
     silentSosPendingRef.current = false;
     fallStateRef.current = "idle";
     fallStillnessSamplesRef.current = [];

     const lang = langRef.current ?? "en";
     setSosCountdown(5);
     setMode("idle");
     currentModeRef.current = "idle";

     if (sosSourceRef.current === "voice") {
       speak(D("sos_cancelled", lang), lang);
     } else {
       Vibration.vibrate(40); // quiet private confirmation only — nothing spoken, nothing shown
     }
   };

 const speakAndWait = (text: string): Promise<void> => {
     const lang = langRef.current ?? "en";
     return new Promise((resolve) => {
       Speech.stop();
       setTimeout(() => {
         Speech.speak(text, {
           language: LANGUAGES[lang].tts,
           rate: 0.78,
           onDone: () => resolve(),
           onError: () => resolve(),
         });
       }, 150);
     });
   };

 const setSosContact = async () => {
       setMode("sos");
       currentModeRef.current = "sos";

       // Claim the mic exclusively for guardian setup.
       voiceFlowActiveRef.current = true;
       console.log("GUARDIAN FLOW: started, mic claimed");
       if (speechRestartTimerRef.current) {
         clearTimeout(speechRestartTimerRef.current);
         speechRestartTimerRef.current = null;
       }
       if (recognitionWatchdogRef.current) {
         clearTimeout(recognitionWatchdogRef.current);
         recognitionWatchdogRef.current = null;
       }
       try { ExpoSpeechRecognitionModule.abort(); } catch {}

       // try/finally: no matter what happens inside guardian setup — success,
       // a misheard word, a thrown error — the mic MUST be handed back at the end.
       try {
         const io: SosFlowIO = { lang: langRef.current ?? "en", groqKey: GROQ_KEY, speakAndWait };
         const updated = await runGuardianSetup(io);
         setGuardians(updated);
       } catch (err) {
         console.warn("GUARDIAN FLOW: error inside flow", err);
       } finally {
         setMode("idle");
         currentModeRef.current = "idle";
         try {
           await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
         } catch {}
         voiceFlowActiveRef.current = false;
         console.log("GUARDIAN FLOW: ended, mic released back to continuous listening");
         if (alwaysListeningRef.current && !voiceCommandBusyRef.current) {
           restartExpoSpeechRecognitionSoon(900);
         }
       }
     };

const showSettingsRef = useRef(false);
const guardiansRef = useRef<GuardianContact[]>([]);

const confirmGuardianDelete = (index: number) => {
  const lang = langRef.current ?? "en";
  const name = guardians[index]?.name ?? "";
  removeGuardian(index).then((updated) => {
    setGuardians(updated);
    speak(`${name} removed.`, lang);
  });
  setPendingDeleteIndex(null);
};

  const speakRaw = (text: string, lang: LangKey, urgent = false, gender?: "female" | "male") => {
    Speech.stop();
    isSpeakingRef.current = true;
    const g = gender ?? voiceGenderRef.current;
    setTimeout(() => {
      Speech.speak(text, {
        language: LANGUAGES[lang].tts,
        rate: urgent ? 1.1 : 0.78,
        pitch: urgent ? 1.3 : g === "male" ? 0.75 : 1.1,
        onDone: () => {
          isSpeakingRef.current = false;
        },
        onError: () => {
          isSpeakingRef.current = false;
        },
      });
    }, urgent ? 0 : 200);
  };

  const speak = (text: string, lang: LangKey, urgent = false) => speakRaw(text, lang, urgent);

const speakAndThen = (text: string, lang: LangKey, onFinished: () => void, urgent = false, force = false) => {
    Speech.stop();
    isSpeakingRef.current = true;
    const g = voiceGenderRef.current;
    const convActiveAtCall = isConversationModeRef.current;
    setTimeout(() => {
      Speech.speak(text, {
        language: LANGUAGES[lang].tts,
        rate: urgent ? 1.1 : 0.78,
        pitch: urgent ? 1.3 : g === "male" ? 0.75 : 1.1,
        onDone: () => {
          isSpeakingRef.current = false;
          if (force || (isConversationModeRef.current && convActiveAtCall)) onFinished();
        },
        onError: () => {
          isSpeakingRef.current = false;
          if (force) onFinished();
        },
      });
    }, 200);
  };


  const speakForWwm = (text: string, lang: LangKey, urgency: WwmUrgency): Promise<void> =>
    new Promise((resolve) => {
      Speech.stop();
      isSpeakingRef.current = true;
      const g = voiceGenderRef.current;
      const isUrgent = urgency === "DANGER" || urgency === "STOP";
      setTimeout(() => {
        if (!isWalkWithMeRef.current) {
          isSpeakingRef.current = false;
          resolve();
          return;
        }
        Speech.speak(text, {
          language: LANGUAGES[lang].tts,
          rate: isUrgent ? 1.05 : 0.82,
          pitch: isUrgent ? 1.25 : g === "male" ? 0.75 : 1.05,
          onDone: () => {
            isSpeakingRef.current = false;
            resolve();
          },
          onError: () => {
            isSpeakingRef.current = false;
            resolve();
          },
        });
      }, isUrgent ? 0 : 150);
    });

  const triggerHazardAlert = (text: string, lang: LangKey) => {
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    setIsHazardAlert(true);
    speak(text, lang, true);
    setTimeout(() => {
      speak(text, lang, true);
      setTimeout(() => setIsHazardAlert(false), 4000);
    }, 3000);
  };

  const speakForScan = (text: string, lang: LangKey): Promise<void> =>
    new Promise((resolve) => {
      Speech.stop();
      isSpeakingRef.current = true;
      const g = voiceGenderRef.current;
      setTimeout(() => {
        if (!isScanningRef.current) {
          isSpeakingRef.current = false;
          resolve();
          return;
        }
        Speech.speak(text, {
          language: LANGUAGES[lang].tts,
          rate: 0.78,
          pitch: g === "male" ? 0.75 : 1.1,
          onDone: () => {
            isSpeakingRef.current = false;
            resolve();
          },
          onError: () => {
            isSpeakingRef.current = false;
            resolve();
          },
        });
      }, 200);
    });

  const runScanCycle = async () => {
      if (!isScanningRef.current || appStateRef.current !== "active") return;
      if (isProcessingRef.current) {
        if (isScanningRef.current) setTimeout(() => runScanCycleRef.current(), SCAN_INTERVAL_MS);
        return;
      }
      try {
        await analyzeFrameForScan();
      } catch {
        isProcessingRef.current = false;
      }
      if (isScanningRef.current) {
        const failures = scanConsecutiveFailuresRef.current;
        const nextDelay = failures > 0 ? Math.min(SCAN_INTERVAL_MS * (failures + 1), 20000) : SCAN_INTERVAL_MS;
        setTimeout(() => runScanCycleRef.current(), nextDelay);
      }
    };
  runScanCycleRef.current = runScanCycle;

  const analyzeFrameForScan = async () => {
    const lang = langRef.current;
    if (!cameraRef.current || !lang || isProcessingRef.current || !cameraReadyRef.current) return;
    isProcessingRef.current = true;
    try {
      setIsLoading(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        base64: true,
        skipProcessing: false,
      });
      if (!photo?.base64) return;
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 640 } }],
        { base64: true, compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (!resized.base64) return;
      const prompt = getScanPrompt(lang, savedFacesRef.current, compassHeadingRef.current);
      const result = await callVisionAI(resized.base64, lang, prompt, 280);
            if (!isScanningRef.current) return;
            if (!result || result === D("fallback", lang)) {
              scanConsecutiveFailuresRef.current += 1;
              return;
            }
            scanConsecutiveFailuresRef.current = 0;
            lastDescriptionRef.current = result;
      setDescription(result);
      setIsLoading(false);
      if (isHazard(result)) {
        triggerHazardAlert(result, lang);
        await new Promise<void>((resolve) => setTimeout(resolve, 6500));
      } else {
        await speakForScan(result, lang);
      }
    } catch {
      setStatus("Scan error — retrying");
    } finally {
      setIsLoading(false);
      isProcessingRef.current = false;
    }
  };

  const startWalkWithMe = async () => {
    const lang = langRef.current;
    if (!lang || !cameraReadyRef.current) return;

    isScanningRef.current = false;
    setIsScanning(false);

    wwmClearCountRef.current = 0;
    wwmStepCountRef.current = 0;
    wwmLastResponseRef.current = "";
    wwmProcessingRef.current = false;
    wwmContextBufferRef.current = [];
    wwmCurrentUrgencyRef.current = "CLEAR";
    wwmClearStreakRef.current = 0;
    wwmTiltSkipsRef.current = 0;
    wwmErrorCountRef.current = 0;
    lastFrameTimeRef.current = 0;

    isWalkWithMeRef.current = true;
    setIsWalkWithMe(true);
    setWwmStatus("CLEAR");
    setWwmStepCount(0);
    setMode("walkwithme");
    currentModeRef.current = "walkwithme";

    phoneTiltedRef.current = false;
    lastTiltTimeRef.current = 0;
    baroBaselineRef.current = null;
    baroLastWarnTimeRef.current = 0;

    const isAvailable = await Pedometer.isAvailableAsync();
    if (isAvailable) {
      pedometerSubRef.current?.remove();
      pedometerSubRef.current = Pedometer.watchStepCount((result) => {
        if (result.steps >= wwmStepCountRef.current) {
          wwmStepCountRef.current = result.steps;
        } else {
          wwmStepCountRef.current += result.steps;
        }
        setWwmStepCount(wwmStepCountRef.current);
      });
    }

    Vibration.vibrate([0, 100, 80, 100, 80, 200]);
    speak(D("wwm_start", lang), lang);

    setTimeout(() => {
      if (isWalkWithMeRef.current) runWwmCycle();
    }, 2500);
  };

  const stopWalkWithMe = (silent = false) => {
    const lang = langRef.current;
    isWalkWithMeRef.current = false;
    setIsWalkWithMe(false);
    wwmProcessingRef.current = false;
    setMode("idle");
    currentModeRef.current = "idle";
    setWwmStatus("CLEAR");
    wwmContextBufferRef.current = [];
    wwmCurrentUrgencyRef.current = "CLEAR";
    wwmClearStreakRef.current = 0;
    wwmErrorCountRef.current = 0;

    pedometerSubRef.current?.remove();
    pedometerSubRef.current = null;

    if (!silent && lang) {
      Vibration.vibrate([0, 200, 100, 200]);
      speak(D("wwm_stop", lang), lang);
    }
  };

  const runWwmCycle = async () => {
    if (!isWalkWithMeRef.current || appStateRef.current !== "active") return;

    if (wwmProcessingRef.current) {
      setTimeout(runWwmCycle, 300);
      return;
    }

    try {
      await analyzeFrameForWwm();
    } catch (error) {
      console.log("WWM cycle error:", error);
    }

    if (isWalkWithMeRef.current) {
      const urgency = wwmCurrentUrgencyRef.current;
      const nextInterval =
        urgency === "DANGER"
          ? WWM_INTERVAL_DANGER
          : urgency === "STOP"
            ? WWM_INTERVAL_STOP
            : urgency === "CAUTION"
              ? WWM_INTERVAL_CAUTION
              : WWM_SCAN_INTERVAL_MS;

      setTimeout(runWwmCycle, nextInterval);
    }
  };

  const analyzeFrameForWwm = async () => {
    const lang = langRef.current;
    if (!cameraRef.current || !lang || !cameraReadyRef.current) return;
    const result = await processWwmFrame(
      {
        cameraRef,
        lang,
        cameraReady: cameraReadyRef.current,
        phoneTilted: phoneTiltedRef.current,
        isWalkWithMe: isWalkWithMeRef.current,
        compassHeading: compassHeadingRef.current,
        contextBuffer: wwmContextBufferRef.current,
        lastFrameTime: lastFrameTimeRef.current,
        setLastFrameTime: (time) => {
          lastFrameTimeRef.current = time;
        },
        setStatus,
        setDescription,
        setWwmStatus,
        onUrgencyChange: (urgency) => {
          wwmCurrentUrgencyRef.current = urgency;
        },
        onSpeak: (text, urgency) => speakForWwm(text, lang, urgency),
        onVibrate: (pattern) => Vibration.vibrate(pattern),
        onContextAppend: (entry) => {
          wwmContextBufferRef.current = [...wwmContextBufferRef.current, entry].slice(-WWM_CONTEXT_WINDOW);
        },
        onTiltSkip: () => {},
        onError: (error) => {
          wwmErrorCountRef.current += 1;
          console.log("WWM ERROR:", error);
          setStatus(`WWM error: ${error.message || "unknown"}`);

          if (wwmErrorCountRef.current >= WWM_MAX_CONSECUTIVE_ERRORS) {
            const currentLang = langRef.current;
            if (currentLang) speak(D("wwm_api_error", currentLang), currentLang);
            stopWalkWithMe(true);
            wwmErrorCountRef.current = 0;
          }
        },
        detectObjectsWithYolo: detectObjectsWithYolo,
        callVisionWithSignal: callWwmVisionAI,
        ImageManipulator,
      },
      wwmProcessingRef,
      wwmLastResponseRef,
      wwmClearStreakRef,
      wwmCurrentUrgencyRef,
      wwmTiltSkipsRef,
    );

    if (result) {
      wwmErrorCountRef.current = 0;
    }
  };

  const detectObjectsWithYolo = async (base64: string, signal: AbortSignal): Promise<WwmDetectedObject[]> => {
    if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) return [];

    const modelId = ROBOFLOW_MODEL_ID.trim();
    const endpoint = `https://detect.roboflow.com/${modelId}?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: base64,
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`YOLO HTTP ${response.status}: ${errText}`);
    }

    const data: YoloResponse = await response.json();
    const normalized = normalizeYoloDetections(
      data.predictions ?? [],
      data.image?.width ?? WWM_IMG_WIDTH,
      data.image?.height ?? WWM_IMG_WIDTH,
    );

    return normalized.objects;
  };

  const twoStepOcr = async (voiceHint: OcrType = "general", question?: string): Promise<string | null> => {
    const lang = langRef.current;
    if (!cameraRef.current || !lang || isProcessingRef.current) return null;
    isProcessingRef.current = true;
    try {
      setIsLoading(true);
      setStatus("Capturing...");
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        base64: true,
        skipProcessing: false,
      });
      if (!photo?.base64) return null;
      if (voiceHint !== "general") {
        const readImg = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 1100 } }],
          { base64: true, compress: 0.95, format: ImageManipulator.SaveFormat.JPEG },
        );
        if (!readImg.base64) return null;
        if (voiceHint === "currency") {
          const colorResult = await detectCurrencyByColor(readImg.base64);
          if (colorResult) {
            if (question) {
              addToConversationHistory("user", question);
              addToConversationHistory("assistant", colorResult);
            }
            return colorResult;
          }
        }
        setStatus("Reading...");
        const readPrompt = READ_PROMPTS[voiceHint][lang] ?? READ_PROMPTS[voiceHint].en;
        const result = await callVisionAI(readImg.base64, lang, readPrompt, 300);
        if (question) {
          addToConversationHistory("user", question);
          addToConversationHistory("assistant", result);
        }
        return result;
      }
      const [classifyImg, readImg] = await Promise.all([
        ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 400 } }],
          { base64: true, compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
        ),
        ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 1100 } }],
          { base64: true, compress: 0.95, format: ImageManipulator.SaveFormat.JPEG },
        ),
      ]);
      if (!classifyImg.base64 || !readImg.base64) return null;
      const docType = await classifyImage(classifyImg.base64);
      setStatus(`Type: ${docType}`);
      const readPrompt = READ_PROMPTS[docType][lang] ?? READ_PROMPTS[docType].en;
      setStatus("Reading...");
      const result = await callVisionAI(readImg.base64, lang, readPrompt, 300);
      if (question) {
        addToConversationHistory("user", question);
        addToConversationHistory("assistant", result);
      }
      return result;
    } catch (error: any) {
      setStatus(`OCR error: ${error?.message}`);
      return null;
    } finally {
      setIsLoading(false);
      isProcessingRef.current = false;
    }
  };

  const classifyImage = async (base64: string): Promise<OcrType> => {
    const imageData = `data:image/jpeg;base64,${base64}`;
    try {
      const response = await groqRequest({
              model: "qwen/qwen3.6-27b",
              max_tokens: 5,
              temperature: 0.0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: CLASSIFY_PROMPT },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
      });
      const label = response?.choices?.[0]?.message?.content?.trim().toLowerCase();
      const valid: OcrType[] = ["medicine", "menu", "prescription", "govdoc", "currency", "form", "general"];
      if (valid.includes(label as OcrType)) return label as OcrType;
    } catch {}
    return "general";
  };

  const groqRequest = async (body: object, signal?: AbortSignal): Promise<any> => {
    if (USE_DIRECT) {
      if (!GROQ_KEY) throw new Error("GROQ_KEY missing — check app.config.js extra.groqKey and restart with: npx expo start --clear");
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq HTTP ${response.status}: ${errText}`);
      }
      return response.json();
    }
    const response = await fetch(`${PROXY_BASE_URL}/groq/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    return response.json();
  };

  const openRouterRequest = async (body: object, signal?: AbortSignal): Promise<any> => {
    if (USE_DIRECT) {
      if (!OPENROUTER_KEY) throw new Error("OPENROUTER_KEY missing — check app.config.js extra.openRouterKey and restart with: npx expo start --clear");
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "HTTP-Referer": "com.sentia.app",
          "X-Title": "Sentia",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
      }
      return response.json();
    }
    const response = await fetch(`${PROXY_BASE_URL}/openrouter/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    return response.json();
  };

  const callWwmVisionAI = async (base64: string, lang: string, prompt: string, signal: AbortSignal): Promise<string> => {
    const imageData = `data:image/jpeg;base64,${base64}`;
    if (USE_DIRECT && !GROQ_KEY && !OPENROUTER_KEY) return "";

    try {
      setStatus("WWM: analyzing...");
      const data = await openRouterRequest({
        model: "google/gemini-2.5-flash",
        max_tokens: WWM_MAX_TOKENS,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
      }, signal);
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= WWM_MIN_RESPONSE_LENGTH) return text;
    } catch (error: any) {
      if (error?.name === "AbortError") throw error;
      console.log("WWM Gemini failed:", error?.message);
    }

    try {
      const data = await groqRequest({
              model: "qwen/qwen3.6-27b",
              max_tokens: WWM_MAX_TOKENS,
              temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
      }, signal);
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= WWM_MIN_RESPONSE_LENGTH) return text;
    } catch (error: any) {
      if (error?.name === "AbortError") throw error;
      console.log("WWM Llama fallback failed:", error?.message);
    }

    return "";
  };

  const callVisionAI = async (
    base64: string,
    lang: LangKey,
    prompt: string,
    maxTokens: number
  ): Promise<string> => {
    const imageData = `data:image/jpeg;base64,${base64}`;

    if (USE_DIRECT && !GROQ_KEY && !OPENROUTER_KEY) {
      const errMsg = D("no_api_key", lang);
      setStatus("No API keys");
      speak(errMsg, lang);
      return "";
    }

    try {
      setStatus("Calling Groq...");

      const data = await groqRequest({

        model: "qwen/qwen3.6-27b",
        max_tokens: 80,
        temperature: 0.25,
        reasoning_effort: "none",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `${prompt}\n\n` +
                  "IMPORTANT: Read the text in the image and return ONLY the readable text. " +
                  "Do not explain your reasoning. Do not describe the image. " +
                  "Do not use <think> tags.",
              },
              {
                type: "image_url",
                image_url: { url: imageData },
              },
            ],
          },
        ],
      });

      const text =
        data?.choices?.[0]?.message?.content?.trim() ?? "";

      console.log(
        "GROQ VISION RESPONSE:",
        JSON.stringify(data?.choices?.[0]?.message)
      );
      console.log("GROQ VISION TEXT:", text);

      if (text && text.length >= MIN_VALID_RESPONSE_LENGTH) {
        setStatus("Groq ✓");
        return text;
      }

      console.log("Groq vision returned empty/short response.");
    } catch (error: any) {
      console.log("Groq vision failed:", error?.message);
    }

    setStatus("Unable to read");
    return "";
} ;

  const callTextAI = async (prompt: string, maxTokens: number): Promise<string | null> => {
    try {
      const data = await groqRequest({
        model: "llama-3.3-70b-versatile",
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      });
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {}
    try {
      const data = await openRouterRequest({
        model: "google/gemini-2.5-pro",
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      });
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {}
    return null;
  };

  const addToConversationHistory = (role: "user" | "assistant", content: string) => {
    let history = [...conversationHistoryRef.current, { role, content }];
    if (history.length > MAX_CONV_HISTORY) {
      history = history.slice(-MAX_CONV_HISTORY);
      if (history[0]?.role === "assistant") history = history.slice(1);
    }
    conversationHistoryRef.current = history;
  };

  const clearConversationHistory = () => {
    conversationHistoryRef.current = [];
  };

  const answerConversationally = async (question: string, onComplete?: () => void, forceOnComplete = false) => {
      const lang = langRef.current;
      if (!lang) return;
      try {
      setIsLoading(true);
      setMode("thinking");
      currentModeRef.current = "thinking";
      setStatus("Thinking...");
      speak(D("thinking", lang), lang);
      const prompt = getConversationPrompt(question, conversationHistoryRef.current, lang);
      let answer = await callTextAI(prompt, 250);
      if (!answer) {
        answer =
          lang === "hi"
            ? "माफ़ करें, अभी जुड़ने में दिक्कत है। थोड़ी देर बाद फिर पूछें।"
            : lang === "mr"
              ? "माफ करा, आत्ता जोडण्यात अडचण आहे. थोड्या वेळाने पुन्हा विचारा."
              : "I'm having a little trouble connecting right now. Please try again in a moment.";
      }
      addToConversationHistory("user", question);
      addToConversationHistory("assistant", answer);
      lastDescriptionRef.current = answer;
      setDescription(answer);
      setStatus("Speaking...");
      setMode("idle");
      currentModeRef.current = "idle";
      setIsLoading(false);
      if (onComplete) speakAndThen(answer, lang, onComplete, false, forceOnComplete);
            else speak(answer, lang);
          } catch (error: any) {
            setStatus(`Error: ${error?.message}`);
            setIsLoading(false);
            setMode("idle");
            currentModeRef.current = "idle";
            if (forceOnComplete && onComplete) onComplete();
          }
        };
  const startListening = async () => {
    const lang = langRef.current;
    if (!audioPermission || !lang) return;
    if (recordingRef.current) return;
    if (isSpeakingRef.current) return;
    if (currentModeRef.current === "listening" || currentModeRef.current === "thinking") return;
    try {
      setMode("listening");
      currentModeRef.current = "listening";
      setStatus("Listening...");
      Vibration.vibrate([0, 80, 60, 80]);
      await playEarcon();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: 1,
        shouldDuckAndroid: true,
      });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      const duration = LISTEN_DURATION_MS[lang] ?? 7000;
      const captured = recording;
      setTimeout(() => {
        if (recordingRef.current === captured) stopListening();
      }, duration);
    } catch {
      recordingRef.current = null;
      setMode("idle");
      currentModeRef.current = "idle";
    }
  };

  const stopListening = async () => {
    const recording = recordingRef.current;
    const lang = langRef.current;
    if (!recording || !lang) return;
    recordingRef.current = null;
    try {
      setStatus("Processing...");
      setMode("thinking");
      currentModeRef.current = "thinking";
      speak(D("thinking", lang), lang);
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const uri = recording.getURI();
      if (!uri) {
        setMode("idle");
        currentModeRef.current = "idle";
        return;
      }

      const formData = new FormData();
      formData.append("file", { uri, type: "audio/m4a", name: "rec.m4a" } as any);
      formData.append("model", "whisper-large-v3");
      if (lang !== "mr") formData.append("language", lang === "hi" ? "hi" : "en");
      const whisperPrompt =
        lang === "hi"
          ? "यह हिंदी में एक सवाल या बातचीत है। Sentia AI के साथ बात हो रही है।"
          : lang === "mr"
            ? "हे मराठीत एक प्रश्न किंवा संभाषण आहे. Sentia AI शी बोलत आहे."
            : "This is a question or conversation with Sentia, a voice AI assistant.";
      formData.append("prompt", whisperPrompt);

      let response: Response;
      if (USE_DIRECT) {
        response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}` },
          body: formData,
        });
      } else {
        response = await fetch(`${PROXY_BASE_URL}/groq/transcribe`, { method: "POST", body: formData });
      }

      const data = await response.json();
      const rawText = data?.text?.trim() ?? "";
      const question = isHallucination(rawText) ? "" : rawText;

      const listenAgain = () => {

  if (alwaysListening) {
    setTimeout(() => {
      startListening();
    }, 1000);
    return;
  }

  if (isConversationModeRef.current) {
    setTimeout(() => {
      startListening();
    }, SILENCE_BUFFER_MS);
  }
};

      const stopWords = ["stop", "bye", "goodbye", "exit", "cancel", "बंद", "रुको", "बस", "थांब", "बंद कर", "थांबा"];
      const clearWords = ["clear memory", "forget everything", "start fresh", "याददाश्त साफ", "सब भूल जाओ", "स्मृती साफ", "सर्व विसरा"];
      const isStop = question && stopWords.some((word) => question.toLowerCase().includes(word));
      const isClear = question && clearWords.some((word) => question.toLowerCase().includes(word));

      if (isClear) {
        clearConversationHistory();
        const message = D("memory_cleared", lang);
        setDescription(message);
        speakAndThen(message, lang, listenAgain);
        return;
      }
      if (isStop) {
        isConversationModeRef.current = false;
        setIsConversationMode(false);
        clearConversationHistory();
        speak(D("conv_off", lang), lang);
        setMode("idle");
        currentModeRef.current = "idle";
        return;
      }

      if (question) {
  setDescription(
    lang === "hi"
      ? `आपने कहा: ${question}`
      : lang === "mr"
      ? `तुम्ही म्हणालात: ${question}`
      : `You said: ${question}`,
  );

  // TEMP TEST: Voice Command Detection

  if (isWalkWithMeRequest(question)) {
    startWalkWithMe();
    return;
  }

  const walkStopWords = [
    "stop walking",
    "stop walk",
    "done walking",
    "exit walk",
    "चलना बंद",
    "चालणे बंद",
    "थांब चालणे",
  ];

  if (
    isWalkWithMeRef.current &&
    walkStopWords.some((word) => question.toLowerCase().includes(word))
  ) {
    stopWalkWithMe();
    return;
  }

  if (isVisualQuestion(question)) {
    const hint = detectOcrHint(question);
    const prefixKey = `ocr_${hint}`;
    const confirmMsg =
      DIALOGUE_PREFIXES[prefixKey]?.[lang] ??
      DIALOGUE_PREFIXES.ocr_general[lang];

    if (isConversationModeRef.current) {
      speakAndThen(confirmMsg, lang, async () => {
        setMode("reading");
        currentModeRef.current = "reading";

        const result = await twoStepOcr(hint, question);

        if (result) {
          lastDescriptionRef.current = result;
          setDescription(result);

          if (isHazard(result)) {
            triggerHazardAlert(result, lang);
            setTimeout(listenAgain, 6000);
          } else {
            speakAndThen(result, lang, listenAgain);
          }
        } else {
          listenAgain();
        }
      });
    } else {
      speak(confirmMsg, lang);

      setTimeout(async () => {
        setMode("reading");
        currentModeRef.current = "reading";

        const result = await twoStepOcr(hint, question);

        if (result) {
          lastDescriptionRef.current = result;
          setDescription(result);

          if (isHazard(result)) {
            triggerHazardAlert(result, lang);
          } else {
            speak(result, lang);
          }
        }

        setMode("idle");
        currentModeRef.current = "idle";
      }, 1200);
    }
  } else {
    answerConversationally(
      question,
      isConversationModeRef.current ? listenAgain : undefined
    );
  }
} else {
        const message = D("didnt_hear", lang);
        if (isConversationModeRef.current) speakAndThen(message, lang, listenAgain);
        else {
          speak(message, lang);
          setMode("idle");
          currentModeRef.current = "idle";
        }
      }
    } catch {
      setMode("idle");
      currentModeRef.current = "idle";
    }
  };

  const handleLongPress = () => {
    const lang = langRef.current;
    if (!lang || isSavingFace) return;
    if (isWalkWithMeRef.current) return;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    tapCountRef.current = 0;
    isScanningRef.current = false;
    setIsScanning(false);
    setMode("reading");
    currentModeRef.current = "reading";
    Vibration.vibrate(100);
    speak(D("ocr_general", lang), lang);
    const delay = cameraReadyRef.current ? 1800 : 3000;
    setTimeout(async () => {
      const result = await twoStepOcr("general");
      if (result) {
        lastDescriptionRef.current = result;
        setDescription(result);
        if (isHazard(result)) triggerHazardAlert(result, lang);
        else speak(result, lang);
      }
      setMode("idle");
      currentModeRef.current = "idle";
    }, delay);
  };

  const handleVoiceLongPress = () => {
    const lang = langRef.current;
    if (!lang || isSavingFace) return;
    if (isWalkWithMeRef.current) {
      stopWalkWithMe();
      return;
    }
    isScanningRef.current = false;
    setIsScanning(false);
    if (isConversationModeRef.current) {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      isConversationModeRef.current = false;
      setIsConversationMode(false);
      clearConversationHistory();
      Speech.stop();
      isSpeakingRef.current = false;
      speak(D("conv_off", lang), lang);
      setMode("idle");
      currentModeRef.current = "idle";
    } else {
      isConversationModeRef.current = true;
      setIsConversationMode(true);
      Vibration.vibrate([0, 200, 100, 200]);
      speakAndThen(D("conv_on", lang), lang, () => startListening());
    }
  };

  const handleTap = () => {
    const lang = langRef.current;
    if (!lang || isSavingFace) return;
    if (isWalkWithMeRef.current) {
      tapCountRef.current += 1;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        const taps = tapCountRef.current;
        tapCountRef.current = 0;
        if (taps >= 2) stopWalkWithMe();
      }, 400);
      return;
    }
    playEarcon();
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      const taps = tapCountRef.current;
      tapCountRef.current = 0;
      if (taps === 1) {
        if (!isScanningRef.current) {
          isScanningRef.current = true;
          setIsScanning(true);
          Vibration.vibrate(100);
          speak(D("scanning_start", lang), lang);
        }
      } else if (taps === 2) {
        if (isScanningRef.current) {
          isScanningRef.current = false;
          setIsScanning(false);
          Vibration.vibrate([0, 100, 100, 100]);
          speak(D("scanning_stop", lang), lang);
        }
      } else if (taps >= 3) {
        isScanningRef.current = false;
        setIsScanning(false);
        Vibration.vibrate([0, 100, 100, 100, 100, 100]);
        saveFace();
      }
    }, 400);
  };
  
  const speechLangForCurrentLanguage = () => {
  const current = langRef.current;
  if (current === "hi") return "hi-IN";
  if (current === "mr") return "mr-IN";
  return "en-IN";
};

const startExpoSpeechRecognition = async () => {
  const lang = langRef.current;
  if (!lang) return;

  const permissionResult = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permissionResult.granted) {
    speak("Microphone permission is needed for voice commands.", lang);
    return;
  }

  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    speak("Speech recognition is not available on this phone.", lang);
    return;
  }

  try {
      ExpoSpeechRecognitionModule.start({
        lang: speechLangForCurrentLanguage(),
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        contextualStrings: [
          "Hey Sentia",
          "Sentia",
          "help",
          "bachao",
          "madad",
          "vachva",
          "where am I",
          "current location",
          "navigate to",
          "directions to",
          "nearby hospital",
          "nearby pharmacy",
          "nearby bus stop",
          "stop navigation",
        ],
        androidIntentOptions: {
                EXTRA_LANGUAGE_MODEL: "web_search",
                EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1500,
                EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1000,
              },
      });
      if (recognitionWatchdogRef.current) clearTimeout(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = setTimeout(() => {
            recognitionWatchdogRef.current = null;
            console.log("VOICE watchdog fired — recognition silently failed to start, forcing retry");
            if (alwaysListeningRef.current && !voiceCommandBusyRef.current && !voiceFlowActiveRef.current) {
              try { ExpoSpeechRecognitionModule.abort(); } catch {}
              startExpoSpeechRecognition();
            }
          }, 4000);
    } catch (error) {
      console.warn("Speech recognition start failed:", error);
      restartExpoSpeechRecognitionSoon();
    }
};

const stopExpoSpeechRecognition = () => {
  if (speechRestartTimerRef.current) {
    clearTimeout(speechRestartTimerRef.current);
    speechRestartTimerRef.current = null;
  }

  wakeDetectedRef.current = false;
  voiceCommandBusyRef.current = false;
  alwaysListeningRef.current = false;
  setAlwaysListening(false);

  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {}
  Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
}).catch(() => {});
};

const restartExpoSpeechRecognitionSoon = (delay = 500) => {
  if (!alwaysListeningRef.current || voiceCommandBusyRef.current || voiceFlowActiveRef.current) return;
  if (speechRestartTimerRef.current) clearTimeout(speechRestartTimerRef.current);

  speechRestartTimerRef.current = setTimeout(() => {
    speechRestartTimerRef.current = null;
    if (!alwaysListeningRef.current || voiceCommandBusyRef.current || voiceFlowActiveRef.current) return;
    if (isSpeakingRef.current) {
      // App is still talking — wait, don't let the mic hear itself
      restartExpoSpeechRecognitionSoon(300);
      return;
    }
    startExpoSpeechRecognition();
  }, delay);
};

const extractCommandAfterWakeWord = (text: string) => {
  const lower = text.toLowerCase();
  const phrases = ["hey sentia", "hay sentia", "hi sentia", "sentia"];

  for (const phrase of phrases) {
    const index = lower.indexOf(phrase);
    if (index >= 0) {
      return text.slice(index + phrase.length).trim();
    }
  }

  return "";
};

const speakCurrentLocation = async () => {
  const lang = langRef.current ?? "en";

  try {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      speak("Location permission is required to tell where you are.", lang);
      return;
    }

    setStatus("Getting accurate location...");

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });

    const { latitude, longitude, accuracy } = position.coords;

    let addressText = "";

    if (GOOGLE_MAPS_KEY) {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?latlng=${latitude},${longitude}` +
        `&result_type=street_address|premise|subpremise|establishment` +
        `&key=${GOOGLE_MAPS_KEY}`;

      const response = await fetch(url);
      const data = await response.json();

      const bestResult = data.results?.[0];

      if (bestResult?.formatted_address) {
        addressText = bestResult.formatted_address;
      }
    }

    if (!addressText) {
      const addresses = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      const address = addresses[0];

      addressText = address
        ? [
            address.name,
            address.street,
            address.district,
            address.city,
            address.region,
            address.postalCode,
            address.country,
          ]
            .filter(Boolean)
            .join(", ")
        : `latitude ${latitude.toFixed(5)}, longitude ${longitude.toFixed(5)}`;
    }

    const accuracyText =
  typeof accuracy === "number"
    ? ` GPS accuracy is about ${Math.round(accuracy)} meters.`
    : "";

const isAccurate = typeof accuracy === "number" && accuracy <= 30;

const message = isAccurate
  ? `You are at ${addressText}.${accuracyText}`
  : `You appear to be near ${addressText}.${accuracyText}`;

setDescription(message);
speak(message, lang);
  } catch (error) {
    console.warn("Location error:", error);
    speak(
      "Sorry, I could not get your accurate location. Please turn on GPS and location permission.",
      lang,
    );
  }
};

const handleExpoVoiceCommand = async (command: string) => {
  const lang = langRef.current;
  if (!lang || !command.trim()) {
    wakeDetectedRef.current = false;
    restartExpoSpeechRecognitionSoon();
    return;
  }

  voiceCommandBusyRef.current = true;
  wakeDetectedRef.current = false;

  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {}

  try {
    setMode("thinking");
    currentModeRef.current = "thinking";
    setStatus("Thinking...");
    Vibration.vibrate([0, 80, 60, 80]);

    const lowerCommand = command.toLowerCase();

if (
  lowerCommand.includes("time") ||
  lowerCommand.includes("what time") ||
  lowerCommand.includes("current time") ||
  lowerCommand.includes("tell me time")
) {
  const now = new Date();

  const timeText = now.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

  const message = `The time is ${timeText}.`;

  speak(message, langRef.current ?? "en");

  voiceCommandBusyRef.current = false;
  setMode("idle");
  currentModeRef.current = "idle";

  setTimeout(() => {
    restartExpoSpeechRecognitionSoon();
  }, 2000);

  return;
}

if (
  lowerCommand.includes("where am i") ||
  lowerCommand.includes("where am") ||
  lowerCommand.includes("current location") ||
  lowerCommand.includes("my location")
) {
  await speakCurrentLocation();

  voiceCommandBusyRef.current = false;
  setMode("idle");
  currentModeRef.current = "idle";

  setTimeout(() => {
    restartExpoSpeechRecognitionSoon();
  }, 2500);

  return;
}

const intent = intentRouter.route(command);

if (intent.mode === "navigation") {
      const response = await navigationService.handleIntent(intent);
      speakAndThen(response, lang, () => {
        voiceCommandBusyRef.current = false;
        setMode("idle");
        currentModeRef.current = "idle";
        restartExpoSpeechRecognitionSoon();
      }, false, true); // force: must clear the busy flag even outside "conversation mode"
      return;
    }

    answerConversationally(command, () => {
      voiceCommandBusyRef.current = false;
      setMode("idle");
      currentModeRef.current = "idle";
      restartExpoSpeechRecognitionSoon();
    }, true); // force: same reason
  } catch (error) {
    console.warn("Voice command failed:", error);
    speakAndThen("Sorry, I could not complete that voice command.", lang, () => {
      voiceCommandBusyRef.current = false;
      setMode("idle");
      currentModeRef.current = "idle";
      restartExpoSpeechRecognitionSoon();
    }, false, true); // force: same reason
  }
};

  const handleVoiceTap = () => {
    const lang = langRef.current;
    if (!lang) return;
    if (isWalkWithMeRef.current) {
      stopWalkWithMe();
      return;
    }

    micTapCountRef.current += 1;
    if (micTapTimerRef.current) clearTimeout(micTapTimerRef.current);

    micTapTimerRef.current = setTimeout(() => {
      const taps = micTapCountRef.current;
      micTapCountRef.current = 0;

      if (alwaysListeningRef.current) {
        stopExpoSpeechRecognition();
        speak("Listening stopped", lang);
        setMode("idle");
        currentModeRef.current = "idle";
        return;
      } else if (taps === 1) {
        isScanningRef.current = false;
        setIsScanning(false);
        Vibration.vibrate([0, 100, 80, 100]);

        alwaysListeningRef.current = true;
        setAlwaysListening(true);
        setMode("listening");
        currentModeRef.current = "listening";
        setStatus("Say your command");

        speak("Listening started. Say your command.", lang);

setTimeout(() => {
  startExpoSpeechRecognition();
}, 1200);

return;
      } else if (taps === 2) {
        Vibration.vibrate([0, 80, 60, 80]);
      } else if (taps >= 3) {
        isScanningRef.current = false;
        setIsScanning(false);
        Speech.stop();
        startWalkWithMe();
      }
    }, 400);
  };

  const openFaceManagement = () => {
    const lang = langRef.current;
    if (!lang) return;
    setMode("facemanage");
    currentModeRef.current = "facemanage";
    const faces = savedFacesRef.current;
    if (faces.length === 0) {
      speak(FS("faceManageEmpty", lang), lang);
      return;
    }
    const list = faces.map((face, index) => `${index + 1}. ${face.name}`).join(". ");
    speak(FS("faceManageList", lang, { list }), lang);
    const delay = Math.max(4000, list.length * 80);
    setTimeout(() => {
      speak(FS("sayNumber", lang), lang);
      setTimeout(() => listenForDeleteNumber(), 2500);
    }, delay);
  };

  const listenForDeleteNumber = async () => {
    const lang = langRef.current;
    if (!lang || !audioPermission || currentModeRef.current !== "facemanage") return;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      Vibration.vibrate(100);
      setTimeout(async () => {
        try {
          await recording.stopAndUnloadAsync();
          const uri = recording.getURI();
          if (!uri) return;
          const formData = new FormData();
          formData.append("file", { uri, type: "audio/m4a", name: "num.m4a" } as any);
          formData.append("model", "whisper-large-v3");
          if (lang !== "mr") formData.append("language", lang === "hi" ? "hi" : "en");
          let response: Response;
          if (USE_DIRECT) {
            response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
              method: "POST",
              headers: { Authorization: `Bearer ${GROQ_KEY}` },
              body: formData,
            });
          } else {
            response = await fetch(`${PROXY_BASE_URL}/groq/transcribe`, { method: "POST", body: formData });
          }
          const data = await response.json();
          const spoken = data?.text?.trim() ?? "";
          const numberWords: Record<string, number> = {
            one: 1,
            two: 2,
            three: 3,
            four: 4,
            five: 5,
            six: 6,
            seven: 7,
            eight: 8,
            nine: 9,
            ten: 10,
            एक: 1,
            दो: 2,
            तीन: 3,
            चार: 4,
            पांच: 5,
            छह: 6,
            सात: 7,
            आठ: 8,
            नौ: 9,
            दस: 10,
            दोन: 2,
            पाच: 5,
            सहा: 6,
            नऊ: 9,
            दहा: 10,
          };
          let num = parseInt(spoken.match(/\d+/)?.[0] ?? "0", 10);
          if (!num) {
            const lower = spoken.toLowerCase();
            for (const [word, value] of Object.entries(numberWords)) {
              if (lower.includes(word)) {
                num = value;
                break;
              }
            }
          }
          const faces = savedFacesRef.current;
          if (!num || num < 1 || num > faces.length) {
            speak(FS("invalidNumber", lang, { max: String(faces.length) }), lang);
            setTimeout(() => listenForDeleteNumber(), 3000);
            return;
          }
          const faceToRemove = faces[num - 1];
          setFaceToDelete(faceToRemove);
          setMode("facedeleteconfirm");
          currentModeRef.current = "facedeleteconfirm";
          speak(FS("faceDeleteAsk", lang, { name: faceToRemove.name }), lang);
        } catch {
          speak(FS("numberNotHeard", lang), lang);
          setTimeout(() => listenForDeleteNumber(), 2000);
        }
      }, 4000);
    } catch {}
  };

  const confirmDeleteFace = async (confirm: boolean) => {
    const lang = langRef.current;
    if (!lang || !faceToDelete) return;
    if (confirm) {
      const updated = savedFacesRef.current.filter((face) => face.id !== faceToDelete.id);
      setSavedFaces(updated);
      savedFacesRef.current = updated;
      await AsyncStorage.setItem("sentia_faces", JSON.stringify(updated));
      speak(FS("faceDeleted", lang, { name: faceToDelete.name }), lang);
      Vibration.vibrate([0, 200, 100, 200]);
    } else {
      speak(FS("faceDeleteCancelled", lang, { name: faceToDelete.name }), lang);
    }
    setFaceToDelete(null);
    setMode("settings");
    currentModeRef.current = "settings";
  };

  const saveFace = async () => {
    const lang = langRef.current;
    if (!lang || !cameraRef.current) return;
    if (savedFacesRef.current.length >= MAX_FACES) {
      speak(FS("maxFaces", lang), lang);
      return;
    }
    try {
      setIsSavingFace(true);
      setMode("savingface");
      currentModeRef.current = "savingface";
      speak(FS("askName", lang), lang);
      Vibration.vibrate(200);
      setTimeout(async () => {
        setMode("namingface");
        currentModeRef.current = "namingface";
        speak(D("recording_now", lang), lang);
        try {
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          Vibration.vibrate(100);
          setTimeout(async () => {
            try {
              await recording.stopAndUnloadAsync();
              await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
              const uri = recording.getURI();
              if (!uri) {
                setIsSavingFace(false);
                setMode("idle");
                currentModeRef.current = "idle";
                return;
              }
              const formData = new FormData();
              formData.append("file", { uri, type: "audio/m4a", name: "name.m4a" } as any);
              formData.append("model", "whisper-large-v3");
              if (lang !== "mr") formData.append("language", lang === "hi" ? "hi" : "en");
              let response: Response;
              if (USE_DIRECT) {
                response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${GROQ_KEY}` },
                  body: formData,
                });
              } else {
                response = await fetch(`${PROXY_BASE_URL}/groq/transcribe`, { method: "POST", body: formData });
              }
              const transcriptData = await response.json();
              const spokenName = transcriptData?.text?.trim();
              if (!spokenName) {
                speak(FS("faceNotHeard", lang), lang);
                setIsSavingFace(false);
                setMode("idle");
                currentModeRef.current = "idle";
                return;
              }
              speak(FS("takingPhoto", lang), lang);
                            setTimeout(async () => {
                              if (!cameraRef.current || currentModeRef.current === "sos") {
                                console.log("SAVE FACE: aborted — camera gone or SOS interrupted the flow");
                                setIsSavingFace(false);
                                setMode("idle");
                                currentModeRef.current = "idle";
                                return;
                              }
                              speak(D("photo_now", lang), lang);
                              const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true });
                              if (!photo?.base64) {
                                setIsSavingFace(false);
                                setMode("idle");
                                currentModeRef.current = "idle";
                                return;
                              }
                const resized = await ImageManipulator.manipulateAsync(
                  photo.uri,
                  [{ resize: { width: 480 } }],
                  { base64: true, compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
                );
                if (!resized.base64) {
                  setIsSavingFace(false);
                  setMode("idle");
                  currentModeRef.current = "idle";
                  return;
                }
                const faceDescription = await callVisionAI(resized.base64, lang, getFaceDescPrompt(lang), 200);
                if (!faceDescription || faceDescription === D("fallback", lang)) {
                  speak(FS("faceDescFailed", lang), lang);
                  setIsSavingFace(false);
                  setMode("idle");
                  currentModeRef.current = "idle";
                  return;
                }
                const newFace: SavedFace = {
                  id: Date.now().toString(),
                  name: spokenName,
                  description: faceDescription,
                  timestamp: Date.now(),
                };
                const updated = [...savedFacesRef.current, newFace];
                setSavedFaces(updated);
                savedFacesRef.current = updated;
                await AsyncStorage.setItem("sentia_faces", JSON.stringify(updated));
                const confirmMsg = FS("faceSaved", lang, { name: spokenName });
                speak(confirmMsg, lang);
                Vibration.vibrate([0, 200, 100, 200, 100, 200]);
                setDescription(confirmMsg);
                setIsSavingFace(false);
                setMode("idle");
                currentModeRef.current = "idle";
              }, 2000);
            } catch {
              setIsSavingFace(false);
              setMode("idle");
              currentModeRef.current = "idle";
            }
          }, 4000);
        } catch {
          setIsSavingFace(false);
          setMode("idle");
          currentModeRef.current = "idle";
        }
      }, 3000);
    } catch {
      setIsSavingFace(false);
      setMode("idle");
      currentModeRef.current = "idle";
    }
  };

  const handleSettingsTap = () => {
    const lang = langRef.current;
    if (!lang) return;
    if (currentModeRef.current === "facedeleteconfirm") {
      const now = Date.now();
      const timeSinceLast = now - lastTapTimeRef.current;
      lastTapTimeRef.current = now;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (timeSinceLast < 400) confirmDeleteFace(false);
      else tapTimerRef.current = setTimeout(() => confirmDeleteFace(true), 400);
      return;
    }
    lastTapTimeRef.current = Date.now();
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      const taps = tapCountRef.current;
      tapCountRef.current = 0;
      if (taps === 1) {
        setVoiceGender("female");
        voiceGenderRef.current = "female";
        AsyncStorage.setItem("sentia_voice", "female");
        Speech.stop();
        setTimeout(() => speakRaw(FS("femaleSelected", lang), lang, false, "female"), 200);
      } else if (taps === 2) {
        setVoiceGender("male");
        voiceGenderRef.current = "male";
        AsyncStorage.setItem("sentia_voice", "male");
        Speech.stop();
        setTimeout(() => speakRaw(FS("maleSelected", lang), lang, false, "male"), 200);
      } else if (taps >= 3) {
        if (taps === 4) setSosContact();
        else openFaceManagement();
      }
    }, 400);
  };

  const getStatusLabel = () => {
      if (mode === "sos" && sosSourceRef.current === "voice") return "🆘 SOS — shake to cancel";
    if (isHazardAlert) return "⚠️ HAZARD DETECTED";
    if (!isOnline) return "📵 Offline";
    if (mode === "walkwithme") {
      const urgencyIcon = { CLEAR: "🟢", CAUTION: "🟡", STOP: "🔴", DANGER: "🆘" }[wwmStatus];
      const tiltNote = phoneTiltedRef.current ? " ⚡ stabilising" : "";
      return `${urgencyIcon} Walk With Me — ${wwmStepCount} steps${tiltNote}`;
    }
    if (mode === "listening") return isConversationMode ? "🔁 Listening..." : "🎤 Listening...";
    if (mode === "thinking") return "💭 Thinking...";
    if (mode === "savingface") return "📸 Saving face...";
    if (mode === "namingface") return "🎤 Say the name...";
    if (mode === "facemanage") return "👥 Face Management";
    if (mode === "facedeleteconfirm") return "🗑️ Confirm delete?";
    if (isLoading) return `⏳ ${status}`;
    if (mode === "scanning") return `🟢 Scanning${savedFaces.length > 0 ? ` (${savedFaces.length} known)` : ""}`;
    if (mode === "reading") return "🔍 Reading...";
    if (isConversationMode) return `🔁 Conversation (${Math.floor(conversationHistoryRef.current.length / 2)} turns)`;
    return "⚪ Ready";
  };

  const getGestureGuide = () => {
    if (!language) return "";
    if (mode === "walkwithme") return "👆👆 Double tap to stop  •  Hold mic to stop  •  Shake to stop";
    if (mode === "scanning") return "👆👆 Double tap to stop  •  ✋ Hold to read  •  2-finger tap to repeat";
    return "👆 Tap to scan  •  ✋ Hold to read  •  🎤🎤🎤 Triple-mic for Walk";
  };

  const handleAcceptPrivacy = async () => {
    await AsyncStorage.setItem("sentia_privacy_consent", "true");
    setPrivacyConsented(true);
    setTimeout(() => {
      Speech.speak(LANG_SELECT_AUDIO, { language: "en-US", rate: 0.78, pitch: 1.1 });
    }, 400);
  };

  if (showSettings && language) {
      return (
        <View style={styles.settingsScreen}>
          <StatusBar barStyle="light-content" />
          <ScrollView
            contentContainerStyle={styles.settingsScrollContent}
            showsVerticalScrollIndicator={true}
            onTouchStart={() => { settingsDraggingRef.current = false; }}
            onScrollBeginDrag={() => { settingsDraggingRef.current = true; }}
            onTouchEnd={() => {
              if (settingsDraggingRef.current) {
                settingsDraggingRef.current = false;
                return;
              }
              handleSettingsTap();
            }}
          >
        <Text style={styles.settingsTitle}>{mode === "facemanage" ? "👥" : mode === "facedeleteconfirm" ? "🗑️" : "⚙️"}</Text>
        <Text style={styles.settingsHeading}>
          {mode === "facemanage"
            ? language === "hi"
              ? "चेहरा प्रबंधन"
              : language === "mr"
                ? "चेहरा व्यवस्थापन"
                : "Face Management"
            : mode === "facedeleteconfirm"
              ? language === "hi"
                ? "पुष्टि करें"
                : language === "mr"
                  ? "पुष्टी करा"
                  : "Confirm Delete"
              : language === "hi"
                ? "सेटिंग्स"
                : language === "mr"
                  ? "सेटिंग्स"
                  : "Settings"}
        </Text>
        {mode === "facedeleteconfirm" && faceToDelete ? (
          <View style={styles.deleteConfirmBox}>
            <Text style={styles.deleteConfirmName}>🗑️ {faceToDelete.name}</Text>
            <Text style={styles.deleteConfirmInstructions}>
              {language === "hi"
                ? "एक बार = हटाएं\nदो बार = रद्द करें"
                : language === "mr"
                  ? "एकदा = काढा\nदोनदा = रद्द करा"
                  : "One tap = Delete\nDouble tap = Cancel"}
            </Text>
          </View>
        ) : mode === "facemanage" ? (
          <View style={styles.facesListBox}>
            {savedFaces.length === 0 ? (
              <Text style={styles.noFacesText}>{language === "hi" ? "कोई चेहरा नहीं" : language === "mr" ? "कोणताही चेहरा नाही" : "No faces saved"}</Text>
            ) : (
              savedFaces.map((face, idx) => (
                <View key={face.id} style={styles.faceItem}>
                  <Text style={styles.faceNumber}>{idx + 1}</Text>
                  <Text style={styles.faceName}>{face.name}</Text>
                </View>
              ))
            )}
          </View>
        ) : (
          <>
            <View style={styles.voiceIndicator}>
              <Text style={styles.voiceIndicatorText}>{voiceGender === "female" ? "👩" : "👨"}</Text>
              <Text style={styles.voiceIndicatorLabel}>
                {voiceGender === "female"
                  ? language === "hi"
                    ? "महिला आवाज़"
                    : language === "mr"
                      ? "महिला आवाज"
                      : "Female voice"
                  : language === "hi"
                    ? "पुरुष आवाज़"
                    : language === "mr"
                      ? "पुरुष आवाज"
                      : "Male voice"}
              </Text>
            </View>
            <View style={styles.facesCountBox}>
              <Text style={styles.facesCountText}>
                👥{" "}
                {savedFaces.length > 0
                  ? language === "hi"
                    ? `${savedFaces.length} लोग: ${savedFaces.map((face) => face.name).join(", ")}`
                    : language === "mr"
                      ? `${savedFaces.length} लोक: ${savedFaces.map((face) => face.name).join(", ")}`
                      : `${savedFaces.length} saved: ${savedFaces.map((face) => face.name).join(", ")}`
                  : language === "hi"
                    ? "कोई चेहरा नहीं"
                    : language === "mr"
                      ? "कोणताही चेहरा नाही"
                      : "No faces saved yet"}
              </Text>
            </View>
            <View style={styles.guardianBox} onStartShouldSetResponder={() => true} onTouchEnd={(e) => e.stopPropagation()}>
                                      <Text style={styles.guardianHeading}>
                                        🆘 {language === "hi" ? "गार्डियन" : language === "mr" ? "गार्डियन" : "Guardians"}
                                      </Text>
                                      {guardians.length > 0 ? (
                                        guardians.map((g, idx) => (
                                          <View key={idx} style={styles.guardianRow}>
                                            <View>
                                              <Text style={styles.guardianName}>{g.name}</Text>
                                              <Text style={styles.guardianPhone}>{g.phone}</Text>
                                            </View>
                                            {pendingDeleteIndex === idx ? (
                                              <View style={{ flexDirection: "row", gap: 8 }}>
                                                <TouchableOpacity
                                                  onPress={() => confirmGuardianDelete(idx)}
                                                  style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#ff4444", borderRadius: 8 }}
                                                >
                                                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Confirm</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                  onPress={() => setPendingDeleteIndex(null)}
                                                  style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8 }}
                                                >
                                                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Cancel</Text>
                                                </TouchableOpacity>
                                              </View>
                                            ) : (
                                              <TouchableOpacity
                                                onPress={() => setPendingDeleteIndex(idx)}
                                                style={{ padding: 8, backgroundColor: "rgba(255,68,68,0.2)", borderRadius: 10 }}
                                              >
                                                <Text style={{ fontSize: 20 }}>🗑️</Text>
                                              </TouchableOpacity>
                                            )}
                                          </View>
                                        ))
                                      ) : (
                                        <Text style={styles.guardianEmpty}>
                                          {language === "hi"
                                            ? "कोई गार्डियन सेट नहीं"
                                            : language === "mr"
                                              ? "कोणताही गार्डियन सेट नाही"
                                              : "No guardians set yet"}
                                        </Text>
                                      )}
                                    </View>
            <View style={styles.settingsInstructions}>
              <Text style={styles.settingsInstructionText}>👆 {language === "hi" ? "एक बार = महिला आवाज़" : language === "mr" ? "एकदा = महिला आवाज" : "One tap = Female voice"}</Text>
              <Text style={styles.settingsInstructionText}>👆👆 {language === "hi" ? "दो बार = पुरुष आवाज़" : language === "mr" ? "दोनदा = पुरुष आवाज" : "Double tap = Male voice"}</Text>
              <Text style={styles.settingsInstructionText}>👆👆👆 {language === "hi" ? "तीन बार = चेहरा प्रबंधन" : language === "mr" ? "तीनदा = चेहरा व्यवस्थापन" : "Triple tap = Manage faces"}</Text>
              <Text style={styles.settingsInstructionText}>👆👆👆👆 {language === "hi" ? "चार बार = SOS नंबर सेट करें" : language === "mr" ? "चारदा = SOS नंबर सेट करा" : "4 taps = Set SOS number"}</Text>
              <Text style={styles.settingsInstructionText}>🚶 {language === "hi" ? "माइक तीन बार = Walk With Me" : language === "mr" ? "मायक तीनदा = Walk With Me" : "Triple-tap mic = Walk With Me"}</Text>
              <Text style={styles.settingsInstructionText}>📳 {language === "hi" ? "हिलाएं = बंद करें" : language === "mr" ? "हलवा = बंद करा" : "Shake = Close settings"}</Text>
              <Text style={styles.settingsInstructionText}>🆘 {language === "hi" ? "दो बार हिलाएं = SOS कॉल" : language === "mr" ? "दोनदा हलवा = SOS कॉल" : "Double shake = SOS call"}</Text>
            </View>
          </>
        )}
    </ScrollView>
      </View>
    );
  }

  if (privacyConsented === null) {
    return (
      <View style={styles.langScreen}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#6200EE" size="large" />
      </View>
    );
  }

  if (!privacyConsented) {
    return (
      <View style={styles.langScreen}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.appName}>Sentia</Text>
        <Text style={styles.tagline}>Visual AI for Everyone</Text>

        <View style={styles.privacyBox}>
          <Text style={styles.privacyHeading}>Privacy Notice</Text>
          <Text style={styles.privacyText}>
            Sentia uses your camera, microphone, and motion sensors to help you navigate and read text.{"\n\n"}
            <Text style={styles.privacyBold}>What we collect:</Text>
            {"\n"}• Camera images are sent to AI servers (Groq / Google) for analysis and are not stored by us.{"\n"}• Voice recordings are transcribed by Groq&apos;s Whisper and then deleted.{"\n"}• Face descriptions (text only, no photos) are stored locally on your device only.{"\n"}• No data is sold or shared with advertisers.{"\n\n"}
            <Text style={styles.privacyBold}>Your rights (DPDP Act 2023):</Text>
            {"\n"}You may delete all saved faces at any time from Settings. Withdrawing consent uninstalls the app.
          </Text>

          <Text style={[styles.privacyHeading, { marginTop: 16 }]}>गोपनीयता सूचना</Text>
          <Text style={styles.privacyText}>
            Sentia आपके कैमरे, माइक्रोफ़ोन और सेंसर का उपयोग करती है।{"\n"}कैमरा छवियां AI सर्वर को भेजी जाती हैं, हमारे पास संग्रहीत नहीं होतीं। आवाज़ रिकॉर्डिंग ट्रांसक्राइब होने के बाद हटा दी जाती है। चेहरे का विवरण केवल आपके फ़ोन पर रहता है। कोई डेटा नहीं बेचा जाता।
          </Text>

          <Text style={[styles.privacyHeading, { marginTop: 16 }]}>गोपनीयता सूचना</Text>
          <Text style={styles.privacyText}>
            Sentia तुमचा कॅमेरा, माइक आणि सेन्सर वापरते।{"\n"}कॅमेरा प्रतिमा AI सर्व्हरला पाठवल्या जातात, साठवल्या जात नाहीत. आवाज रेकॉर्डिंग लिप्यंतरणानंतर हटवली जाते. चेहऱ्याचे वर्णन फक्त तुमच्या फोनवर राहते. कोणताही डेटा विकला जात नाही.
          </Text>
        </View>

        <TouchableOpacity style={styles.privacyAcceptBtn} onPress={handleAcceptPrivacy}>
          <Text style={styles.privacyAcceptText}>I Agree / मैं सहमत हूं / मी सहमत आहे</Text>
        </TouchableOpacity>

        <Text style={styles.privacyFooter}>
          By continuing you accept our Privacy Policy.{"\n"}जारी रखकर आप गोपनीयता नीति स्वीकार करते हैं।{"\n"}पुढे जाऊन तुम्ही गोपनीयता धोरण स्वीकारता.
        </Text>
      </View>
    );
  }

  if (!language) {
    return (
      <View style={styles.langScreen}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.appName}>Sentia</Text>
        <Text style={styles.tagline}>Visual AI for Everyone</Text>
        <Text style={styles.chooseText}>Choose Language / भाषा निवडा / भाषा चुनें</Text>
        {(Object.keys(LANGUAGES) as LangKey[]).map((key) => (
          <TouchableOpacity
            key={key}
            style={styles.langButton}
            onPress={async () => {
              await AsyncStorage.setItem("sentia_lang", key);
              setLanguage(key);
            }}
          >
            <Text style={styles.langButtonText}>{LANGUAGES[key].label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.langSwitchBtn}
          onPress={async () => {
            isScanningRef.current = false;
            setIsScanning(false);
            if (isWalkWithMeRef.current) stopWalkWithMe(true);
            Speech.stop();
            clearConversationHistory();
            await AsyncStorage.removeItem("sentia_lang");
            setLanguage(null);
            setMode("idle");
            currentModeRef.current = "idle";
          }}
        >
          <Text style={styles.langSwitchText}>🌐 Language</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission?.granted) {
      console.log("CAMERA PERMISSION STATE:", JSON.stringify(permission));
      return (
        <View style={styles.langScreen}>
          <StatusBar barStyle="light-content" />
          <Text style={styles.appName}>Sentia</Text>
          <Text style={styles.chooseText}>Camera permission is required</Text>
          <TouchableOpacity
            style={styles.langButton}
            onPress={() => {
              if (permission?.canAskAgain === false) {
                Linking.openSettings();
              } else {
                requestPermission();
              }
            }}
          >
            <Text style={styles.langButtonText}>
              {permission?.canAskAgain === false ? "Open Phone Settings" : "Allow Camera"}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

  if (mode === "sos" && sosSourceRef.current === "voice") {
        return (
          <View style={[styles.container, { backgroundColor: "#8b0000" }]}>
          <StatusBar barStyle="light-content" />
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24 }}>
            <Text style={{ fontSize: 80 }}>🆘</Text>
            <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", textAlign: "center" }}>SOS</Text>
            {sosSourceRef.current === "shake" ? (
              <>
                <Text style={{ color: "#fff", fontSize: 64, fontWeight: "900" }}>{sosCountdown}</Text>
                <Text style={{ color: "#ffaaaa", fontSize: 18, textAlign: "center", paddingHorizontal: 32 }}>
                  Sending in {sosCountdown} second{sosCountdown === 1 ? "" : "s"}.{"\n"}Shake phone or say "cancel" to stop.
                </Text>
              </>
            ) : (
              <Text style={{ color: "#ffaaaa", fontSize: 18, textAlign: "center", paddingHorizontal: 32 }}>
                Sending your location and alert to guardians now.{"\n"}Say "cancel" to stop.
              </Text>
            )}
          </View>
        </View>
      );
    }

  const wwmBgColor = {
    CLEAR: "rgba(0,180,80,0.18)",
    CAUTION: "rgba(255,180,0,0.22)",
    STOP: "rgba(220,50,50,0.28)",
    DANGER: "rgba(180,0,0,0.45)",
  }[wwmStatus];

  const wwmBorderColor = {
    CLEAR: "#00c850",
    CAUTION: "#ffb400",
    STOP: "#ff3333",
    DANGER: "#ff0000",
  }[wwmStatus];

  return (
    <View style={[styles.container, isHazardAlert && styles.hazardContainer]} {...panResponder.panHandlers}>
      <StatusBar barStyle="light-content" />
      <TouchableOpacity
        style={styles.fullScreen}
        activeOpacity={1}
        onPress={handleTap}
        onLongPress={handleLongPress}
        delayLongPress={LONG_PRESS_DELAY}
      >
        <CameraView ref={cameraRef} style={styles.camera} facing="back" onCameraReady={() => { cameraReadyRef.current = true; }} />
      </TouchableOpacity>

      {mode === "walkwithme" && (
        <View style={[styles.wwmOverlay, { backgroundColor: wwmBgColor, borderColor: wwmBorderColor }]} pointerEvents="none">
          <Text style={styles.wwmIcon}>{{ CLEAR: "🟢", CAUTION: "🟡", STOP: "🔴", DANGER: "🆘" }[wwmStatus]}</Text>
          <Text style={styles.wwmTitle}>Walk With Me</Text>
          <Text style={styles.wwmUrgencyLabel}>{{ CLEAR: "PATH CLEAR", CAUTION: "SLOW DOWN", STOP: "STOP", DANGER: "DANGER" }[wwmStatus]}</Text>
          <Text style={styles.wwmDescription} numberOfLines={2}>
            {description}
          </Text>
          <View style={styles.wwmStepBadge}>
            <Text style={styles.wwmStepText}>👟 {wwmStepCount} steps</Text>
          </View>
          <Text style={styles.wwmHint}>
            {language === "hi" ? "रुकने के लिए दो बार टैप करें" : language === "mr" ? "थांबण्यासाठी दोनदा टॅप करा" : "Double tap or shake to stop"}
          </Text>
        </View>
      )}

      {isSavingFace && (
        <View style={styles.savingFaceOverlay} pointerEvents="none">
          <Text style={styles.savingFaceIcon}>{mode === "namingface" ? "🎤" : "📸"}</Text>
          <Text style={styles.savingFaceText}>
            {mode === "namingface"
              ? language === "hi"
                ? "नाम बोलें..."
                : language === "mr"
                  ? "नाव सांगा..."
                  : "Say the name..."
              : language === "hi"
                ? "चेहरा याद कर रही हूं..."
                : language === "mr"
                  ? "चेहरा लक्षात ठेवत आहे..."
                  : "Remembering face..."}
          </Text>
        </View>
      )}

      {mode === "reading" && (
        <View style={styles.readingOverlay} pointerEvents="none">
          <Text style={styles.readingIcon}>🔍</Text>
          <Text style={styles.readingText}>{language === "hi" ? "पहचान रही हूं..." : language === "mr" ? "ओळखत आहे..." : "Identifying & reading..."}</Text>
          <Text style={styles.readingSubtext}>{language === "hi" ? "दवा • मेनू • दस्तावेज़ • पैसे" : language === "mr" ? "औषध • मेनू • दस्तावेज • पैसे" : "medicine • menu • document • currency"}</Text>
        </View>
      )}

      {mode === "thinking" && (
        <View style={styles.thinkingOverlay} pointerEvents="none">
          <Text style={styles.thinkingIcon}>💭</Text>
          <Text style={styles.thinkingText}>{language === "hi" ? "सोच रही हूं..." : language === "mr" ? "विचार करत आहे..." : "Thinking..."}</Text>
          {isConversationMode && conversationHistoryRef.current.length > 0 && (
            <Text style={styles.memoryIndicator}>
              {language === "hi"
                ? `💾 ${Math.floor(conversationHistoryRef.current.length / 2)} बातें याद`
                : language === "mr"
                  ? `💾 ${Math.floor(conversationHistoryRef.current.length / 2)} गोष्टी लक्षात`
                  : `💾 ${Math.floor(conversationHistoryRef.current.length / 2)} turns remembered`}
            </Text>
          )}
        </View>
      )}

      {mode === "listening" && (
        <View style={styles.listeningOverlay} pointerEvents="none">
          <Text style={styles.listeningIcon}>🎤</Text>
          <Text style={styles.listeningText}>{language === "hi" ? "बोलिए..." : language === "mr" ? "बोला..." : "Speak now..."}</Text>
        </View>
      )}

      <View
        style={[
          styles.topBar,
          isHazardAlert && styles.hazardBar,
          !isOnline && styles.offlineBar,
          mode === "walkwithme" && {
            backgroundColor: wwmBgColor,
            borderWidth: 1.5,
            borderColor: wwmBorderColor,
          },
        ]}
        pointerEvents="none"
      >
        <View style={styles.topBarBrand}>
          <Image
            source={SENTIA_LOGO}
            style={styles.sentiaLogo}
            resizeMode="contain"
          />

          <View style={styles.brandTextGroup}>
            <Text style={styles.topBarBrandText}>SENTIA</Text>
            <Text style={styles.topBarMiniText}>AI VISION</Text>
          </View>
        </View>

        <View style={styles.topBarDivider} />

        <Text style={styles.topBarText}>{getStatusLabel()}</Text>
      </View>

      {mode !== "walkwithme" && (
        <View
          style={[styles.descBox, isHazardAlert && styles.hazardDescBox]}
          pointerEvents="none"
        >
          <View style={styles.aiInsightHeader}>
            <View style={styles.aiInsightDot} />
            <Text style={styles.aiInsightLabel}>
              {isLoading ? "ANALYZING" : "SENTIA AI"}
            </Text>
          </View>

          <View style={styles.aiInsightDivider} />

          {isLoading && (
            <ActivityIndicator
              color="#7C6CFF"
              size="small"
              style={{ marginBottom: 10 }}
            />
          )}

          <Text style={styles.descText}>
            {description || WELCOME[language]}
          </Text>
        </View>
      )}

      <View style={styles.gestureGuide} pointerEvents="none">
        <Text style={styles.gestureText}>{getGestureGuide()}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[
            styles.micBtn,
            mode === "listening" && styles.micBtnActive,
            isConversationMode && styles.micBtnConversation,
            mode === "walkwithme" && styles.micBtnWwm,
          ]}
          onLongPress={handleVoiceLongPress}
          delayLongPress={LONG_PRESS_DELAY}
          onPress={handleVoiceTap}
        >
          <Ionicons
            name={
              mode === "walkwithme"
                ? "walk"
                : isConversationMode
                  ? "volume-high"
                  : "mic" 
            }
            size={32}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.langSwitchBtn}
          onPress={async () => {
            isScanningRef.current = false;
            setIsScanning(false);
            if (isWalkWithMeRef.current) stopWalkWithMe(true);
            Speech.stop();
            clearConversationHistory();
            await AsyncStorage.removeItem("sentia_lang");
            setLanguage(null);
            setMode("idle");
            currentModeRef.current = "idle";
          }}
        >
          <Text style={styles.langSwitchText}>🌐 Language</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  hazardContainer: { backgroundColor: "#1a0000" },
  fullScreen: { flex: 1 },
  camera: { flex: 1 },
  sentiaLogo: {
  width: 36,
  height: 36,
  marginRight: 10,
  },
  topBar: {
  position: "absolute",
  top: 24,
  left: 18,
  right: 18,
  backgroundColor: "rgba(8, 10, 24, 0.90)",
  borderRadius: 22,
  paddingVertical: 10,
  paddingHorizontal: 18,
  alignItems: "center",
  borderWidth: 1,
  borderColor: "rgba(124, 108, 255, 0.38)",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 7 },
  shadowOpacity: 0.4,
  shadowRadius: 16,
  elevation: 10,
  },

  topBarBrand: {
  flexDirection: "row",
  alignItems: "center",
  alignSelf: "flex-start",
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#35E0B5",
    marginRight: 8,
    shadowColor: "#35E0B5",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },

  brandTextGroup: {
  alignItems: "flex-start",
  justifyContent: "center",
  },

  topBarBrandText: {
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "900",
  letterSpacing: 1.8,
  },

  topBarMiniText: {
    color: "rgba(180, 170, 255, 0.75)",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: 1,
  },

  topBarDivider: {
    width: "100%",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 9,
  },
  hazardBar: { backgroundColor: "rgba(176,0,32,0.9)" },
  offlineBar: { backgroundColor: "rgba(60,60,60,0.9)" },
  topBarText: {
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: "800",
  letterSpacing: 0.8,
  },
  descBox: {
  position: "absolute",
  bottom: 180,
  left: 18,
  right: 18,
  backgroundColor: "rgba(8, 10, 24, 0.92)",
  borderRadius: 24,
  paddingVertical: 16,
  paddingHorizontal: 18,
  alignItems: "center",
  borderWidth: 1,
  borderColor: "rgba(124, 108, 255, 0.38)",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.45,
  shadowRadius: 20,
  elevation: 12,
  },
  hazardDescBox: {
  backgroundColor: "rgba(95, 5, 20, 0.94)",
  borderWidth: 2,
  borderColor: "#FF4D67",
  shadowColor: "#FF304F",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.65,
  shadowRadius: 18,
  elevation: 14,
  },
  aiInsightHeader: {
  width: "100%",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
},

aiInsightDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: "#7C6CFF",
  marginRight: 7,
  shadowColor: "#7C6CFF",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.9,
  shadowRadius: 6,
},

aiInsightLabel: {
  color: "rgba(255,255,255,0.70)",
  fontSize: 11,
  fontWeight: "900",
  letterSpacing: 2,
},

aiInsightDivider: {
  width: "100%",
  height: 1,
  backgroundColor: "rgba(255,255,255,0.07)",
  marginTop: 10,
  marginBottom: 12,
},

descText: {
  color: "#F7F7FF",
  fontSize: 16,
  lineHeight: 25,
  fontWeight: "600",
  textAlign: "center",
  letterSpacing: 0.2,
},

gestureGuide: {
  position: "absolute",
  bottom: 116,
  left: 24,
  right: 24,
  alignItems: "center",
},

gestureText: {
  color: "rgba(255,255,255,0.72)",
  fontSize: 11,
  fontWeight: "700",
  textAlign: "center",
  letterSpacing: 0.4,
  lineHeight: 18,
  paddingHorizontal: 12,
},

  controls: {
  position: "absolute",
  bottom: 18,
  left: 16,
  right: 16,
  height: 92,
  paddingHorizontal: 18,
  paddingVertical: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  backgroundColor: "rgba(10, 12, 28, 0.92)",
  borderRadius: 30,
  borderWidth: 1,
  borderColor: "rgba(124, 108, 255, 0.42)",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.52,
  shadowRadius: 22,
  elevation: 12,
  },
  micBtn: {
  width: 72,
  height: 72,
  borderRadius: 36,
  backgroundColor: "rgba(98, 0, 238, 0.88)",
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 2,
  borderColor: "rgba(180, 160, 255, 0.9)",
  shadowColor: "#7C6CFF",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.68,
  shadowRadius: 19,
  elevation: 12,
  },

  micBtnActive: {
    backgroundColor: "rgba(176, 0, 32, 0.95)",
    borderColor: "#FF6B7D",
    shadowColor: "#FF304F",
    shadowOpacity: 0.75,
    shadowRadius: 20,
    elevation: 16,
  },

  micBtnConversation: {
    backgroundColor: "rgba(0, 150, 100, 0.92)",
    borderColor: "#5CFFD0",
    borderWidth: 2,
    shadowColor: "#00DFA2",
    shadowOpacity: 0.65,
    shadowRadius: 18,
    elevation: 14,
  },

  micBtnWwm: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: "rgba(0, 170, 90, 0.94)",
    borderColor: "#7CFFB2",
    borderWidth: 3,
    shadowColor: "#00E676",
    shadowOpacity: 0.8,
    shadowRadius: 22,
    elevation: 18,
  },

micBtnText: {
  fontSize: 26,
},
  langSwitchBtn: {
    minWidth: 108,
    height: 56,
    paddingHorizontal: 18,
    backgroundColor: "rgba(10, 12, 28, 0.88)",
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(124, 108, 255, 0.48)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },

  langSwitchText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  wwmOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 32,
  },
  wwmIcon: { fontSize: 72, marginBottom: 4 },
  wwmTitle: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  wwmUrgencyLabel: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 3, opacity: 0.85 },
  wwmDescription: { color: "#fff", fontSize: 20, fontWeight: "600", textAlign: "center", lineHeight: 30, marginTop: 8 },
  wwmStepBadge: {
    marginTop: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  wwmStepText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  wwmHint: { position: "absolute", bottom: 110, color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center" },
  savingFaceOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(98,0,238,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  savingFaceIcon: { fontSize: 80, marginBottom: 20 },
  savingFaceText: { color: "#fff", fontSize: 24, fontWeight: "700", textAlign: "center" },
  readingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  readingIcon: { fontSize: 64, marginBottom: 8 },
  readingText: { color: "#fff", fontSize: 20, fontWeight: "600", textAlign: "center" },
  readingSubtext: { color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center", letterSpacing: 1 },
  thinkingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,10,40,0.6)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  thinkingIcon: { fontSize: 64, marginBottom: 8 },
  thinkingText: { color: "#fff", fontSize: 20, fontWeight: "600", textAlign: "center" },
  memoryIndicator: { color: "rgba(0,200,120,0.8)", fontSize: 13, textAlign: "center", marginTop: 4 },
  listeningOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  listeningIcon: { fontSize: 72 },
  listeningText: { color: "#fff", fontSize: 22, fontWeight: "600", textAlign: "center" },
  settingsScreen: { flex: 1, backgroundColor: "#0a0a1a" },
  settingsScrollContent: { alignItems: "center", padding: 32, gap: 20, paddingBottom: 60, flexGrow: 1, justifyContent: "center" },
  settingsTitle: { fontSize: 64 },
  settingsHeading: { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: 2 },
  voiceIndicator: {
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    borderWidth: 2,
    borderColor: "#6200EE",
    gap: 8,
  },
  voiceIndicatorText: { fontSize: 48 },
  voiceIndicatorLabel: { color: "#6200EE", fontSize: 18, fontWeight: "700" },
  facesCountBox: { width: "100%", backgroundColor: "#111122", borderRadius: 16, padding: 16, alignItems: "center" },
  facesCountText: { color: "#fff", fontSize: 14, textAlign: "center", lineHeight: 22 },
  guardianBox: {
      width: "100%",
      backgroundColor: "#111122",
      borderRadius: 16,
      padding: 16,
      gap: 10,
      borderWidth: 1,
      borderColor: "#6200EE",
    },
    guardianHeading: { color: "#6200EE", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
    guardianRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: "#1a1a2e",
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    guardianName: { color: "#fff", fontSize: 16, fontWeight: "700" },
    guardianPhone: { color: "rgba(255,255,255,0.65)", fontSize: 15, fontWeight: "500" },
    guardianEmpty: { color: "#aaa", fontSize: 14, textAlign: "center" },
  settingsInstructions: { width: "100%", backgroundColor: "#111122", borderRadius: 16, padding: 20, gap: 12 },
  settingsInstructionText: { color: "rgba(255,255,255,0.7)", fontSize: 15, lineHeight: 24 },
  facesListBox: { width: "100%", backgroundColor: "#111122", borderRadius: 16, padding: 16, gap: 12 },
  faceItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, backgroundColor: "#1a1a2e", borderRadius: 10 },
  faceNumber: { color: "#6200EE", fontSize: 20, fontWeight: "800", width: 32 },
  faceName: { color: "#fff", fontSize: 18, fontWeight: "600" },
  noFacesText: { color: "#aaa", fontSize: 16, textAlign: "center" },
  deleteConfirmBox: {
    width: "100%",
    backgroundColor: "#1a0a0a",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 16,
    borderWidth: 2,
    borderColor: "#ff4444",
  },
  deleteConfirmName: { color: "#fff", fontSize: 24, fontWeight: "700" },
  deleteConfirmInstructions: { color: "rgba(255,255,255,0.7)", fontSize: 16, textAlign: "center", lineHeight: 28 },
  langScreen: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  appName: { color: "#fff", fontSize: 52, fontWeight: "800", letterSpacing: 3 },
  tagline: { color: "#6200EE", fontSize: 16, fontWeight: "600" },
  chooseText: { color: "#aaa", fontSize: 15, textAlign: "center", marginBottom: 8 },
  langButton: { width: "100%", backgroundColor: "#1a1a2e", borderRadius: 18, padding: 22, alignItems: "center", borderWidth: 1.5, borderColor: "#6200EE" },
  langButtonText: { color: "#fff", fontSize: 26, fontWeight: "700" },
  privacyBox: {
    width: "100%",
    backgroundColor: "#111122",
    borderRadius: 16,
    padding: 20,
    gap: 4,
    borderWidth: 1,
    borderColor: "#6200EE",
    maxHeight: 380,
    overflow: "scroll" as any,
  },
  privacyHeading: { color: "#6200EE", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  privacyText: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 20 },
  privacyBold: { color: "#fff", fontWeight: "700" } as any,
  privacyAcceptBtn: {
    width: "100%",
    backgroundColor: "#6200EE",
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    marginTop: 8,
  },
  privacyAcceptText: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  privacyFooter: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
  }
});