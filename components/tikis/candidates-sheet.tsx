import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { formatMoney, type DriverCandidate } from "@/shared/tikis-domain";

type Tab = "all" | "verified" | "fastest";

type Props = {
  visible: boolean;
  candidates: DriverCandidate[];
  deliveryStatus: string;
  loadingId?: string | null;
  onClose: () => void;
  onChoose: (candidate: DriverCandidate) => void;
};

export function CandidatesSheet({ visible, candidates, deliveryStatus, loadingId, onClose, onChoose }: Props) {
  const [tab, setTab] = useState<Tab>("all");

  const filtered = useMemo(() => {
    if (tab === "verified") return candidates.filter((c) => c.isVerified);
    if (tab === "fastest") return [...candidates].sort((a, b) => (a.offerPrice ?? 0) - (b.offerPrice ?? 0));
    return candidates;
  }, [candidates, tab]);

  const counts = useMemo(() => ({
    all: candidates.length,
    verified: candidates.filter((c) => c.isVerified).length,
    fastest: candidates.length,
  }), [candidates]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetGrip} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Livreurs candidats</Text>
              <Text style={styles.subtitle}>
                {candidates.length === 0
                  ? "Aucune candidature pour le moment"
                  : `${candidates.length} livreur${candidates.length > 1 ? "s" : ""} ont proposé leur service`}
              </Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]} accessibilityLabel="Fermer">
              <MaterialIcons name="close" size={16} color="#111111" />
            </Pressable>
          </View>

          {candidates.length > 0 ? (
            <>
              <View style={styles.tabs}>
                <TabButton label="Tous" count={counts.all} active={tab === "all"} onPress={() => setTab("all")} />
                <TabButton label="Vérifiés" count={counts.verified} active={tab === "verified"} onPress={() => setTab("verified")} />
                <TabButton label="Mieux notés" count={counts.fastest} active={tab === "fastest"} onPress={() => setTab("fastest")} />
              </View>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {filtered.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    deliveryStatus={deliveryStatus}
                    loading={loadingId === candidate.id}
                    onChoose={() => onChoose(candidate)}
                  />
                ))}
              </ScrollView>
            </>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name="schedule" size={26} color="#747474" />
              </View>
              <Text style={styles.emptyTitle}>En attente de candidatures</Text>
              <Text style={styles.emptyText}>
                Votre livraison a été publiée. Les livreurs compatibles apparaîtront ici dès qu’ils proposeront leur service.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function TabButton({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabCount, active && styles.tabCountActive]}>
        <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>{count}</Text>
      </View>
    </Pressable>
  );
}

function CandidateCard({ candidate, deliveryStatus, loading, onChoose }: { candidate: DriverCandidate; deliveryStatus: string; loading: boolean; onChoose: () => void }) {
  const unavailable = candidate.status === "selected" || candidate.status === "confirmed";
  const label = unavailable ? "En attente" : deliveryStatus === "active" ? "Remplacer" : "Choisir";
  const ctaStyle = unavailable ? styles.ctaGhost : styles.ctaPrimary;
  const ctaTextStyle = unavailable ? styles.ctaTextGhost : styles.ctaTextPrimary;
  return (
    <View style={styles.candidateCard}>
      <View style={styles.candidateRow}>
        <View style={styles.candidateAvatar}>
          <Text style={styles.candidateInitials}>{candidate.initials}</Text>
          {candidate.isVerified ? (
            <View style={styles.verifiedBadge}>
              <MaterialIcons name="check" size={10} color="#167A55" />
            </View>
          ) : null}
        </View>
        <View style={styles.candidateBody}>
          <View style={styles.candidateNameRow}>
            <Text style={styles.candidateName} numberOfLines={1}>{candidate.name}</Text>
            {candidate.isVerified ? <MaterialIcons name="verified" size={13} color="#167A55" /> : null}
          </View>
          <Text style={styles.candidateMeta} numberOfLines={1}>
            {candidate.completedDeliveries > 0
              ? `★ ${candidate.rating.toLocaleString("fr-FR")} · ${candidate.completedDeliveries} livraisons`
              : "Aucune note · Profil Tikis vérifié"}
          </Text>
        </View>
        <Pressable onPress={onChoose} disabled={unavailable || loading} style={({ pressed }) => [styles.cta, ctaStyle, pressed && styles.pressed, (unavailable || loading) && styles.ctaDisabled]}>
          <Text style={[styles.ctaText, ctaTextStyle]}>{label}</Text>
        </Pressable>
      </View>
      <View style={styles.candidateRow2}>
        <View>
          <Text style={styles.candidateVehicle}>{candidate.vehicles.join(", ") || "Engin à confirmer"}</Text>
          <Text style={styles.candidatePrice}>{formatMoney(candidate.offerPrice ?? candidate.commissionBlocked * 10)}</Text>
        </View>
        {candidate.completedDeliveries > 0 ? <Text style={styles.candidateHint}>★ {candidate.rating.toLocaleString("fr-FR")} sur 5</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,17,32,0.42)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingBottom: 18, maxHeight: "80%", minHeight: 220 },

  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 12 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#ECECEC" },
  title: { color: "#111111", fontSize: 15, fontWeight: "700" },
  subtitle: { color: "#666666", fontSize: 11, marginTop: 2 },
  close: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },

  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7, backgroundColor: "#EEEDF3" },
  tabActive: { backgroundColor: "#111111" },
  tabText: { color: "#666666", fontSize: 11, fontWeight: "600" },
  tabTextActive: { color: "#FFFFFF" },
  tabCount: { backgroundColor: "#FFFFFF", paddingHorizontal: 5, borderRadius: 99, minWidth: 18, alignItems: "center" },
  tabCountActive: { backgroundColor: "rgba(255,255,255,0.2)" },
  tabCountText: { color: "#666666", fontSize: 9, fontWeight: "600" },
  tabCountTextActive: { color: "#FFFFFF" },

  list: { marginTop: 4 },
  listContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 30, gap: 8 },

  candidateCard: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#ECECEC", borderRadius: 12, padding: 12, gap: 10 },
  candidateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  candidateAvatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0 },
  candidateInitials: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  verifiedBadge: { position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  candidateBody: { flex: 1, minWidth: 0 },
  candidateNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  candidateName: { color: "#111111", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  candidateMeta: { color: "#666666", fontSize: 11, marginTop: 2 },
  cta: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 7 },
  ctaPrimary: { backgroundColor: "#111111" },
  ctaGhost: { backgroundColor: "#EEEDF3" },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: 11, fontWeight: "600" },
  ctaTextPrimary: { color: "#FFFFFF" },
  ctaTextGhost: { color: "#747474" },

  candidateRow2: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, borderTopColor: "#ECECEC" },
  candidateVehicle: { color: "#666666", fontSize: 11 },
  candidatePrice: { color: "#007B8B", fontSize: 14, fontWeight: "700", marginTop: 2 },
  candidateHint: { color: "#9A6200", fontSize: 10, fontWeight: "600" },

  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 28, gap: 10 },
  emptyIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
});
