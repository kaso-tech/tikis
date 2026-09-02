import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useThemeColors } from "@/lib/use-theme-colors";

type FaqEntry = { id: string; category: string; question: string; answer: string };

const FAQ: FaqEntry[] = [
  {
    id: "kyc-1",
    category: "Vérification d’identité",
    question: "Pourquoi Tikis vérifie-t-il l’identité des livreurs ?",
    answer: "La vérification protège la communauté : elle limite les annonces frauduleuses, sécurise le paiement de la course et rassure les expéditeurs. Sans vérification, un livreur ne peut pas postuler aux livraisons.",
  },
  {
    id: "kyc-2",
    category: "Vérification d’identité",
    question: "Quelles pièces sont demandées ?",
    answer: "Une pièce d’identité officielle en cours de validité (recto puis verso) ainsi qu’un selfie récent. Le document doit être lisible, sans reflet ni zone floue.",
  },
  {
    id: "kyc-3",
    category: "Vérification d’identité",
    question: "Combien de temps prend la validation ?",
    answer: "L’examen est réalisé sous 24 heures ouvrées. Vous recevez une notification dès que votre profil est validé ou si des informations complémentaires sont nécessaires.",
  },
  {
    id: "billing-1",
    category: "Livraisons & commissions",
    question: "Comment est calculée la commission Tikis ?",
    answer: "La commission est un pourcentage du prix de la course, défini par l’administration. Elle est calculée dynamiquement à partir de la politique de commission et du prix proposé par l’expéditeur, sans montant figé dans l’application.",
  },
  {
    id: "billing-2",
    category: "Livraisons & commissions",
    question: "Que se passe-t-il si je remplace un livreur ?",
    answer: "La commission du nouveau livreur est débitée puis rembourse intégralement l’ancien. Tikis ne perçoit jamais plus d’une commission par livraison.",
  },
  {
    id: "billing-3",
    category: "Wallet",
    question: "Pourquoi mon solde disponible peut-il être inférieur à mon solde total ?",
    answer: "La différence correspond aux commissions temporairement bloquées pour vos candidatures en cours. Elles sont libérées si vous n’êtes pas retenu et débitées uniquement lorsque vous confirmez une mission.",
  },
  {
    id: "wallet-1",
    category: "Wallet",
    question: "Quand reçois-je le paiement d’une course ?",
    answer: "Le règlement s’effectue directement entre l’expéditeur et le livreur, en espèces ou via Mobile Money, lors de la remise du colis. Tikis n’intervient pas dans ce transfert et ne prélève aucune part du prix.",
  },
  {
    id: "account-1",
    category: "Compte & rôles",
    question: "Puis-je changer de rôle après l’inscription ?",
    answer: "Non. Le rôle choisi à l’inscription (expéditeur ou livreur) est définitif pour des raisons de cohérence métier. Vous pouvez quitter Tikis à tout moment depuis votre profil.",
  },
  {
    id: "account-2",
    category: "Compte & rôles",
    question: "Comment supprimer mon compte ?",
    answer: "Depuis votre Profil, section « Zone sensible », demandez la suppression de votre compte. Vous disposez ensuite de 30 jours pour changer d’avis et annuler ; passé ce délai, vos données personnelles sont définitivement supprimées.",
  },
  {
    id: "security-1",
    category: "Sécurité",
    question: "Mes coordonnées sont-elles partagées avec l’autre partie ?",
    answer: "Vos coordonnées complètes ne sont rendues visibles qu’après confirmation de la mission. Avant cela, le trajet et les adresses restent approximatifs pour limiter les risques.",
  },
];

const CATEGORIES = Array.from(new Set(FAQ.map((entry) => entry.category)));

export default function FaqScreen() {
  const { colors: theme } = useThemeColors();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.background }, pressed && styles.pressed]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.foreground} />
        </Pressable>
        <View>
          <Text style={[styles.title, { color: theme.foreground }]}>Foire aux questions</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>Réponses aux questions les plus fréquentes sur Tikis.</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {CATEGORIES.map((category) => (
          <View key={category} style={styles.section}>
            <Text style={[styles.category, { color: theme.muted }]}>{category}</Text>
            <View style={[styles.list, { backgroundColor: theme.surface }]}>
              {FAQ.filter((entry) => entry.category === category).map((entry) => {
                const open = openId === entry.id;
                return (
                  <View key={entry.id} style={[styles.item, open && { backgroundColor: theme.background }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={open ? `Replier ${entry.question}` : `Déplier ${entry.question}`}
                      onPress={() => setOpenId(open ? null : entry.id)}
                      style={({ pressed }) => [styles.itemHeader, pressed && styles.pressed]}
                    >
                      <Text style={[styles.itemQuestion, { color: theme.foreground }]}>{entry.question}</Text>
                      <MaterialIcons name={open ? "remove" : "add"} size={20} color={theme.foreground} />
                    </Pressable>
                    {open ? <Text style={[styles.itemAnswer, { color: theme.muted }]}>{entry.answer}</Text> : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
        <View style={[styles.contactCard, { backgroundColor: theme.surface }]}>
          <MaterialIcons name="support-agent" size={22} color={theme.primary} />
          <View style={styles.contactCopy}>
            <Text style={[styles.contactTitle, { color: theme.foreground }]}>Vous n’avez pas trouvé votre réponse ?</Text>
            <Text style={[styles.contactText, { color: theme.muted }]}>Notre équipe est joignable depuis la page Contact.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  content: { padding: 14, paddingBottom: 36, gap: 14 },
  section: { gap: 8 },
  category: { fontSize: 10, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginLeft: 2 },
  list: { borderRadius: 10, overflow: "hidden" },
  item: { paddingHorizontal: 12, borderBottomWidth: 0 },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56 },
  itemQuestion: { flex: 1, fontSize: 13, fontWeight: "600" },
  itemAnswer: { fontSize: 12, lineHeight: 18, paddingBottom: 12, paddingRight: 4 },
  contactCard: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  contactCopy: { flex: 1 },
  contactTitle: { fontSize: 12, fontWeight: "600" },
  contactText: { fontSize: 11, marginTop: 2 },
  pressed: { opacity: 0.67 },
});
