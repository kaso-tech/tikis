import { Platform } from "react-native";
import { LiveMap as NativeLiveMap } from "./live-map.native";
import { LiveMap as WebLiveMap } from "./live-map.web";

export function LiveMap({ driverName }: { driverName: string }) {
  return Platform.OS === "web" ? <WebLiveMap driverName={driverName} /> : <NativeLiveMap driverName={driverName} />;
}
