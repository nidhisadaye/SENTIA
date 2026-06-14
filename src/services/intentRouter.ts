export type SupportedLanguage = "en" | "hi" | "mr";

export type NavigationIntentType =
  | "WHERE_AM_I"
  | "CURRENT_LOCATION"
  | "NAVIGATE_TO"
  | "DIRECTIONS_TO"
  | "NEARBY_PLACE"
  | "STOP_NAVIGATION";

export type ConversationIntent = {
  mode: "conversation";
  originalText: string;
  language: SupportedLanguage;
};

export type NavigationIntent = {
  mode: "navigation";
  type: NavigationIntentType;
  originalText: string;
  language: SupportedLanguage;
  destination?: string;
  placeType?: "hospital" | "pharmacy" | "bus_stop" | "unknown";
};

export type RoutedIntent = ConversationIntent | NavigationIntent;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const detectLanguage = (text: string): SupportedLanguage => {
  if (/[\u0900-\u097F]/.test(text)) {
    const marathiHints = ["कुठे", "आहे", "मला", "जवळ", "रस्ता", "दाखव"];
    return marathiHints.some((word) => text.includes(word)) ? "mr" : "hi";
  }
  return "en";
};

export class IntentRouter {
  route(rawText: string): RoutedIntent {
    const text = normalize(rawText);
    const language = detectLanguage(rawText);

    if (!text) {
      return { mode: "conversation", originalText: rawText, language };
    }

    if (this.isStopNavigation(text)) {
      return { mode: "navigation", type: "STOP_NAVIGATION", originalText: rawText, language };
    }

    if (this.isWhereAmI(text)) {
      return { mode: "navigation", type: "WHERE_AM_I", originalText: rawText, language };
    }

    if (this.isCurrentLocation(text)) {
      return { mode: "navigation", type: "CURRENT_LOCATION", originalText: rawText, language };
    }

    const nearbyType = this.extractNearbyPlace(text);
    if (nearbyType) {
      return {
        mode: "navigation",
        type: "NEARBY_PLACE",
        placeType: nearbyType,
        originalText: rawText,
        language,
      };
    }

    const destination = this.extractDestination(text);
    if (destination) {
      return {
        mode: "navigation",
        type: text.includes("direction") || text.includes("directions") ? "DIRECTIONS_TO" : "NAVIGATE_TO",
        destination,
        originalText: rawText,
        language,
      };
    }

    return { mode: "conversation", originalText: rawText, language };
  }

  private isWhereAmI(text: string) {
    return /\bwhere am i\b/.test(text) || text.includes("मैं कहाँ") || text.includes("मी कुठे");
  }

  private isCurrentLocation(text: string) {
    return (
      text.includes("current location") ||
      text.includes("my location") ||
      text.includes("मेरा स्थान") ||
      text.includes("माझे स्थान")
    );
  }

  private isStopNavigation(text: string) {
    return (
      text.includes("stop navigation") ||
      text.includes("cancel navigation") ||
      text.includes("end navigation") ||
      text.includes("navigation बंद") ||
      text.includes("नेव्हिगेशन बंद")
    );
  }

  private extractNearbyPlace(text: string): NavigationIntent["placeType"] | null {
    const nearby = text.includes("nearby") || text.includes("near me") || text.includes("जवळ") || text.includes("पास");
    if (!nearby) return null;
    if (text.includes("hospital") || text.includes("अस्पताल") || text.includes("रुग्णालय")) return "hospital";
    if (text.includes("pharmacy") || text.includes("medical") || text.includes("दवा") || text.includes("औषध")) return "pharmacy";
    if (text.includes("bus stop") || text.includes("बस")) return "bus_stop";
    return "unknown";
  }

  private extractDestination(text: string): string | null {
    const patterns = [
      /\bnavigate to\s+(.+)$/,
      /\bdirections to\s+(.+)$/,
      /\btake me to\s+(.+)$/,
      /\bguide me to\s+(.+)$/,
      /\bgo to\s+(.+)$/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }

    return null;
  }
}

export const intentRouter = new IntentRouter();
