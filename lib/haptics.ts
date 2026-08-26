import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

function onDevice(callback: () => Promise<void>) {
  if (Platform.OS !== "web") {
    void callback();
  }
}

export const haptic = {
  light: () => onDevice(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => onDevice(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => onDevice(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => onDevice(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  selection: () => onDevice(() => Haptics.selectionAsync()),
};

