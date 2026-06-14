import type { LangKey } from "./types";

export const LANGUAGES = {
  en: { label: "English", tts: "en-US" },
  hi: { label: "हिंदी", tts: "hi-IN" },
  mr: { label: "मराठी", tts: "mr-IN" },
} as const;

export const WELCOME: Record<LangKey, string> = {
  en: "Welcome to Sentia. Tap once to start scanning. Double tap to stop. Hold anywhere to read text. Hold the microphone button for conversation mode. Triple tap to save a face. Two finger tap to repeat the last message. Triple-tap the mic for Walk With Me navigation. Shake the phone to open settings.",
  hi: "Sentia में स्वागत है। एक बार टैप स्कैन। दो बार बंद। दबाएं पढ़ने के लिए। माइक दबाएं बातचीत के लिए। तीन बार टैप चेहरा याद करें। दो उंगली से पिछला संदेश। माइक तीन बार टैप Walk With Me चलना। सेटिंग्स के लिए हिलाएं।",
  mr: "Sentia मध्ये स्वागत. एकदा टॅप स्कॅन. दोनदा थांव. दाबा वाचण्यासाठी. मायक दाबा संभाषणासाठी. तीनदा टॅप चेहरा. दोन बोटांनी शेवटचा संदेश. मायक तीनदा Walk With Me. सेटिंग्जसाठी हलवा.",
};

export const LANG_SELECT_AUDIO =
  "Sentia. Choose your language. Tap the top button for English. Middle for Hindi. Bottom for Marathi.";
