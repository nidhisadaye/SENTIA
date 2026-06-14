import * as Location from "expo-location";
import type { NavigationIntent, SupportedLanguage } from "./intentRouter";
import { locationService, SentiaCoordinates } from "./locationService";
import { speechService } from "./speechService";

type RouteStep = {
  instruction: string;
  distanceMeters: number;
  end: SentiaCoordinates;
};

type ActiveRoute = {
  destination: string;
  steps: RouteStep[];
  currentStepIndex: number;
};

const placesLabels: Record<string, string> = {
  hospital: "hospital",
  pharmacy: "pharmacy",
  bus_stop: "bus stop",
  unknown: "place",
};

export class NavigationService {
  private activeRoute: ActiveRoute | null = null;
  private locationSubscription: Location.LocationSubscription | null = null;
  private lastAnnouncementAt = 0;
  private googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  configure(config: { googleMapsApiKey?: string }) {
    this.googleMapsApiKey = config.googleMapsApiKey ?? this.googleMapsApiKey;
  }

  async handleIntent(intent: NavigationIntent): Promise<string> {
    switch (intent.type) {
      case "WHERE_AM_I":
      case "CURRENT_LOCATION":
        return this.describeCurrentLocation(intent.language);
      case "NAVIGATE_TO":
      case "DIRECTIONS_TO":
        return this.startNavigation(intent.destination ?? "", intent.language);
      case "NEARBY_PLACE":
        return this.findNearby(intent.placeType ?? "unknown", intent.language);
      case "STOP_NAVIGATION":
        return this.stopNavigation(intent.language);
      default:
        return "Navigation command not recognized.";
    }
  }

  async describeCurrentLocation(language: SupportedLanguage) {
    const coords = await locationService.getCurrentCoordinates();
    const address = await locationService.reverseGeocode(coords);
    if (language === "hi") return `आप अभी ${address.addressLine} के पास हैं।`;
    if (language === "mr") return `तुम्ही सध्या ${address.addressLine} जवळ आहात.`;
    return `You are near ${address.addressLine}.`;
  }

  async startNavigation(destination: string, language: SupportedLanguage) {
    if (!destination.trim()) return this.localize("Please say the destination again.", language);

    const origin = await locationService.getCurrentCoordinates();
    const steps = await this.fetchRouteSteps(origin, destination);
    if (!steps.length) return this.localize("I could not find a route to that destination.", language);

    this.activeRoute = { destination, steps, currentStepIndex: 0 };
    await this.startLocationUpdates(language);

    const first = steps[0];
    return this.localize(
      `Starting navigation to ${destination}. In ${this.formatDistance(first.distanceMeters)}, ${first.instruction}`,
      language,
    );
  }

  async stopNavigation(language: SupportedLanguage) {
    this.activeRoute = null;
    this.locationSubscription?.remove();
    this.locationSubscription = null;
    return this.localize("Navigation stopped.", language);
  }

  async findNearby(placeType: string, language: SupportedLanguage) {
    const coords = await locationService.getCurrentCoordinates();
    const apiKey = this.googleMapsApiKey;
    if (!apiKey) {
      return this.localize(
        `Nearby ${placesLabels[placeType] ?? "place"} search needs a Google Maps API key.`,
        language,
      );
    }

    const url =
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json" +
      `?location=${coords.latitude},${coords.longitude}` +
      `&radius=2500&type=${encodeURIComponent(placeType)}&key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Nearby search failed: ${response.status}`);
    const json = await response.json();
    const place = json.results?.[0];

    if (!place) return this.localize(`I could not find a nearby ${placesLabels[placeType]}.`, language);

    const name = place.name;
    const placeCoords = place.geometry.location;
    const distance = this.distanceMeters(coords, {
      latitude: placeCoords.lat,
      longitude: placeCoords.lng,
    });

    return this.localize(`Nearest ${placesLabels[placeType]} is ${name}, about ${this.formatDistance(distance)} away.`, language);
  }

  private async startLocationUpdates(language: SupportedLanguage) {
    this.locationSubscription?.remove();
    this.locationSubscription = await locationService.watchLocation(
      (coords) => void this.onLocationUpdate(coords, language),
      () => void speechService.speak(this.localize("Location signal was interrupted. I am trying again.", language), language),
    );
  }

  private async onLocationUpdate(coords: SentiaCoordinates, language: SupportedLanguage) {
    if (!this.activeRoute) return;
    const step = this.activeRoute.steps[this.activeRoute.currentStepIndex];
    if (!step) {
      await speechService.speak(this.localize("You have arrived.", language), language);
      await this.stopNavigation(language);
      return;
    }

    const distance = this.distanceMeters(coords, step.end);
    if (distance < 30) {
      this.activeRoute.currentStepIndex += 1;
      const next = this.activeRoute.steps[this.activeRoute.currentStepIndex];
      await speechService.speak(next ? this.localize(`Next, ${next.instruction}`, language) : this.localize("You have arrived.", language), language);
      return;
    }

    const now = Date.now();
    if (now - this.lastAnnouncementAt > 30000) {
      this.lastAnnouncementAt = now;
      await speechService.speak(
        this.localize(`${this.formatDistance(distance)} to the next step. ${step.instruction}`, language),
        language,
      );
    }
  }

  private async fetchRouteSteps(origin: SentiaCoordinates, destination: string): Promise<RouteStep[]> {
    const apiKey = this.googleMapsApiKey;
    if (!apiKey) throw new Error("Google Maps API key is required for turn-by-turn directions.");

    const url =
      "https://maps.googleapis.com/maps/api/directions/json" +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&mode=walking&key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Directions failed: ${response.status}`);
    const json = await response.json();
    const apiSteps = json.routes?.[0]?.legs?.[0]?.steps ?? [];

    return apiSteps.map((step: any) => ({
      instruction: this.stripHtml(step.html_instructions),
      distanceMeters: step.distance?.value ?? 0,
      end: {
        latitude: step.end_location.lat,
        longitude: step.end_location.lng,
      },
    }));
  }

  private stripHtml(value: string) {
    return String(value ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "and")
      .replace(/\s+/g, " ")
      .trim();
  }

  private distanceMeters(a: SentiaCoordinates, b: SentiaCoordinates) {
    const radius = 6371000;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  private formatDistance(meters: number) {
    if (meters < 1000) return `${Math.round(meters)} meters`;
    return `${(meters / 1000).toFixed(1)} kilometers`;
  }

  private localize(text: string, _language: SupportedLanguage) {
    return text;
  }
}

export const navigationService = new NavigationService();
