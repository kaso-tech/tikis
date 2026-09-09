import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";

type FaqItem = { id: string; question: string; answer: string };

const FAQ: FaqItem[] = [
  {
    id: "create-delivery",
    question: "Comment créer une livraison ?",
    answer: "Depuis l'onglet Accueil, appuyez sur le bouton « Nouvelle livraison ». Renseignez l'adresse de collecte, l'adresse de destination, le type d'envoi, le véhicule souhaité et le prix offert. Validez pour publier la course : les livreurs compatibles peuvent ensuite candidater.",
  },
  {
    id: "track-driver",
    question: "Comment suivre mon livreur en temps réel ?",
    answer: "Quand un livreur accepte votre course, l'onglet Suivi affiche sa position GPS sur la carte. La mise à jour se fait toutes les 2 secondes tant que la livraison est en cours.",
  },
  {
    id: "payment",
    question: "Comment fonctionne le paiement ?",
    answer: "Le prix de la course est préautorisé sur votre Wallet Tikis au moment de la publication. La commission Tikis et la rémunération du livreur sont libérées à la confirmation de livraison.",
  },
  {
    id: "rating",
    question: "Pourquoi noter le livreur ?",
    answer: "Votre note (1 à 5 étoiles) alimente la réputation du livreur et l'aide à obtenir plus de courses. Vous pouvez aussi laisser un commentaire.",
  },
  {
    id: "cancel",
    question: "Puis-je annuler une livraison ?",
    answer: "Oui, depuis l'écran de la livraison tant qu'elle n'a pas été acceptée. Après acceptation, contactez le support : une annulation tardive peut entraîner des frais.",
  },
  {
    id: "delete-account",
    question: "Comment supprimer mon compte ?",
    answer: "Dans votre profil, section « Zone sensible », appuyez sur « Supprimer mon compte ». La suppression est différée de 30 jours, vous pouvez l'annuler pendant ce délai.",
  },
];

const CHANNELS = [
  {
    icon: "mail-outline" as const,
    label: "Email",
    value: "support@tikis.app",
    action: "mailto:support@tikis.app",
  },
  {
    icon: "chat-bubble-outline" as const,
    label: "WhatsApp",
    value: "+226 70 00 00 00",
    action: "https://wa.me/22670000000",
  },
  {
    icon: "phone" as const,
    label: "Téléphone",
    value: "Du lundi au samedi · 8h-20h",
    action: "tel:+22670000000",
  },
];

export default function HelpScreen() {
  const { colors: theme } = useThemeColors();
  const [openId, setOpenId] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch("/api/health", { method: "GET" });
        if (!cancelled) setHealthOk(res.ok);
      } catch {
        if (!cancelled) setHealthOk(false);
      }
    };
    void ping();
    const id = setInterval(ping, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, { backgroundColor: theme.background }, pressed && styles.pressed]}
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.foreground} />
        </Pressable>
        <View>
          <Text style={[styles.headerLabel, { color: theme.primary }]}>Aide &amp; support</Text>
          <Text style={[styles.headerTitle, { color: theme.foreground }]}>Comment pouvons-nous aider ?</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: healthOk === true ? theme.success : healthOk === false ? theme.error : theme.warning }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: theme.foreground }]}>
                {healthOk === true
                  ? "Tous les services sont opérationnels"
                  : healthOk === false
                    ? "Indisponibilité détectée"
                    : "Vérification en cours…"}
              </Text>
              <Text style={[styles.statusSub, { color: theme.muted }]}>
                {healthOk === null
                  ? "Connexion au serveur…"
                  : healthOk
                    ? `Dernière vérification : ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                    : "Impossible de joindre le serveur pour le moment"}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.muted }]}>Questions fréquentes</Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {FAQ.map((item, index) => {
            const isOpen = openId === item.id;
            return (
              <View key={item.id} style={[styles.faqItem, index > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Pressable
                  onPress={() => setOpenId(isOpen ? null : item.id)}
                  style={({ pressed }) => [styles.faqHeader, pressed && { backgroundColor: theme.pressed }]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <Text style={[styles.faqQuestion, { color: theme.foreground }]}>{item.question}</Text>
                  <MaterialIcons name={isOpen ? "expand-less" : "expand-more"} size={20} color={theme.muted} />
                </Pressable>
                {isOpen ? <Text style={[styles.faqAnswer, { color: theme.muted }]}>{item.answer}</Text> : null}
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: theme.muted }]}>Nous contacter</Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {CHANNELS.map((channel, index) => (
            <Pressable
              key={channel.label}
              onPress={() => { void Linking.openURL(channel.action); }}
              style={({ pressed }) => [styles.channelRow, index > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: theme.pressed }]}
            >
              <View style={[styles.channelIcon, { backgroundColor: theme.background }]}>
                <MaterialIcons name={channel.icon} size={18} color={theme.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.channelLabel, { color: theme.foreground }]}>{channel.label}</Text>
                <Text style={[styles.channelValue, { color: theme.muted }]} numberOfLines={1}>{channel.value}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.muted} />
            </Pressable>
          ))}
        </View>

        <Text style={[styles.footer, { color: theme.muted }]}>
          Réponse typique sous 24 heures ouvrées. Pour un incident de sécurité, utilisez le canal WhatsApp.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" },
  headerTitle: { fontSize: 17, fontWeight: "700", marginTop: 2 },
  pressed: { opacity: 0.7 },
  content: { padding: 14, gap: 10, paddingBottom: 32 },

  statusCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTitle: { fontSize: 13, fontWeight: "600" },
  statusSub: { fontSize: 11.5, marginTop: 2 },

  sectionTitle: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase", marginTop: 6, paddingHorizontal: 4 },

  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },

  faqItem: {},
  faqHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  faqQuestion: { flex: 1, fontSize: 13, fontWeight: "600" },
  faqAnswer: { fontSize: 12.5, lineHeight: 18, paddingHorizontal: 14, paddingBottom: 14 },

  channelRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  channelIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  channelLabel: { fontSize: 13, fontWeight: "600" },
  channelValue: { fontSize: 11.5, marginTop: 2 },

  footer: { fontSize: 11.5, textAlign: "center", lineHeight: 16, marginTop: 8, paddingHorizontal: 12 },
});
