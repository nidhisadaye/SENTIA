import * as Location from "expo-location";

export type SentiaCoordinates = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
};

export type AddressResult = {
  addressLine: string;
  city?: string | null;
  region?: string | null;
  country?: string | null;
};

export class LocationService {
  private permissionGranted = false;

  async ensurePermission() {
    if (this.permissionGranted) return true;

    const foreground = await Location.requestForegroundPermissionsAsync();
    this.permissionGranted = foreground.status === Location.PermissionStatus.GRANTED;
    return this.permissionGranted;
  }

  async getCurrentCoordinates(): Promise<SentiaCoordinates> {
    const allowed = await this.ensurePermission();
    if (!allowed) throw new Error("Location permission is required for navigation.");

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading,
    };
  }

  async reverseGeocode(coords: SentiaCoordinates): Promise<AddressResult> {
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });

    const first = results[0];
    if (!first) {
      return {
        addressLine: `Latitude ${coords.latitude.toFixed(5)}, longitude ${coords.longitude.toFixed(5)}`,
      };
    }

    const parts = [first.name, first.street, first.district, first.city, first.region, first.postalCode]
      .filter(Boolean)
      .join(", ");

    return {
      addressLine: parts || `Latitude ${coords.latitude.toFixed(5)}, longitude ${coords.longitude.toFixed(5)}`,
      city: first.city,
      region: first.region,
      country: first.country,
    };
  }

  async watchLocation(onUpdate: (coords: SentiaCoordinates) => void, onError?: (error: Error) => void) {
    const allowed = await this.ensurePermission();
    if (!allowed) throw new Error("Location permission is required for navigation.");

    return Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 15,
        timeInterval: 5000,
      },
      (position) => {
        try {
          onUpdate({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
          });
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error("Location update failed."));
        }
      },
    );
  }
}

export const locationService = new LocationService();
