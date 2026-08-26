import { Platform } from "react-native";
import { LiveMap as NativeLiveMap } from "./live-map.native";
import { LiveMap as WebLiveMap } from "./live-map.web";
import type { TrackingEvent } from "@/lib/gps-simulator";

export function LiveMap({ driverName, onTrackingEvent }: { driverName: string; onTrackingEvent?: (event: TrackingEvent) => void }) {
  return Platform.OS === "web" ? <WebLiveMap driverName={driverName} onTrackingEvent={onTrackingEvent} /> : <NativeLiveMap driverName={driverName} onTrackingEvent={onTrackingEvent} />;
}
