import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import * as ImageManipulator from "expo-image-manipulator";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import { Accelerometer, Barometer, Gyroscope, Magnetometer, Pedometer } from "expo-sensors";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  PanResponder,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import {
  BARO_INDOOR_THRESHOLD_HPA,
  BARO_OUTDOOR_THRESHOLD_HPA,
  BARO_SAMPLE_WINDOW_MS,
  BARO_WARN_COOLDOWN_MS,
  DOUBLE_SHAKE_WINDOW_MS,
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
  CLASSIFY_PROMPT,
  getConversationPrompt,
  getFaceDescPrompt,
  getScanPrompt,
  READ_PROMPTS,
} from "./prompts";
import { intentRouter } from "./services/intentRouter";
import { navigationService } from "./services/navigationService";

import type { AppMode, ConvMessage, LangKey, OcrType, SavedFace, WwmUrgency } from "./types";
import {
  detectCurrencyByColor,
  detectOcrHint,
  isHallucination,
  isHazard,
  isVisualQuestion,
  isWalkWithMeRequest,
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

const GOOGLE_MAPS_EXPO_KEY: string =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_EXPO_KEY ?? "";

const GOOGLE_MAPS_EAS_KEY: string =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_EAS_KEY ?? "";
const USE_EAS_GOOGLE_MAPS_KEY: boolean =
  Constants.expoConfig?.extra?.useEasGoogleMapsKey === true;

const GOOGLE_MAPS_KEY: string = USE_EAS_GOOGLE_MAPS_KEY
  ? GOOGLE_MAPS_EAS_KEY
  : GOOGLE_MAPS_EXPO_KEY;

const GROQ_KEY: string = process.env.EXPO_PUBLIC_GROQ_KEY ?? "";
const OPENROUTER_KEY: string = process.env.EXPO_PUBLIC_OPENROUTER_KEY ?? "";
const ROBOFLOW_API_KEY: string = Constants.expoConfig?.extra?.roboflowApiKey ?? "";
const ROBOFLOW_MODEL_ID: string = Constants.expoConfig?.extra?.roboflowModelId ?? "";

const playEarcon = async () => {
  Vibration.vibrate(30);
};

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
  const [isSavingFace, setIsSavingFace] = useState(false);
  const [faceToDelete, setFaceToDelete] = useState<SavedFace | null>(null);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isWalkWithMe, setIsWalkWithMe] = useState(false);
  const [wwmStatus, setWwmStatus] = useState<WwmUrgency>("CLEAR");
  const [wwmStepCount, setWwmStepCount] = useState(0);
  const [privacyConsented, setPrivacyConsented] = useState<boolean | null>(null);

  const alwaysListeningRef = useRef(false);
const wakeDetectedRef = useRef(false);
const voiceCommandBusyRef = useRef(false);
const speechRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cameraRef = useRef<CameraView>(null);
  const isScanningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastTapTimeRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const sosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emergencyContactRef = useRef<string | null>(null);
  const lastShakeForSosRef = useRef(0);
  const cameraReadyRef = useRef(false);
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
        return false;
      },
    }),
  ).current;

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
  if (!alwaysListeningRef.current || voiceCommandBusyRef.current) return;

  const text = event.results[0]?.transcript?.trim() ?? "";
  if (!text) return;

  setStatus(`Heard: ${text}`);

  if (event.isFinal) {
    handleExpoVoiceCommand(text);
  }
});
useSpeechRecognitionEvent("end", () => {
  restartExpoSpeechRecognitionSoon();
});

useSpeechRecognitionEvent("error", (event) => {
  if (event.error === "aborted") return;

  console.warn("Speech recognition error:", event.error, event.message);
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

    Audio.requestPermissionsAsync().then(({ granted }) => setAudioPermission(granted));

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

      if (isWalkWithMeRef.current && wwmUseAccelStepsRef.current) {
        const motionPulse = dx + dy + dz;
        if (motionPulse > 0.42 && now - lastAccelStepTimeRef.current > 350) {
          lastAccelStepTimeRef.current = now;
          wwmStepCountRef.current += 1;
          setWwmStepCount(wwmStepCountRef.current);
        }
      }

      const isRealShake = dx > 1.2 && dy > 1.0 && dz > 0.8;
      const totalAcc = dx + dy + dz;

      if (isRealShake && totalAcc > SHAKE_THRESHOLD && now - lastShakeTimeRef.current > SHAKE_COOLDOWN_MS) {
        lastShakeTimeRef.current = now;
        if (now - lastShakeForSosRef.current < DOUBLE_SHAKE_WINDOW_MS) {
          lastShakeForSosRef.current = 0;
          triggerSOS();
          return;
        }
        lastShakeForSosRef.current = now;
        const currentMode = currentModeRef.current;
        if (currentMode === "sos") {
          cancelSOS();
          return;
        }
        if (currentMode === "walkwithme") {
          stopWalkWithMe();
          return;
        }
        if (currentMode === "facemanage" || currentMode === "facedeleteconfirm") {
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

  const triggerSOS = () => {
    const lang = langRef.current ?? "en";
    if (isWalkWithMeRef.current) stopWalkWithMe(true);
    setMode("sos");
    currentModeRef.current = "sos";
    Vibration.vibrate([0, 300, 200, 300, 200, 300]);
    speak(D("sos_warning", lang), lang);
    sosTimerRef.current = setTimeout(() => {
      const contact = emergencyContactRef.current;
      Linking.openURL(contact ? `tel:${contact}` : "tel:112");
      setMode("idle");
      currentModeRef.current = "idle";
    }, 5000);
  };

  const cancelSOS = () => {
    if (sosTimerRef.current) {
      clearTimeout(sosTimerRef.current);
      sosTimerRef.current = null;
    }
    const lang = langRef.current ?? "en";
    setMode("idle");
    currentModeRef.current = "idle";
    speak(D("sos_cancelled", lang), lang);
  };

  const setSosContact = async () => {
    const lang = langRef.current ?? "en";
    speak(D("sos_set_prompt", lang), lang);
    await new Promise((resolve) => setTimeout(resolve, 2800));
    try {
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      await new Promise((resolve) => setTimeout(resolve, LISTEN_DURATION_MS[lang] ?? 7000));
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;
      const uri = recording.getURI();
      if (!uri) {
        speak(D("sos_set_failed", lang), lang);
        return;
      }
      const formData = new FormData();
      formData.append("file", { uri, type: "audio/m4a", name: "sos.m4a" } as any);
      formData.append("model", "whisper-large-v3");
      formData.append("language", "en");
      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}` },
        body: formData,
      });
      const data = await response.json();
      const spoken = (data?.text ?? "").trim();
      const digits = spoken.replace(/\D/g, "");
      if (digits.length < 6) {
        speak(D("sos_set_failed", lang), lang);
        return;
      }
      emergencyContactRef.current = digits;
      await AsyncStorage.setItem("sentia_emergency", digits);
      const message = D("sos_set_saved", lang).replace("{number}", digits.split("").join(" "));
      speak(message, lang);
    } catch {
      speak(D("sos_set_failed", lang), lang);
    }
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

  const speakAndThen = (text: string, lang: LangKey, onFinished: () => void, urgent = false) => {
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
          if (isConversationModeRef.current && convActiveAtCall) onFinished();
        },
        onError: () => {
          isSpeakingRef.current = false;
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
    if (isScanningRef.current) setTimeout(() => runScanCycleRef.current(), SCAN_INTERVAL_MS);
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
      if (!result || result === D("fallback", lang)) return;
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
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
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

  const callVisionAI = async (base64: string, lang: LangKey, prompt: string, maxTokens: number): Promise<string> => {
    const imageData = `data:image/jpeg;base64,${base64}`;

    if (USE_DIRECT && !GROQ_KEY && !OPENROUTER_KEY) {
      const errMsg = D("no_api_key", lang);
      setStatus("❌ No API keys — check app.config.js");
      speak(errMsg, lang);
      return "";
    }

    try {
      setStatus("Calling Groq...");
      const data = await groqRequest({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        max_tokens: maxTokens,
        temperature: 0.25,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
      });
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= MIN_VALID_RESPONSE_LENGTH) {
        setStatus("Groq ✓");
        return text;
      }
      setStatus("Groq response too short — trying OpenRouter...");
    } catch (error: any) {
      console.log("Groq failed:", error?.message);
      setStatus("Groq failed — trying OpenRouter...");
    }

    try {
      setStatus("Calling OpenRouter...");
      const data = await openRouterRequest({
        model: "google/gemini-2.5-pro",
        max_tokens: maxTokens,
        temperature: 0.25,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
      });
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= MIN_VALID_RESPONSE_LENGTH) {
        setStatus("OpenRouter ✓");
        return text;
      }
    } catch (error: any) {
      console.log("OpenRouter failed:", error?.message);
    }

    setStatus("Offline");
    return "";
  };

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

  const answerConversationally = async (question: string, onComplete?: () => void) => {
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
      if (onComplete) speakAndThen(answer, lang, onComplete);
      else speak(answer, lang);
    } catch (error: any) {
      setStatus(`Error: ${error?.message}`);
      setIsLoading(false);
      setMode("idle");
      currentModeRef.current = "idle";
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
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 8000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 6000,
      },
    });
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

const restartExpoSpeechRecognitionSoon = (delay = 800) => {
  if (!alwaysListeningRef.current || voiceCommandBusyRef.current) return;
  if (speechRestartTimerRef.current) clearTimeout(speechRestartTimerRef.current);

  speechRestartTimerRef.current = setTimeout(() => {
    speechRestartTimerRef.current = null;
    if (alwaysListeningRef.current && !voiceCommandBusyRef.current) {
      startExpoSpeechRecognition();
    }
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
      });
      return;
    }

    answerConversationally(command, () => {
      voiceCommandBusyRef.current = false;
      setMode("idle");
      currentModeRef.current = "idle";
      restartExpoSpeechRecognitionSoon();
    });
  } catch (error) {
    console.warn("Voice command failed:", error);
    speakAndThen("Sorry, I could not complete that voice command.", lang, () => {
      voiceCommandBusyRef.current = false;
      setMode("idle");
      currentModeRef.current = "idle";
      restartExpoSpeechRecognitionSoon();
    });
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
                speak(D("photo_now", lang), lang);
                const photo = await cameraRef.current!.takePictureAsync({ quality: 0.7, base64: true });
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
    if (mode === "sos") return "🆘 SOS — shake to cancel";
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
      <TouchableOpacity style={styles.settingsScreen} activeOpacity={1} onPress={handleSettingsTap}>
        <StatusBar barStyle="light-content" />
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
            <View style={styles.facesCountBox}>
              <Text style={styles.facesCountText}>
                🆘 SOS:{" "}
                {emergencyContactRef.current ??
                  (language === "hi" ? "नंबर नहीं — डायल 112" : language === "mr" ? "नंबर नाही — 112" : "Not set — will dial 112")}
              </Text>
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
      </TouchableOpacity>
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
    return (
      <View style={styles.langScreen}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.appName}>Sentia</Text>
        <Text style={styles.chooseText}>Camera permission is required</Text>
        <TouchableOpacity style={styles.langButton} onPress={requestPermission}>
          <Text style={styles.langButtonText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mode === "sos") {
    return (
      <View style={[styles.container, { backgroundColor: "#8b0000" }]}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24 }}>
          <Text style={{ fontSize: 80 }}>🆘</Text>
          <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", textAlign: "center" }}>SOS</Text>
          <Text style={{ color: "#ffaaaa", fontSize: 18, textAlign: "center", paddingHorizontal: 32 }}>
            Calling emergency contact in 5 seconds.{"\n"}Shake phone to cancel.
          </Text>
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
          mode === "walkwithme" && { backgroundColor: wwmBgColor, borderWidth: 1.5, borderColor: wwmBorderColor },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.topBarText}>{getStatusLabel()}</Text>
      </View>

      {mode !== "walkwithme" && (
        <View style={[styles.descBox, isHazardAlert && styles.hazardDescBox]} pointerEvents="none">
          {isLoading && <ActivityIndicator color="#fff" size="small" style={{ marginBottom: 8 }} />}
          <Text style={styles.descText}>{description || WELCOME[language]}</Text>
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
          <Text style={styles.micBtnText}>{mode === "walkwithme" ? "🚶" : isConversationMode ? "🔁" : "🎤"}</Text>
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
  topBar: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  hazardBar: { backgroundColor: "rgba(176,0,32,0.9)" },
  offlineBar: { backgroundColor: "rgba(60,60,60,0.9)" },
  topBarText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  descBox: {
    position: "absolute",
    bottom: 130,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
  },
  hazardDescBox: { backgroundColor: "rgba(176,0,32,0.9)", borderWidth: 2, borderColor: "#ff4444" },
  descText: { color: "#fff", fontSize: 18, lineHeight: 28, fontWeight: "500", textAlign: "center" },
  gestureGuide: { position: "absolute", bottom: 90, left: 16, right: 16, alignItems: "center" },
  gestureText: { color: "rgba(255,255,255,0.4)", fontSize: 11, textAlign: "center" },
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 24,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  micBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(98,0,238,0.5)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#6200EE",
  },
  micBtnActive: { backgroundColor: "rgba(176,0,32,0.8)", borderColor: "#ff4444" },
  micBtnConversation: { backgroundColor: "rgba(0,150,100,0.6)", borderColor: "#00c878", borderWidth: 3 },
  micBtnWwm: { backgroundColor: "rgba(0,180,80,0.5)", borderColor: "#00c850", borderWidth: 3, width: 68, height: 68, borderRadius: 34 },
  micBtnText: { fontSize: 26 },
  langSwitchBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20 },
  langSwitchText: { color: "#fff", fontSize: 14 },
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
  settingsScreen: { flex: 1, backgroundColor: "#0a0a1a", alignItems: "center", justifyContent: "center", padding: 32, gap: 20 },
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
  },
});
