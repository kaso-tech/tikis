import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { formatMoney, isDriverCertified, type DriverCandidate } from "@/shared/tikis-domain";

type Tab = "all" | "certified" | "best";

type Props = {
  visible: boolean;
  candidates: DriverCandidate[];
  deliveryStatus: string;
  loadingId?: string | null;
  onClose: () => void;
  onChoose: (candidate: DriverCandidate) => void;
};

function shortRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function CandidatesSheet({ visible, candidates, deliveryStatus, loadingId, onClose, onChoose }: Props) {
  const { colors: theme, isDark } = useThemeColors();
  const [tab, setTab] = useState<Tab>("all");

  const filtered = useMemo(() => {
    if (tab === "certified") return candidates.filter((c) => c.isCertified);
    if (tab === "best") return [...candidates].sort((a, b) => b.rating - a.rating);
    return candidates;
  }, [candidates, tab]);

  const counts = useMemo(() => ({
    all: candidates.length,
    certified: candidates.filter((c) => c.isCertified).length,
    best: candidates.length,
  }), [candidates]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={[styles.sheetGrip, { backgroundColor: theme.border }]} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.eyebrow, { color: theme.muted }]}>Candidatures</Text>
              <Text style={[styles.title, { color: theme.foreground }]}>
                {candidates.length === 0
                  ? "En attente de livreurs"
                  : `${candidates.length} livreur${candidates.length > 1 ? "s" : ""} proposent leur service`}
              </Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: theme.pressed, borderColor: theme.border }, pressed && styles.pressed]} accessibilityLabel="Fermer">
              <MaterialIcons name="close" size={16} color={theme.foreground} />
            </Pressable>
          </View>

          {candidates.length > 0 ? (
            <>
              <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
                <TabButton label="Tous" count={counts.all} active={tab === "all"} onPress={() => setTab("all")} theme={theme} />
                <TabButton label="Certifiés" count={counts.certified} active={tab === "certified"} onPress={() => setTab("certified")} theme={theme} />
                <TabButton label="Mieux notés" count={counts.best} active={tab === "best"} onPress={() => setTab("best")} theme={theme} />
              </View>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {filtered.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    deliveryStatus={deliveryStatus}
                    loading={loadingId === candidate.id}
                    onChoose={() => onChoose(candidate)}
                    theme={theme}
                    isDark={isDark}
                  />
                ))}
              </ScrollView>
            </>
          ) : (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}>
                <MaterialIcons name="schedule" size={26} color={theme.muted} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.foreground }]}>En attente de candidatures</Text>
              <Text style={[styles.emptyText, { color: theme.muted }]}>
                Votre livraison a été publiée. Les livreurs compatibles apparaîtront ici dès qu’ils proposeront leur service.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function TabButton({ label, count, active, onPress, theme }: { label: string; count: number; active: boolean; onPress: () => void; theme: any }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Text style={[styles.tabLabel, { color: active ? theme.primary : theme.muted }]}>{label}</Text>
      <Text style={[styles.tabCount, { color: theme.muted }]}>{count}</Text>
      {active ? <View style={[styles.tabIndicator, { backgroundColor: theme.primary }]} /> : null}
    </Pressable>
  );
}

function CandidateCard({ candidate, deliveryStatus, loading, onChoose, theme, isDark }: { candidate: DriverCandidate; deliveryStatus: string; loading: boolean; onChoose: () => void; theme: any; isDark: boolean }) {
  const isSelected = candidate.status === "selected" || candidate.status === "confirmed";
  const label = isSelected ? "En attente" : deliveryStatus === "active" ? "Remplacer" : "Choisir";
  const canChoose = !isSelected && !loading;
  const vehiclePrice = candidate.offerPrice ?? candidate.commissionBlocked * 10;
  const postedAt = shortRelative(candidate.createdAt);
  const certColor = theme.primary;
  const certBg = isDark ? "#312515" : "#F8E8CE";
  const disabledBg = theme.pressed;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: isSelected ? theme.input : theme.surface },
      ]}
    >
      <View style={styles.cardTop}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: candidate.isCertified ? theme.primary : theme.muted,
            },
          ]}
        >
          <Text style={[styles.avatarText, { color: theme.surface }]}>
            {candidate.initials || candidate.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: theme.foreground }]} numberOfLines={1}>
              {candidate.name}
            </Text>
            {candidate.isCertified ? (
              <View style={[styles.certPill, { backgroundColor: certBg }]}>
                <Text style={[styles.certPillText, { color: certColor }]}>CERTIFIÉ</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
            {candidate.completedDeliveries} livraison{candidate.completedDeliveries > 1 ? "s" : ""} · ★ {candidate.rating.toLocaleString("fr-FR")}
          </Text>
        </View>
        <View style={styles.distanceBlock}>
          <View style={styles.distanceLine}>
            <MaterialIcons name="star" size={13} color={certColor} />
            <Text style={[styles.distanceValue, { color: theme.foreground }]}>
              {candidate.completedDeliveries > 0 ? "1,2 km" : "—"}
            </Text>
          </View>
          <Text style={[styles.price, { color: theme.foreground }]}>{formatMoney(vehiclePrice)}</Text>
        </View>
      </View>

      <View style={[styles.cardFooter, { borderTopColor: theme.border }]}>
        <Text style={[styles.postedAt, { color: theme.muted }]}>{postedAt}</Text>
        {isSelected ? (
          <View style={styles.footerRight}>
            <View style={[styles.selectedPill, { backgroundColor: certBg }]}>
              <Text style={[styles.selectedPillText, { color: theme.primary }]}>SÉLECTIONNÉ</Text>
            </View>
            <Pressable
              onPress={onChoose}
              disabled
              style={({ pressed }) => [styles.cta, { backgroundColor: disabledBg }, pressed && styles.pressed]}
              accessibilityLabel="En attente"
            >
              <Text style={[styles.ctaText, { color: theme.muted }]}>{label}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onChoose}
            disabled={!canChoose}
            style={({ pressed }) => [styles.cta, { backgroundColor: theme.primary, borderColor: theme.primary }, !canChoose && { backgroundColor: disabledBg, borderColor: theme.border }, pressed && styles.pressed]}
            accessibilityLabel={label}
          >
            <Text style={styles.ctaText}>{label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingTop: 8, paddingBottom: 18, maxHeight: "92%", minHeight: 240 },

  sheetGrip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },

  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: "500", letterSpacing: 0.3, marginBottom: 2 },
  title: { fontSize: 17, fontWeight: "600", letterSpacing: -0.3, lineHeight: 22 },
  close: { width: 32, height: 32, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  pressed: { opacity: 0.6 },

  tabsRow: { flexDirection: "row", gap: 20, paddingHorizontal: 20, paddingBottom: 0, borderBottomWidth: 1 },
  tab: { paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 4, position: "relative" },
  tabLabel: { fontSize: 13, fontWeight: "600" },
  tabCount: { fontSize: 10, fontWeight: "500" },
  tabIndicator: { position: "absolute", left: 0, right: 0, bottom: -1, height: 1 },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 8 },

  card: { borderRadius: 9, paddingHorizontal: 14, paddingVertical: 12 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "600", fontSize: 14 },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  name: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  certPill: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  certPillText: { fontSize: 8, fontWeight: "700", letterSpacing: 0.4 },
  meta: { fontSize: 11, fontWeight: "500" },
  distanceBlock: { alignItems: "flex-end", gap: 2 },
  distanceLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  distanceValue: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  price: { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },

  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  postedAt: { fontSize: 11, fontWeight: "500" },
  footerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectedPill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  selectedPillText: { fontSize: 8, fontWeight: "700", letterSpacing: 0.4 },
  cta: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },

  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 30, gap: 6 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
});
