import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import type { DeliveryPosition } from "@/lib/supabase-tracking";

export type LiveLocationState = "idle" | "requesting" | "active" | "denied" | "unavailable" | "error";

export function useDeliveryLiveLocation(enabled: boolean, onPosition: (position: DeliveryPosition) => void) {
  const callbackRef = useRef(onPosition);
  const [position, setPosition] = useState<DeliveryPosition | null>(null);
  const [state, setState] = useState<LiveLocationState>("idle");

  useEffect(() => { callbackRef.current = onPosition; }, [onPosition]);

  useEffect(() => {
    if (!enabled) { setState("idle"); return; }
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const publish = (location: Location.LocationObject) => {
      const next = { latitude: location.coords.latitude, longitude: location.coords.longitude, heading: Number.isFinite(location.coords.heading) ? Math.max(0, location.coords.heading ?? 0) : 0, recordedAt: new Date(location.timestamp).toISOString() };
      if (!active) return;
      setPosition(next); setState("active"); callbackRef.current(next);
    };
    const begin = async () => {
      try {
        setState("requesting");
        if (!(await Location.hasServicesEnabledAsync())) { if (active) setState("unavailable"); return; }
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") { if (active) setState("denied"); return; }
        const recent = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 150 });
        if (recent) publish(recent);
        subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 8_000, distanceInterval: 10, mayShowUserSettingsDialog: true }, publish, () => { if (active) setState("error"); });
      } catch { if (active) setState("error"); }
    };
    void begin();
    return () => { active = false; subscription?.remove(); };
  }, [enabled]);

  return { position, state };
}
