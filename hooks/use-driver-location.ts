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

function formatDistance(km: number): { value: string; unit: "m" | "km" } {
  if (!Number.isFinite(km) || km <= 0) return { value: "—", unit: "km" };
  if (km < 1) {
    return { value: `${Math.max(50, Math.round(km * 1000))}`, unit: "m" };
  }
  if (km < 10) return { value: km.toFixed(1).replace(".", ","), unit: "km" };
  return { value: Math.round(km).toString(), unit: "km" };
}

export function useDriverLocation(options: { enabled?: boolean; intervalMs?: number } = {}) {
  const { enabled = true, intervalMs = 30_000 } = options;
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
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next: DriverLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setState({ location: next, status: "ready", error: null });
      return next;
    } catch (cause) {
      setState({ location: null, status: "unavailable", error: cause instanceof Error ? cause.message : "GPS indisponible" });
      return null;
    } finally {
      isRequesting.current = false;
    }
  }, [state.location]);

  useEffect(() => {
    if (!enabled) return;
    void request();
    const id = setInterval(() => { void request(); }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, request]);

  function distanceTo(pickup: { latitude: number; longitude: number } | null | undefined) {
    if (!state.location || !pickup) return null;
    const km = geodesicDistanceKm(state.location, pickup);
    return { ...formatDistance(km), km };
  }

  return { ...state, request, distanceTo };
}
