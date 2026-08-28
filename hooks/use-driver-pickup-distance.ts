import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

import { geodesicDistanceKm } from "@/lib/geo-rules";

export type DriverLocationStatus = "idle" | "loading" | "ready" | "denied" | "unavailable";

export type DriverLocation = { latitude: number; longitude: number };

type State = {
  location: DriverLocation | null;
  status: DriverLocationStatus;
  error: string | null;
};

function isValid(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function formatDistance(km: number): { value: string; unit: "m" | "km" } {
  if (!Number.isFinite(km) || km <= 0) return { value: "—", unit: "km" };
  if (km < 1) {
    return { value: `${Math.max(50, Math.round(km * 1000))}`, unit: "m" };
  }
  if (km < 10) return { value: km.toFixed(1).replace(".", ","), unit: "km" };
  return { value: Math.round(km).toString(), unit: "km" };
}

export function formatPickupDistance(km: number) {
  return formatDistance(km);
}

export function useDriverPickupDistance(pickup: { latitude: number; longitude: number } | null | undefined) {
  const [state, setState] = useState<State>({ location: null, status: "idle", error: null });
  const isRequesting = useRef(false);

  const request = useCallback(async () => {
    if (isRequesting.current) return state.location;
    isRequesting.current = true;
    setState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setState({ location: null, status: "unavailable", error: "GPS désactivé" });
        return null;
      }
      const current = await Location.getForegroundPermissionsAsync();
      const permission = current.granted ? current : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setState({ location: null, status: "denied", error: "Permission refusée" });
        return null;
      }
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 300_000, requiredAccuracy: 1_000 });
      const reading = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!isValid(reading.coords.latitude, reading.coords.longitude)) {
        setState({ location: null, status: "unavailable", error: "Position invalide" });
        return null;
      }
      const next: DriverLocation = { latitude: reading.coords.latitude, longitude: reading.coords.longitude };
      setState({ location: next, status: "ready", error: null });
      return next;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Position indisponible";
      setState({ location: null, status: "unavailable", error: message });
      return null;
    } finally {
      isRequesting.current = false;
    }
  }, [state.location]);

  useEffect(() => {
    if (state.status === "idle") {
      void request();
    }
  }, [request, state.status]);

  const distanceKm = state.location && pickup ? geodesicDistanceKm(state.location, pickup) : null;
  const distance = distanceKm !== null ? formatDistance(distanceKm) : null;

  return { ...state, distance, distanceKm, request };
}
