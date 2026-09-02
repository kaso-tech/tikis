import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatMoney, type ReferralRecord } from "@/shared/tikis-domain";

export default function ReferralsScreen() {
  const { profile } = useTikisStore();
  const { colors: theme, isDark } = useThemeColors();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);

  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const settingsQuery = trpc.referrals.settings.useQuery();
  const referralsQuery = trpc.referrals.mine.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const referrals = referralsQuery.data ?? [];

  const code = profile?.referralCode;
  const qualified = useMemo(() => referrals.filter((item) => item.status === "qualified").length, [referrals]);
  const rewarded = useMemo(() => referrals.filter((item) => item.status === "rewarded").length, [referrals]);
  const rewardAmount = settingsQuery.data?.rewardAmount ?? 1000;
  const requiredDeliveries = settingsQuery.data?.requiredDeliveries ?? 1;

  async function copyCode() {
    if (!code || copying) return;
    setCopying(true);
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      haptic.success();
      setTimeout(() => setCopied(false), 1800);
    } catch {
      haptic.error();
    } finally {
      setCopying(false);
    }
  }

  async function shareCode() {
    if (!code || sharing) return;
    setSharing(true);
    try {
      await Share.share({ message: `Rejoins Tikis avec mon code livreur ${code}. Après ${requiredDeliveries > 1 ? `mes ${requiredDeliveries} premières courses terminées` : "ma première course terminée"}, je reçois ${formatMoney(rewardAmount)} sur mon Wallet.` });
      haptic.light();
    } catch {
      haptic.error();
    } finally {
      setSharing(false);
    }
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
    <FlatList
      data={referrals}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]} accessibilityLabel="Retour"><MaterialIcons name="arrow-back" size={21} color={theme.foreground} /></Pressable>
          <Text style={[styles.topTitle, { color: theme.foreground }]}>Parrainage</Text>
          <View style={styles.placeholder} />
        </View>
        <Text style={[styles.title, { color: theme.foreground }]}>Invitez des livreurs et gagnez des crédits.</Text>
        {code ? <View style={[styles.codeCard, { backgroundColor: isDark ? "#312515" : "#111111" }]}><View style={[styles.codeIcon, { backgroundColor: theme.primary }]}><MaterialIcons name="card-giftcard" size={25} color="#FFFFFF" /></View><View style={styles.codeContent}><Text style={styles.codeLabel}>VOTRE CODE</Text><Text style={styles.code}>{code}</Text></View></View> : <View style={[styles.noCodeCard, { backgroundColor: theme.surface }]}><MaterialIcons name="hourglass-top" size={22} color={theme.primary} /><Text style={[styles.noCodeText, { color: theme.muted }]}>Votre code sera disponible dès la création de votre compte livreur.</Text></View>}
        <View style={styles.actions}><TikisButton label={copied ? "Code copié" : "Copier le code"} icon={copied ? "check" : "content-copy"} variant="secondary" onPress={() => void copyCode()} loading={copying} loadingLabel="Copie…" disabled={!code} style={styles.actionButton} /><TikisButton label="Partager" icon="share" onPress={() => void shareCode()} loading={sharing} loadingLabel="Ouverture…" disabled={!code} style={styles.actionButton} /></View>
        <View style={styles.summaryRow}><Metric icon="groups" value={String(referrals.length)} label="Filleuls" theme={theme} /><Metric icon="pending-actions" value={String(qualified)} label="En validation" theme={theme} /><Metric icon="account-balance-wallet" value={formatMoney(walletQuery.data?.wallet.total ?? 0)} label="Solde Wallet" theme={theme} /></View>
        <Text style={[styles.sectionLabel, { color: theme.muted }]}>SUIVI DES FILLEULS</Text>
      </>}
      renderItem={({ item }) => <ReferralRow referral={item} requiredDeliveries={requiredDeliveries} theme={theme} isDark={isDark} />}
      ListEmptyComponent={<View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="group-add" size={28} color={theme.primary} /></View><Text style={[styles.emptyTitle, { color: theme.foreground }]}>Aucun filleul suivi</Text><Text style={[styles.emptyText, { color: theme.muted }]}>Partagez votre code pour commencer à développer votre réseau de livreurs.</Text></View>}
      ListFooterComponent={rewarded ? <Text style={[styles.footer, { color: theme.muted }]}>Les récompenses versées restent enregistrées dans le journal de votre Wallet.</Text> : null}
    />
  </SafeAreaView>;
}

function Metric({ icon, value, label, theme }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string; theme: { primary: string; surface: string; foreground: string; muted: string; pressed: string } }) {
  return <View style={[styles.metric, { backgroundColor: theme.surface }]}><MaterialIcons name={icon} size={19} color={theme.primary} /><Text style={[styles.metricValue, { color: theme.foreground }]} numberOfLines={1}>{value}</Text><Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text></View>;
}

function ReferralRow({ referral, requiredDeliveries, theme, isDark }: { referral: Omit<ReferralRecord, "completedDeliveries">; requiredDeliveries: number; theme: { primary: string; surface: string; foreground: string; muted: string; success: string; pressed: string; border: string }; isDark: boolean }) {
  const meta = referral.status === "rewarded" ? { label: "Créditée", color: theme.success, background: isDark ? "#173528" : "#E6EFE9", icon: "check-circle" as const }
    : referral.status === "qualified" ? { label: "En validation", color: theme.primary, background: isDark ? "#312515" : "#F8E8CE", icon: "stars" as const }
    : referral.status === "voided" ? { label: "Annulée", color: theme.muted, background: theme.pressed, icon: "block" as const }
    : { label: "En attente", color: theme.muted, background: theme.pressed, icon: "schedule" as const };
  return <View style={[styles.referralCard, { backgroundColor: theme.surface }]}><View style={styles.referralTop}><View style={[styles.personIcon, { backgroundColor: isDark ? "#312515" : "#F8E8CE" }]}><MaterialIcons name="person" size={20} color={theme.primary} /></View><View style={styles.referralInfo}><Text style={[styles.referralName, { color: theme.foreground }]}>{referral.fullName}</Text><Text style={[styles.referralDate, { color: theme.muted }]}>Inscrit le {new Date(referral.joinedAt).toLocaleDateString("fr-FR")}</Text></View><View style={[styles.status, { backgroundColor: meta.background }]}><MaterialIcons name={meta.icon} size={14} color={meta.color} /><Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text></View></View><View style={[styles.referralDetails, { borderTopColor: theme.border }]}><Text style={[styles.detailText, { color: theme.muted }]}>Récompense après {requiredDeliveries} course{requiredDeliveries > 1 ? "s" : ""} terminée{requiredDeliveries > 1 ? "s" : ""}</Text><Text style={[styles.reward, { color: theme.primary }]}>{formatMoney(referral.rewardAmount)}</Text></View>{referral.status === "qualified" ? <Text style={[styles.waitingText, { color: theme.primary }]}>Éligible — en attente de validation par l’équipe Tikis.</Text> : referral.status === "invited" ? <Text style={[styles.waitingText, { color: theme.muted }]}>La récompense se débloque après {requiredDeliveries} course{requiredDeliveries > 1 ? "s" : ""} terminée{requiredDeliveries > 1 ? "s" : ""}.</Text> : referral.status === "rewarded" ? <Text style={[styles.rewardedText, { color: theme.success }]}>Récompense versée dans votre Wallet.</Text> : null}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { padding: 16, paddingBottom: 32 }, pressed: { opacity: 0.68 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }, back: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { fontSize: 16, fontWeight: "600" }, placeholder: { width: 40 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "600", letterSpacing: -0.3 }, codeCard: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 9, padding: 14 }, codeIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" }, codeContent: { flex: 1 }, codeLabel: { color: "rgba(255,255,255,0.62)", fontSize: 10, fontWeight: "600", letterSpacing: 0.6 }, code: { color: "#FFFFFF", fontSize: 21, fontWeight: "600", letterSpacing: 1.4, marginTop: 2 }, noCodeCard: { marginTop: 16, flexDirection: "row", gap: 9, alignItems: "center", borderRadius: 9, padding: 13 }, noCodeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 }, actionButton: { flex: 1, minHeight: 44 }, summaryRow: { flexDirection: "row", gap: 8, marginTop: 14 }, metric: { flex: 1, padding: 11, minHeight: 88, borderRadius: 9 }, metricValue: { fontSize: 14, fontWeight: "600", marginTop: 8 }, metricLabel: { fontSize: 10, lineHeight: 14, marginTop: 3 }, sectionLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7, marginTop: 22, marginBottom: 8 },
  referralCard: { borderRadius: 9, padding: 13, marginBottom: 8 }, referralTop: { flexDirection: "row", alignItems: "center", gap: 9 }, personIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" }, referralInfo: { flex: 1 }, referralName: { fontSize: 14, fontWeight: "600" }, referralDate: { fontSize: 11, marginTop: 2 }, status: { flexDirection: "row", gap: 4, alignItems: "center", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4 }, statusText: { fontSize: 10, fontWeight: "600" }, referralDetails: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth }, detailText: { fontSize: 12 }, reward: { fontSize: 14, fontWeight: "600" }, waitingText: { fontSize: 11, lineHeight: 16, marginTop: 10 }, rewardedText: { fontSize: 11, fontWeight: "600", marginTop: 10 },
  empty: { alignItems: "center", paddingHorizontal: 28, paddingTop: 38 }, emptyIcon: { width: 62, height: 62, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 12 }, emptyTitle: { fontSize: 16, fontWeight: "600" }, emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 }, footer: { fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: 16, marginTop: 10 },
});
