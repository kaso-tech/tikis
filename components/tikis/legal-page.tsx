import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";

type LegalSection = { title: string; paragraphs: string[] };

export function LegalPage({ title, label, updatedAt, sections }: { title: string; label: string; updatedAt: string; sections: LegalSection[] }) {
  const { colors: theme } = useThemeColors();
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
    <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.background }, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color={theme.foreground} /></Pressable>
      <View><Text style={[styles.headerLabel, { color: theme.primary }]}>{label}</Text><Text style={[styles.headerTitle, { color: theme.foreground }]}>Tikis</Text></View>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={[styles.eyebrow, { color: theme.primary }]}>{label}</Text>
        <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
        <Text style={[styles.updated, { color: theme.muted }]}>Dernière mise à jour : {updatedAt}</Text>
      </View>
      <View style={[styles.notice, { backgroundColor: theme.surface }]}>
        <MaterialIcons name="verified-user" size={20} color={theme.primary} />
        <Text style={[styles.noticeText, { color: theme.muted }]}>Ce document définit les règles d’utilisation de la plateforme Tikis. Il est accessible à tout moment depuis l’inscription.</Text>
      </View>
      {sections.map((section, index) => <View key={section.title} style={styles.section}>
        <View style={[styles.sectionNumber, { backgroundColor: theme.foreground }]}><Text style={[styles.sectionNumberText, { color: theme.background }]}>{index + 1}</Text></View>
        <View style={styles.sectionBody}>
          <Text style={[styles.sectionTitle, { color: theme.foreground }]}>{section.title}</Text>
          {section.paragraphs.map((paragraph) => <Text key={paragraph} style={[styles.paragraph, { color: theme.muted }]}>{paragraph}</Text>)}
        </View>
      </View>)}
      <Text style={[styles.footer, { color: theme.muted, borderTopColor: theme.border }]}>Pour toute question concernant ce document, contactez l’assistance Tikis depuis votre espace profil.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { minHeight: 58, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" }, headerLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7 }, headerTitle: { fontSize: 16, fontWeight: "600", marginTop: 1 }, content: { padding: 16, paddingBottom: 36 }, hero: { paddingTop: 6, paddingBottom: 16 }, eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7, textTransform: "uppercase" }, title: { fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.35, marginTop: 6 }, updated: { fontSize: 12, marginTop: 7 }, notice: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 9, marginBottom: 18 }, noticeText: { flex: 1, fontSize: 12, lineHeight: 18 }, section: { flexDirection: "row", gap: 10, marginBottom: 19 }, sectionNumber: { width: 25, height: 25, borderRadius: 7, alignItems: "center", justifyContent: "center", marginTop: 1 }, sectionNumberText: { fontSize: 12, fontWeight: "600" }, sectionBody: { flex: 1 }, sectionTitle: { fontSize: 15, lineHeight: 21, fontWeight: "600", marginBottom: 6 }, paragraph: { fontSize: 13, lineHeight: 19, marginTop: 6 }, footer: { fontSize: 12, lineHeight: 18, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 2 }, pressed: { opacity: 0.67 },
});
