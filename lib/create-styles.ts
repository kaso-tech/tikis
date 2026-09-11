import { StyleSheet, type ViewStyle, type TextStyle } from "react-native";
import type { ThemedColors } from "@/lib/use-theme-colors";

export function createStyles<T extends Record<string, ViewStyle | TextStyle>>(
  factory: (theme: ThemedColors) => T,
): (theme: ThemedColors) => T {
  return (theme: ThemedColors) => StyleSheet.create(factory(theme));
}
