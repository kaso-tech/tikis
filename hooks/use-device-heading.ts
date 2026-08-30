import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

export function useDeviceHeading(enabled: boolean) {
  const [heading, setHeading] = useState<number | null>(null);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!enabled || Platform.OS === "web") {
      setHeading(null);
      return;
    }
    let cancelled = false;
    void Location.watchHeadingAsync(
      (reading) => {
        const nextHeading = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
        if (!cancelled && Number.isFinite(nextHeading)) setHeading(nextHeading);
      },
      () => {
        if (!cancelled) setHeading(null);
      },
    ).then((nextSubscription) => {
      if (cancelled) nextSubscription.remove();
      else subscription.current = nextSubscription;
    }).catch(() => {
      if (!cancelled) setHeading(null);
    });
    return () => {
      cancelled = true;
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [enabled]);

  return heading;
}
