import * as Location from "expo-location";
import { useCallback, useRef, useState } from "react";

export type SearchLocationBias = { latitude: number; longitude: number };
export type SearchLocationStatus = "idle" | "loading" | "ready" | "unavailable";

function isValidBias(latitude: number, longitude: number): latitude is number {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

/** Demande une seule position de premier plan uniquement après une action explicite de l’utilisateur. */
export function useSearchLocationBias() {
  const [bias, setBias] = useState<SearchLocationBias | null>(null);
  const [status, setStatus] = useState<SearchLocationStatus>("idle");
  const isRequesting = useRef(false);

  const requestBias = useCallback(async () => {
    if (isRequesting.current) return bias;
    isRequesting.current = true;
    setStatus("loading");
    try {
      if (!await Location.hasServicesEnabledAsync()) {
        setStatus("unavailable");
        return null;
      }
      const currentPermission = await Location.getForegroundPermissionsAsync();
      const permission = currentPermission.granted ? currentPermission : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStatus("unavailable");
        return null;
      }
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 300_000, requiredAccuracy: 1_000 });
      const location = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!isValidBias(location.coords.latitude, location.coords.longitude)) {
        setStatus("unavailable");
        return null;
      }
      const nextBias = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      setBias(nextBias);
      setStatus("ready");
      return nextBias;
    } catch {
      setStatus("unavailable");
      return null;
    } finally {
      isRequesting.current = false;
    }
  }, [bias]);

  return { bias, status, requestBias };
}
