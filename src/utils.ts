import type { OcrType, WwmUrgency } from "./types";

const HAZARD_PREFIXES = ["warning!", "danger!", "चेतावनी!", "सावधान!", "watch out!"];

const HALLUCINATION_PATTERNS = [
  /^(thank you|thanks|goodbye|bye|\.+|,+|\s*)$/i,
  /^(धन्यवाद|शुक्रिया|नमस्ते|नमस्कार|बहुत बहुत धन्यवाद)\.?$/i,
  /^(धन्यवाद|नमस्कार|बरं|खूप खूप धन्यवाद)\.?$/i,
];

export const WWM_ALWAYS_SPEAK_URGENCIES: WwmUrgency[] = ["STOP", "DANGER"];

export const parseWwmUrgency = (text: string): WwmUrgency => {
  if (/\[DANGER\]/i.test(text)) return "DANGER";
  if (/\[STOP\]/i.test(text)) return "STOP";
  if (/\[CAUTION\]/i.test(text)) return "CAUTION";
  if (/\b(danger|stop immediately|vehicle|deep pit|fire)\b/i.test(text)) return "DANGER";
  if (/\b(stop now|wall|pole|pillar|parked vehicle)\b/i.test(text)) return "STOP";
  if (/\b(caution|drain|step|person|animal|vendor|cyclist|chair|table)\b/i.test(text)) return "CAUTION";
  return "CLEAR";
};

export const stripWwmTag = (text: string): string =>
  text.replace(/\[(CLEAR|CAUTION|STOP|DANGER)\]\s*/i, "").trim();

export const normalizeWwmResponse = (text: string): string => {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) return "";
  if (/\[(CLEAR|CAUTION|STOP|DANGER)\]/i.test(cleaned)) return cleaned;

  const urgency = parseWwmUrgency(cleaned);
  return `[${urgency}] ${cleaned}`;
};

export const detectCurrencyByColor = async (_base64: string): Promise<string | null> => null;

export const isHazard = (text: string): boolean =>
  HAZARD_PREFIXES.some((prefix) => text.toLowerCase().trim().startsWith(prefix));

export const isDevanagari = (text: string): boolean => /[\u0900-\u097F]/.test(text);

export const isHallucination = (text: string): boolean => {
  const trimmed = text.trim();
  if (isDevanagari(trimmed)) {
    if (trimmed.length < 2) return true;
  } else if (trimmed.length < 3) {
    return true;
  }

  if (HALLUCINATION_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;

  const words = trimmed.split(/\s+/);
  if (words.length >= 3) {
    const unique = new Set(words.map((word) => word.toLowerCase()));
    if (unique.size === 1) return true;
  }
  return false;
};

export const isVisualQuestion = (question: string): boolean => {
  const lower = question.toLowerCase().trim();
  const keywords = [
    "what do you see", "what's in front", "what is in front", "what can you see",
    "look at", "describe what", "what am i", "who is this", "who is that",
    "what sign", "what text", "scan this", "show me", "tell me what",
    "in front of me", "around me", "near me", "beside me",
    "read this", "read that", "what does this say", "what does it say",
    "what medicine", "which medicine", "read the label", "read the bottle",
    "what tablet", "what pill", "read the menu", "what's on the menu",
    "read the form", "read the document", "read the id", "read the card",
    "read my aadhaar", "read the prescription", "what does the doctor",
    "read the bill", "read the receipt", "how much does", "what is the price",
    "read the book", "read this page", "what currency", "how much is this",
    "the text in front", "text in front", "text around", "the sign",
    "क्या दिख", "सामने क्या", "यह क्या", "कौन है", "पढ़ो", "देखो",
    "बताओ क्या", "आगे क्या", "पास में क्या",
    "यह दवा", "कौन सी दवा", "दवा पढ़ो", "लेबल पढ़ो", "मेनू पढ़ो",
    "फॉर्म पढ़ो", "पर्चा पढ़ो", "रसीद पढ़ो", "कितने का नोट",
    "सामने का टेक्स्ट", "सामने लिखा", "आगे का टेक्स्ट",
    "काय दिसत", "समोर काय", "हे काय", "कोण आहे", "वाचा", "पाहा",
    "सांगा काय", "पुढे काय",
    "हे औषध", "कोणते औषध", "लेबल वाचा", "मेनू वाचा",
    "फॉर्म वाचा", "चिठ्ठी वाचा", "पाकीट वाचा", "किती रुपये",
    "समोरचा मजकूर", "समोर काय लिहिले", "पुढचे वाचा",
  ];
  return keywords.some((keyword) => lower.includes(keyword));
};

export const isWalkWithMeRequest = (question: string): boolean => {
  const lower = question.toLowerCase().trim();
  const keywords = [
    "walk with me", "guide me", "help me walk", "start walking",
    "navigate", "lead me", "path mode", "walking mode",
    "चलो साथ", "रास्ता दिखाओ", "चलने में मदद", "नेविगेट",
    "मार्ग दाखवा", "चालायला मदत", "वाट दाखवा",
  ];
  return keywords.some((keyword) => lower.includes(keyword));
};

export const detectOcrHint = (question?: string): OcrType => {
  if (!question) return "general";
  const q = question.toLowerCase();
  if (q.match(/medicine|tablet|pill|capsule|syrup|दवा|दवाई|गोली|औषध|औषधी/)) return "medicine";
  if (q.match(/menu|restaurant|food|dish|खाना|मेनू|जेवण/)) return "menu";
  if (q.match(/prescription|doctor|rx|पर्चा|नुस्खा|चिठ्ठी|डॉक्टर/)) return "prescription";
  if (q.match(/aadhaar|pan card|passport|voter|license|आधार|पैन|मतदान|परवाना/)) return "govdoc";
  if (q.match(/note|currency|rupee|money|नोट|रुपये|पैसे|नाणे/)) return "currency";
  if (q.match(/form|application|document|फॉर्म|दस्तावेज़|कागज़|अर्ज/)) return "form";
  return "general";
};

export const headingToCardinal = (degrees: number): string => {
  const directions = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"];
  return directions[Math.round(degrees / 45) % 8];
};
