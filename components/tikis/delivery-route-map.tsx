import { Platform } from "react-native";
import { DeliveryRouteMap as NativeDeliveryRouteMap } from "./delivery-route-map.native";
import { DeliveryRouteMap as WebDeliveryRouteMap } from "./delivery-route-map.web";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };

export function DeliveryRouteMap({ pickup, dropoff, coordinates, routeSource }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[]; routeSource?: "routes" | "provisional" }) {
  return Platform.OS === "web" ? (
    <WebDeliveryRouteMap pickup={pickup} dropoff={dropoff} coordinates={coordinates} routeSource={routeSource} />
  ) : (
    <NativeDeliveryRouteMap pickup={pickup} dropoff={dropoff} coordinates={coordinates} routeSource={routeSource} />
  );
}
