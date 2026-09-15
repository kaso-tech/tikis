import { Platform } from "react-native";

const NativeDeliveryRouteMap = Platform.OS === "web" ? null : require("./delivery-route-map.native").DeliveryRouteMap;
const WebDeliveryRouteMap = Platform.OS === "web" ? require("./delivery-route-map.web").DeliveryRouteMap : null;
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };
type DriverPosition = { latitude: number; longitude: number; heading?: number | null };

export function DeliveryRouteMap({ pickup, dropoff, coordinates, routeSource, driverPosition }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[]; routeSource?: "routes" | "provisional"; driverPosition?: DriverPosition | null }) {
  const RouteMap = Platform.OS === "web" ? WebDeliveryRouteMap : NativeDeliveryRouteMap;
  if (!RouteMap) return null;
  return <RouteMap pickup={pickup} dropoff={dropoff} coordinates={coordinates} routeSource={routeSource} driverPosition={driverPosition} />;
}
