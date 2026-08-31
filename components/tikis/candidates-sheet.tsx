import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

const SCREEN_H = Dimensions.get("window").height;
const SHEET_CLOSED = 84;
const SHEET_PEEK = Math.round(SCREEN_H * 0.45);
const SHEET_EXPANDED = Math.round(SCREEN_H * 0.7);
const SWIPE_THRESHOLD = 24;

function nextSnap(current: number, velocityY: number): number {
  if (velocityY > 350) {
    if (current <= SHEET_PEEK) return SHEET_CLOSED;
    return SHEET_PEEK;
  }
  if (velocityY < -350) {
    if (current >= SHEET_PEEK) return SHEET_EXPANDED;
    return SHEET_PEEK;
  }
  if (current < SHEET_PEEK - 60) return SHEET_CLOSED;
  if (current > SHEET_PEEK + 60) return SHEET_EXPANDED;
  return SHEET_PEEK;
}

export function CandidatesSheet({ visible, candidates, deliveryStatus, loadingId, onClose, onChoose }: Props) {
  const { colors: theme } = useThemeColors();
  const [tab, setTab] = useState<Tab>("all");
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);
  const dragStartHeight = useRef(SHEET_PEEK);
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_H);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }).start();
      Animated.timing(sheetHeight, { toValue: SHEET_PEEK, duration: 280, useNativeDriver: false }).start();
      sheetValue.current = SHEET_PEEK;
    } else {
      Animated.timing(translateY, { toValue: SCREEN_H, duration: 240, useNativeDriver: true }).start();
    }
  }, [visible, sheetHeight, translateY]);

  const animateTo = (target: number) => {
    sheetValue.current = target;
    Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, bounciness: 0, speed: 14 }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6,
        onPanResponderGrant: () => {
          dragStartHeight.current = sheetValue.current;
        },
        onPanResponderMove: (_, gesture) => {
          const next = dragStartHeight.current - gesture.dy;
          const clamped = Math.max(SHEET_CLOSED, Math.min(SHEET_EXPANDED, next));
          sheetHeight.setValue(clamped);
        },
        onPanResponderRelease: (_, gesture) => {
          const target = nextSnap(sheetValue.current - gesture.dy, gesture.vy);
          animateTo(target);
        },
      }),
    [],
  );

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_H, duration: 240, useNativeDriver: true }),
      Animated.timing(sheetHeight, { toValue: SHEET_CLOSED, duration: 220, useNativeDriver: false }),
    ]).start(() => onClose());
  };

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

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[styles.backdrop, { backgroundColor: theme.overlay, opacity: translateY.interpolate({ inputRange: [0, SCREEN_H], outputRange: [1, 0], extrapolate: "clamp" }) }]}
        pointerEvents="auto"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} accessibilityLabel="Fermer la liste" />
      </Animated.View>
      <Animated.View style={[styles.root, { transform: [{ translateY }] }]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.background, height: sheetHeight },
          ]}
        >
          <View {...panResponder.panHandlers} style={styles.headerZone}>
            <View style={[styles.sheetGrip, { backgroundColor: isDark(theme) ? "#3A3A3A" : "#D5D5DC" }]} />
            <View style={styles.sheetTop}>
              <View style={styles.headerText}>
                <Text style={[styles.eyebrow, { color: theme.muted }]}>Candidatures</Text>
                <Text style={[styles.title, { color: theme.foreground }]} numberOfLines={1}>
                  {candidates.length === 0
                    ? "En attente de livreurs"
                    : `${candidates.length} livreur${candidates.length > 1 ? "s" : ""} proposent leur service`}
                </Text>
              </View>
              <Pressable onPress={closeSheet} style={({ pressed }) => [styles.close, { backgroundColor: isDark(theme) ? "#1F1F1F" : "#F0F0F0" }, pressed && styles.pressed]} accessibilityLabel="Fermer">
                <MaterialIcons name="close" size={16} color={theme.foreground} />
              </Pressable>
            </View>
          </View>

          {candidates.length > 0 ? (
            <>
              <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
                <TabButton label="Tous" count={counts.all} active={tab === "all"} onPress={() => setTab("all")} theme={theme} />
                <TabButton label="Certifiés" count={counts.certified} active={tab === "certified"} onPress={() => setTab("certified")} theme={theme} />
                <TabButton label="Mieux notés" count={counts.best} active={tab === "best"} onPress={() => setTab("best")} theme={theme} />
              </View>
              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                scrollEnabled={sheetValue.current > SHEET_PEEK}
              >
                {filtered.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    deliveryStatus={deliveryStatus}
                    loading={loadingId === candidate.id}
                    onChoose={() => onChoose(candidate)}
                    theme={theme}
                  />
                ))}
              </ScrollView>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.emptyWrap}>
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="schedule" size={26} color={theme.muted} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.foreground }]}>En attente de candidatures</Text>
                <Text style={[styles.emptyText, { color: theme.muted }]}>
                  Votre livraison a été publiée. Les livreurs compatibles apparaîtront ici dès qu’ils proposeront leur service.
                </Text>
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function isDark(theme: any) {
  return theme.foreground === "#F5F5F5";
}

function TabButton({ label, count, active, onPress, theme }: { label: string; count: number; active: boolean; onPress: () => void; theme: any }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Text style={[styles.tabLabel, { color: active ? theme.foreground : theme.muted }]}>{label}</Text>
      <Text style={[styles.tabCount, { color: theme.muted }]}>{count}</Text>
      {active ? <View style={[styles.tabIndicator, { backgroundColor: theme.foreground }]} /> : null}
    </Pressable>
  );
}

function CandidateCard({ candidate, deliveryStatus, loading, onChoose, theme }: { candidate: DriverCandidate; deliveryStatus: string; loading: boolean; onChoose: () => void; theme: any }) {
  const isSelected = candidate.status === "selected" || candidate.status === "confirmed";
  const label = isSelected ? "En attente" : deliveryStatus === "active" ? "Remplacer" : "Choisir";
  const canChoose = !isSelected && !loading;
  const vehiclePrice = candidate.offerPrice ?? candidate.commissionBlocked * 10;
  const postedAt = shortRelative(candidate.createdAt);
  const bearingDeg = 0;
  const certColor = isDark(theme) ? "#5BC0DE" : "#007B8B";
  const certBg = isDark(theme) ? "rgba(91,192,222,0.18)" : "#E5F4F7";
  const dividerColor = isDark(theme) ? "#262626" : "#E8E8E8";
  const subFg = isDark(theme) ? "#8A8A8A" : "#6B6B6B";
  const mutedFg = isDark(theme) ? "#5A5A5A" : "#9A9A9A";
  const disabledBg = isDark(theme) ? "#1A1A1A" : "#F0F0F0";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: isSelected ? theme.foreground : dividerColor,
          borderWidth: isSelected ? 2 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: candidate.isCertified
                ? (isDark(theme) ? theme.foreground : theme.foreground)
                : mutedFg,
            },
          ]}
        >
          <Text style={[styles.avatarText, { color: candidate.isCertified ? (isDark(theme) ? theme.background : theme.background) : theme.surface }]}>
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
          <Text style={[styles.meta, { color: subFg }]} numberOfLines={1}>
            {candidate.completedDeliveries} livraison{candidate.completedDeliveries > 1 ? "s" : ""} · ★ {candidate.rating.toLocaleString("fr-FR")}
          </Text>
        </View>
        <View style={styles.distanceBlock}>
          <View style={styles.distanceLine}>
            <MaterialIcons
              name="navigation"
              size={12}
              color={certColor}
              style={{ transform: [{ rotate: `${bearingDeg}deg` }] }}
            />
            <Text style={[styles.distanceValue, { color: theme.foreground }]}>1,2 km</Text>
          </View>
          <Text style={[styles.price, { color: theme.foreground }]}>{formatMoney(vehiclePrice)}</Text>
        </View>
      </View>

      <View style={[styles.cardFooter, { borderTopColor: dividerColor }]}>
        <Text style={[styles.postedAt, { color: mutedFg }]}>{postedAt}</Text>
        {isSelected ? (
          <View style={styles.footerRight}>
            <View style={[styles.selectedPill, { borderColor: theme.foreground }]}>
              <Text style={[styles.selectedPillText, { color: theme.foreground }]}>SÉLECTIONNÉ</Text>
            </View>
            <Pressable
              onPress={onChoose}
              disabled
              style={({ pressed }) => [styles.cta, { backgroundColor: disabledBg }, pressed && styles.pressed]}
              accessibilityLabel="En attente"
            >
              <Text style={[styles.ctaText, { color: mutedFg }]}>{label}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onChoose}
            disabled={!canChoose}
            style={({ pressed }) => [styles.cta, { backgroundColor: theme.foreground }, !canChoose && { backgroundColor: disabledBg }, pressed && styles.pressed]}
            accessibilityLabel={label}
          >
            <Text style={[styles.ctaText, { color: isDark(theme) ? theme.background : theme.background }]}>{label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  sheet: { width: "100%", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },

  headerZone: { paddingTop: 8, paddingBottom: 4 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  sheetTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10, gap: 12 },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: "500", letterSpacing: 0.3, marginBottom: 2 },
  title: { fontSize: 17, fontWeight: "600", letterSpacing: -0.3, lineHeight: 22 },
  close: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },

  tabsRow: { flexDirection: "row", gap: 20, paddingHorizontal: 20, paddingBottom: 0, borderBottomWidth: 1 },
  tab: { paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 4, position: "relative" },
  tabLabel: { fontSize: 13, fontWeight: "600" },
  tabCount: { fontSize: 10, fontWeight: "500" },
  tabIndicator: { position: "absolute", left: 0, right: 0, bottom: -1, height: 1 },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 5 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 30, gap: 6 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },

  card: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
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
  selectedPill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  selectedPillText: { fontSize: 8, fontWeight: "700", letterSpacing: 0.4 },
  cta: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 12, fontWeight: "600" },
});
