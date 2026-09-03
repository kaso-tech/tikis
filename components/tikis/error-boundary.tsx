import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import { TikisButton } from "./ui";
import { logger } from "@/lib/logger";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallbackTitle?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

function buildSupportMailto(message: string) {
  const subject = encodeURIComponent("Tikis — Erreur bloquante rencontrée");
  const body = encodeURIComponent(`${message}\n\nPlateforme : ${Platform.OS}\nDate : ${new Date().toISOString()}`);
  return `mailto:support@tikis.app?subject=${subject}&body=${body}`;
}

export class TikisErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("error-boundary", "crash intercepté", { error, componentStack: info.componentStack });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.reset} fallbackTitle={this.props.fallbackTitle} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReset, fallbackTitle }: { error: Error; onReset: () => void; fallbackTitle?: string }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const showStack = __DEV__ && Platform.OS !== "web";
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>!</Text>
        </View>
        <Text style={styles.title}>{fallbackTitle ?? "L’application a rencontré un problème"}</Text>
        <Text style={styles.subtitle}>L’équipe technique a été notifiée. Vous pouvez revenir à l’accueil ou nous contacter avec le détail ci-dessous.</Text>
        <View style={styles.errorCard}>
          <Text style={styles.errorLabel}>Message</Text>
          <Text style={styles.errorMessage} numberOfLines={6}>{error.message}</Text>
        </View>
        {showStack && error.stack ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorLabel}>Stack technique</Text>
            <Text style={styles.stack} numberOfLines={20}>{error.stack}</Text>
          </View>
        ) : null}
        <TikisButton label="Revenir à l’accueil" onPress={onReset} variant="primary" />
        <View style={styles.contactRow}>
          <TikisButton label="Contacter le support" onPress={() => {
            if (Platform.OS === "web") {
              window.location.href = buildSupportMailto(error.message);
              return;
            }
            void Linking.openURL(buildSupportMailto(error.message)).catch(() => undefined);
          }} variant="ghost" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    scroll: { flexGrow: 1, padding: 24, gap: 16, justifyContent: "center" },
    iconCircle: { alignSelf: "center", width: 64, height: 64, borderRadius: 32, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
    iconText: { fontSize: 32, fontWeight: "600", color: theme.error },
    title: { fontSize: 20, fontWeight: "600", color: theme.foreground, textAlign: "center" },
    subtitle: { fontSize: 14, color: theme.muted, textAlign: "center", lineHeight: 20 },
    errorCard: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, gap: 6 },
    errorLabel: { fontSize: 11, fontWeight: "600", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5 },
    errorMessage: { fontSize: 14, color: theme.foreground, lineHeight: 20 },
    stack: { fontSize: 11, color: theme.muted, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), lineHeight: 16 },
    contactRow: { marginTop: 8 },
  });
}
