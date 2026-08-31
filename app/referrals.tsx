import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { REFERRAL_REWARD_AMOUNT } from "@/lib/referral-rules";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { formatMoney, type ReferralRecord } from "@/shared/tikis-domain";

export default function ReferralsScreen() {
  const { profile, referrals, wallet, claimReferralReward } = useTikisStore();
  const { colors: theme, isDark } = useThemeColors();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const code = profile?.referralCode;
  const qualified = useMemo(() => referrals.filter((item) => item.status === "qualified").length, [referrals]);
  const rewarded = useMemo(() => referrals.filter((item) => item.status === "rewarded").length, [referrals]);

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
      await Share.share({ message: `Rejoins Tikis avec mon code livreur ${code}. Après ta première course terminée, je reçois ${formatMoney(REFERRAL_REWARD_AMOUNT)} sur mon Wallet.` });
      haptic.light();
    } catch {
      haptic.error();
    } finally {
      setSharing(false);
    }
  }

  async function claim(referral: ReferralRecord) {
    if (claimingId) return;
    setClaimingId(referral.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 280));
      const result = claimReferralReward(referral.id);
      if (result.ok) haptic.success();
      else haptic.error();
    } finally {
      setClaimingId(null);
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
        <View style={styles.summaryRow}><Metric icon="groups" value={String(referrals.length)} label="Filleuls" theme={theme} /><Metric icon="pending-actions" value={String(qualified)} label="À créditer" theme={theme} /><Metric icon="account-balance-wallet" value={formatMoney(wallet.total)} label="Solde Wallet" theme={theme} /></View>
        <Text style={[styles.sectionLabel, { color: theme.muted }]}>SUIVI DES FILLEULS</Text>
      </>}
      renderItem={({ item }) => <ReferralRow referral={item} loading={claimingId === item.id} onClaim={() => void claim(item)} theme={theme} isDark={isDark} />}
      ListEmptyComponent={<View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="group-add" size={28} color={theme.primary} /></View><Text style={[styles.emptyTitle, { color: theme.foreground }]}>Aucun filleul suivi</Text><Text style={[styles.emptyText, { color: theme.muted }]}>Partagez votre code pour commencer à développer votre réseau de livreurs.</Text></View>}
      ListFooterComponent={rewarded ? <Text style={[styles.footer, { color: theme.muted }]}>Les récompenses versées restent enregistrées dans le journal de votre Wallet.</Text> : null}
    />
  </SafeAreaView>;
}

function Metric({ icon, value, label, theme }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string; theme: { primary: string; surface: string; foreground: string; muted: string; pressed: string } }) {
  return <View style={[styles.metric, { backgroundColor: theme.surface }]}><MaterialIcons name={icon} size={19} color={theme.primary} /><Text style={[styles.metricValue, { color: theme.foreground }]} numberOfLines={1}>{value}</Text><Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text></View>;
}

function ReferralRow({ referral, loading, onClaim, theme, isDark }: { referral: ReferralRecord; loading: boolean; onClaim: () => void; theme: { primary: string; surface: string; foreground: string; muted: string; success: string; pressed: string; border: string }; isDark: boolean }) {
  const meta = referral.status === "rewarded" ? { label: "Créditée", color: theme.success, background: isDark ? "#173528" : "#E6EFE9", icon: "check-circle" as const } : referral.status === "qualified" ? { label: "Éligible", color: theme.primary, background: isDark ? "#312515" : "#F8E8CE", icon: "stars" as const } : { label: "En attente", color: theme.muted, background: theme.pressed, icon: "schedule" as const };
  return <View style={[styles.referralCard, { backgroundColor: theme.surface }]}><View style={styles.referralTop}><View style={[styles.personIcon, { backgroundColor: isDark ? "#312515" : "#F8E8CE" }]}><MaterialIcons name="person" size={20} color={theme.primary} /></View><View style={styles.referralInfo}><Text style={[styles.referralName, { color: theme.foreground }]}>{referral.fullName}</Text><Text style={[styles.referralDate, { color: theme.muted }]}>Inscrit le {referral.joinedAt}</Text></View><View style={[styles.status, { backgroundColor: meta.background }]}><MaterialIcons name={meta.icon} size={14} color={meta.color} /><Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text></View></View><View style={[styles.referralDetails, { borderTopColor: theme.border }]}><Text style={[styles.detailText, { color: theme.muted }]}>{referral.completedDeliveries}/1 course terminée</Text><Text style={[styles.reward, { color: theme.primary }]}>{formatMoney(referral.rewardAmount)}</Text></View>{referral.status === "qualified" ? <TikisButton label="Créditer mon Wallet" icon="account-balance-wallet" onPress={onClaim} loading={loading} loadingLabel="Crédit en cours…" style={styles.claimButton} /> : referral.status === "invited" ? <Text style={[styles.waitingText, { color: theme.muted }]}>La récompense est débloquée dès la première course terminée.</Text> : <Text style={[styles.rewardedText, { color: theme.success }]}>Récompense versée dans votre Wallet.</Text>}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { padding: 16, paddingBottom: 32 }, pressed: { opacity: 0.68 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }, back: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { fontSize: 16, fontWeight: "600" }, placeholder: { width: 40 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "600", letterSpacing: -0.3 }, codeCard: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 9, padding: 14 }, codeIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" }, codeContent: { flex: 1 }, codeLabel: { color: "rgba(255,255,255,0.62)", fontSize: 10, fontWeight: "600", letterSpacing: 0.6 }, code: { color: "#FFFFFF", fontSize: 21, fontWeight: "600", letterSpacing: 1.4, marginTop: 2 }, noCodeCard: { marginTop: 16, flexDirection: "row", gap: 9, alignItems: "center", borderRadius: 9, padding: 13 }, noCodeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 }, actionButton: { flex: 1, minHeight: 44 }, summaryRow: { flexDirection: "row", gap: 8, marginTop: 14 }, metric: { flex: 1, padding: 11, minHeight: 88, borderRadius: 9 }, metricValue: { fontSize: 14, fontWeight: "600", marginTop: 8 }, metricLabel: { fontSize: 10, lineHeight: 14, marginTop: 3 }, sectionLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7, marginTop: 22, marginBottom: 8 },
  referralCard: { borderRadius: 9, padding: 13, marginBottom: 8 }, referralTop: { flexDirection: "row", alignItems: "center", gap: 9 }, personIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" }, referralInfo: { flex: 1 }, referralName: { fontSize: 14, fontWeight: "600" }, referralDate: { fontSize: 11, marginTop: 2 }, status: { flexDirection: "row", gap: 4, alignItems: "center", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4 }, statusText: { fontSize: 10, fontWeight: "600" }, referralDetails: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth }, detailText: { fontSize: 12 }, reward: { fontSize: 14, fontWeight: "600" }, claimButton: { marginTop: 11, minHeight: 42 }, waitingText: { fontSize: 11, lineHeight: 16, marginTop: 10 }, rewardedText: { fontSize: 11, fontWeight: "600", marginTop: 10 },
  empty: { alignItems: "center", paddingHorizontal: 28, paddingTop: 38 }, emptyIcon: { width: 62, height: 62, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 12 }, emptyTitle: { fontSize: 16, fontWeight: "600" }, emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 }, footer: { fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: 16, marginTop: 10 },
});
