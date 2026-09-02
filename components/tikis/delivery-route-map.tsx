import { Platform } from "react-native";
import { DeliveryRouteMap as NativeDeliveryRouteMap } from "./delivery-route-map.native";
import { DeliveryRouteMap as WebDeliveryRouteMap } from "./delivery-route-map.web";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };
type DriverPosition = { latitude: number; longitude: number; heading?: number | null };

export function DeliveryRouteMap({ pickup, dropoff, coordinates, routeSource, driverPosition }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[]; routeSource?: "routes" | "provisional"; driverPosition?: DriverPosition | null }) {
  return Platform.OS === "web" ? (
    <WebDeliveryRouteMap pickup={pickup} dropoff={dropoff} coordinates={coordinates} routeSource={routeSource} driverPosition={driverPosition} />
  ) : (
    <NativeDeliveryRouteMap pickup={pickup} dropoff={dropoff} coordinates={coordinates} routeSource={routeSource} driverPosition={driverPosition} />
  );
}
