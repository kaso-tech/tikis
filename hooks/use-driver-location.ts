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

export function formatDistance(km: number): { value: string; unit: "m" | "km" } {
  if (!Number.isFinite(km) || km <= 0) return { value: "—", unit: "km" };
  if (km < 0.05) return { value: "< 50", unit: "m" };
  if (km < 1) return { value: `${Math.round(km * 1000)}`, unit: "m" };
  if (km < 10) return { value: km.toFixed(1).replace(".", ","), unit: "km" };
  if (km < 100) return { value: km.toFixed(1).replace(".", ","), unit: "km" };
  return { value: Math.round(km).toString(), unit: "km" };
}

export function useDriverLocation(options: { enabled?: boolean; minDisplacementMeters?: number } = {}) {
  const { enabled = true, minDisplacementMeters = 10 } = options;
  const [state, setState] = useState<State>({ location: null, status: "idle", error: null });
  const lastLocation = useRef<DriverLocation | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const applyPosition = useCallback((position: { coords: Location.LocationObjectCoords }) => {
    const next: DriverLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    if (lastLocation.current) {
      const movedMeters = geodesicDistanceKm(lastLocation.current, next) * 1000;
      if (movedMeters < minDisplacementMeters) return;
    }
    lastLocation.current = next;
    setState({ location: next, status: "ready", error: null });
  }, [minDisplacementMeters]);

  const requestOnce = useCallback(async () => {
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
      applyPosition(position);
      return position;
    } catch (cause) {
      setState({ location: null, status: "unavailable", error: cause instanceof Error ? cause.message : "GPS indisponible" });
      return null;
    }
  }, [applyPosition]);

  const startWatching = useCallback(async () => {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return;
    subscriptionRef.current?.remove();
    subscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: minDisplacementMeters },
      applyPosition,
    );
  }, [applyPosition, minDisplacementMeters]);

  useEffect(() => {
    if (!enabled) return;
    setState((current) => ({ ...current, status: "loading", error: null }));
    void (async () => {
      await requestOnce();
      await startWatching();
    })();
    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [enabled, requestOnce, startWatching]);

  function distanceTo(pickup: { latitude: number; longitude: number } | null | undefined) {
    if (!state.location || !pickup) return null;
    const km = geodesicDistanceKm(state.location, pickup);
    return { ...formatDistance(km), km };
  }

  return { ...state, request: requestOnce, distanceTo };
}
