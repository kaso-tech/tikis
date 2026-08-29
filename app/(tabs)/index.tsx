import { Platform } from "react-native";
import { HomeScreen as HomeScreenWeb } from "./index.web";
import { HomeScreen as HomeScreenNative } from "./index.native";

export default function HomeScreen() {
  return Platform.OS === "web" ? <HomeScreenWeb /> : <HomeScreenNative />;
}
