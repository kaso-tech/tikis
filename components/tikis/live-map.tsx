import { Platform } from "react-native";
import { LiveMap as NativeLiveMap } from "./live-map.native";
import { LiveMap as WebLiveMap } from "./live-map.web";
import type { TrackingEvent } from "@/lib/gps-simulator";

export function LiveMap({ deliveryId, driverName, onTrackingEvent }: { deliveryId: string; driverName: string; onTrackingEvent?: (event: TrackingEvent) => void }) {
  return Platform.OS === "web" ? <WebLiveMap deliveryId={deliveryId} driverName={driverName} onTrackingEvent={onTrackingEvent} /> : <NativeLiveMap deliveryId={deliveryId} driverName={driverName} onTrackingEvent={onTrackingEvent} />;
}
