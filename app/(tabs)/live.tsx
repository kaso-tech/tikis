import { Platform } from "react-native";
import { LiveScreen as LiveScreenWeb } from "./live.web";
import { LiveScreen as LiveScreenNative } from "./live.native";

export default function LiveScreen() {
  return Platform.OS === "web" ? <LiveScreenWeb /> : <LiveScreenNative />;
}
