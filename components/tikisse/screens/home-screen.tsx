import { Platform } from "react-native";

export const HomeScreen = Platform.OS === "web"
  // The native map is intentionally loaded only in a native bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require("./home-screen.web").HomeScreen
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  : require("./home-screen.native").HomeScreen;
