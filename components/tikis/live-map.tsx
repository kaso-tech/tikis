import { Platform } from "react-native";
import { LiveMap as NativeLiveMap } from "./live-map.native";
import { LiveMap as WebLiveMap } from "./live-map.web";
import type { TrackingEvent } from "@/lib/gps-simulator";
import type { LocationLabel } from "@/shared/tikis-domain";

export function LiveMap({ deliveryId, driverName, pickup, dropoff, driverTracksLive, onTrackingEvent }: { deliveryId: string; driverName: string; pickup: LocationLabel; dropoff: LocationLabel; driverTracksLive: boolean; onTrackingEvent?: (event: TrackingEvent) => void }) {
  return Platform.OS === "web" ? <WebLiveMap deliveryId={deliveryId} driverName={driverName} onTrackingEvent={onTrackingEvent} /> : <NativeLiveMap deliveryId={deliveryId} driverName={driverName} pickup={pickup} dropoff={dropoff} driverTracksLive={driverTracksLive} onTrackingEvent={onTrackingEvent} />;
}
