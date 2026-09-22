/**
 * Suivi en direct d'une livraison — la seule page de suivi de l'application.
 *
 * Elle reprend la maquette validée : la carte porte le contexte, une feuille à
 * trois paliers porte la réponse (quand, où, qui) et l'appel est à un doigt.
 * L'écran jumeau accessible depuis l'onglet du footer a été supprimé : deux
 * pages de suivi divergeaient sans jamais se rejoindre.
 */

import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeliveryRouteMap } from "@/components/tikis/delivery-route-map";
import { useApproachRoute, useRouteCoordinates } from "@/hooks/use-route-coordinates";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { formatDistanceKm } from "@/lib/date-format";
import { haptic } from "@/lib/haptics";
import { nextSheetLevel, sheetDragOffset, type SheetLevel } from "@/lib/sheet-gesture";
import {
  arrivalClockTime,
  buildMilestones,
  deliveryReference,
  describeSignalFreshness,
  formatCountdown,
  trackingStatusLabel,
  type Milestone,
  type SignalFreshness,
} from "@/lib/live-tracking-format";
import { useThemeColors, type ThemedColors } from "@/lib/use-theme-colors";
import { createStyles } from "@/lib/create-styles";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };
const fallbackId = "00000000-0000-4000-8000-000000000000";
const AVG_SPEED_KMH = 22;

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
/** Les trois paliers de la feuille, dans les proportions de la maquette. */
const SHEET_MIN_HEIGHT = 112;
const SHEET_MID_HEIGHT = Math.min(380, SCREEN_HEIGHT * 0.45);
const SHEET_FULL_HEIGHT = Math.min(640, SCREEN_HEIGHT * 0.78);


function sheetHeightFor(level: SheetLevel): number {
  return level === "mini" ? SHEET_MIN_HEIGHT : level === "mid" ? SHEET_MID_HEIGHT : SHEET_FULL_HEIGHT;
}

function haversineKm(a: Coordinate, b: Coordinate): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function etaMinutes(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / AVG_SPEED_KMH) * 60));
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Une horloge qui avance, cantonnée aux composants qui en ont besoin : faire
 *  battre la racine à la seconde re-rendrait la carte pour rien. */
function useNowTicker(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

/** La pastille du haut porte l'âge réel du dernier point GPS. « En direct » figé
 *  sur une position de dix minutes ment à l'expéditeur : au-delà d'une minute
 *  elle le dit. */
function SignalPill({ recordedAt, isTracking, theme }: { recordedAt: string | null; isTracking: boolean; theme: ThemedColors }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const now = useNowTicker(1_000, isTracking);
  const freshness: SignalFreshness = describeSignalFreshness(isTracking ? recordedAt : null, now);
  const tone = freshness.state === "live" ? theme.success : freshness.state === "weak" ? theme.warning : theme.muted;
  return (
    <View style={[styles.signalPill, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.signalDot, { backgroundColor: tone }]} />
      <Text style={[styles.signalLabel, { color: tone }]}>{freshness.label}</Text>
      {freshness.age ? <Text style={[styles.signalAge, { color: theme.muted }]} numberOfLines={1}>· {freshness.age}</Text> : null}
    </View>
  );
}

function TrackStep({ milestone, theme, last }: { milestone: Milestone; theme: ThemedColors; last?: boolean }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const isDone = milestone.state === "done";
  const isCurrent = milestone.state === "current";
  const reached = isDone || isCurrent;
  return (
    <View style={styles.trackStep}>
      <View
        style={[
          styles.trackStepBullet,
          { backgroundColor: reached ? theme.success : theme.surface, borderColor: reached ? theme.success : theme.border },
          isCurrent && { borderWidth: 4 },
        ]}
      >
        {isDone ? <MaterialIcons name="check" size={11} color="#FFFFFF" /> : null}
      </View>
      {!last ? <View style={[styles.trackStepLine, { backgroundColor: isDone ? theme.success : theme.border }]} /> : null}
      <Text style={[styles.trackStepLabel, { color: reached ? theme.foreground : theme.muted, fontWeight: isCurrent ? "700" : "600" }]}>
        {milestone.label}
      </Text>
      <Text style={[styles.trackStepTime, { color: theme.muted }]}>{milestone.time ?? "—"}</Text>
    </View>
  );
}

export default function DeliveryTrackingScreen() {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, role } = useTikisStore();

  const deliveryQuery = trpc.deliveries.get.useQuery(
    { id: id ?? fallbackId },
    { enabled: Boolean(id && profile?.phone), refetchInterval: 8_000 },
  );
  const delivery = deliveryQuery.data;
  const isLive = delivery?.status === "active";
  const livePosition = useLiveDeliveryPosition(delivery && isLive ? delivery.id : null, Boolean(delivery && isLive && role === "sender"));
  const driverStatsQuery = trpc.deliveries.driverStats.useQuery(
    { driverPhone: delivery?.driverPhone ?? "" },
    { enabled: Boolean(delivery?.driverPhone), refetchInterval: 60_000 },
  );

  // Itinéraire et approche passent par les hooks partagés avec la fiche de
  // livraison. Cet écran refaisait sa propre requête, dont la dépendance était
  // l'objet `delivery` : la requête de livraison se revalidant toutes les huit
  // secondes, un itinéraire était redemandé à la même cadence. Le quota de
  // `geography.route` s'épuisait, et c'est la fiche — un appel, un échec — qui
  // en payait le prix en retombant sur sa ligne droite au retour ici.
  const { coordinates, isLoading: isRouteLoading, hasFailed: routeError } = useRouteCoordinates(delivery?.pickup, delivery?.dropoff);
  const approach = useApproachRoute({
    from: livePosition,
    to: delivery?.pickup,
    enabled: delivery?.status === "active",
  });
  const [sheetLevel, setSheetLevel] = useState<SheetLevel>("mid");

  // === Glissement de la feuille ===
  // useState plutôt que useRef(...).current : une valeur Animated stable, créée une seule fois, lue
  // pendant le rendu (styles/PanResponder ci-dessous) — ce que le React Compiler interdit à un ref
  // (react-hooks/refs), pas à un state dont on n'appelle jamais le setter.
  const [panY] = useState(() => new Animated.Value(0));
  const [sheetBaseHeight] = useState(() => new Animated.Value(SHEET_MID_HEIGHT));
  const sheetLevelRef = useRef(sheetLevel);
  useEffect(() => { sheetLevelRef.current = sheetLevel; }, [sheetLevel]);

  useEffect(() => {
    // Animation temporelle et non ressort : sur React Native 0.86 (SDK 57) les
    // deux modèles de spring ne se mélangent pas, et `Animated.timing` évite
    // l'invariant qui faisait planter le relâchement du sheet.
    Animated.timing(sheetBaseHeight, {
      toValue: sheetHeightFor(sheetLevel),
      duration: 220,
      useNativeDriver: false,
    }).start();
    panY.setValue(0);
  }, [panY, sheetBaseHeight, sheetLevel]);

  // useState (initialiseur paresseux) plutôt que useRef(...).current : PanResponder.create est appelé
  // une seule fois, sa référence reste stable sur toute la vie du composant — un simple recalcul à
  // chaque rendu casserait un glissement en cours au prochain rafraîchissement de la position live
  // (toutes les ~2 s pendant une course active). `onPanResponderRelease` lit sheetLevelRef.current :
  // sûr, puisqu'il n'est jamais appelé pendant le rendu, seulement au relâchement du doigt — mais le
  // compilateur ne peut pas prouver statiquement que PanResponder.create n'invoque pas ses callbacks
  // immédiatement, d'où la désactivation ciblée ci-dessous.
  // eslint-disable-next-line react-hooks/refs -- lecture différée à l'événement, jamais pendant le rendu (cf. commentaire au-dessus)
  const [panResponder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderMove: (_, gesture) => { panY.setValue(sheetDragOffset(gesture.dy)); },
    onPanResponderRelease: (_, gesture) => {
      setSheetLevel(nextSheetLevel(sheetLevelRef.current, gesture.dy, gesture.vy));
      Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => { Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: false }).start(); },
  }));

  const sheetHeight = Animated.add(sheetBaseHeight, panY);

  const remainingKm = useMemo(() => {
    if (!livePosition || !delivery) return null;
    const target = delivery.status === "active" ? delivery.pickup : delivery.dropoff;
    if (target.latitude === undefined || target.longitude === undefined) return null;
    return haversineKm({ latitude: livePosition.latitude, longitude: livePosition.longitude }, { latitude: target.latitude, longitude: target.longitude });
  }, [delivery, livePosition]);
  const eta = remainingKm !== null ? etaMinutes(remainingKm) : 0;
  const isTracking = Boolean(isLive && livePosition);

  // L'heure d'arrivée se recalcule à la minute : la faire battre à la seconde
  // ferait clignoter un chiffre qui ne change pas.
  const nowMs = useNowTicker(30_000, isTracking);
  const arrivalClock = isTracking ? arrivalClockTime(eta, nowMs) : null;
  const countdown = isTracking ? formatCountdown(eta) : null;
  const remainingDistance = remainingKm !== null ? formatDistanceKm(remainingKm) : null;

  const milestones = useMemo<Milestone[]>(() => (delivery ? buildMilestones(delivery) : []), [delivery]);

  const callDriver = useCallback(async () => {
    if (!delivery?.driverPhone) return;
    haptic.light();
    const url = `tel:${delivery.driverPhone}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    // `[delivery]`, pas `[delivery?.driverPhone]` : le React Compiler infère la dépendance depuis
    // l'accès `delivery.driverPhone` ci-dessus (une fois vérifié non nul), pas depuis l'expression
    // optionnelle du tableau de dépendances — une mémoïsation manuelle plus étroite que ce qu'il
    // infère lui-même n'est jamais préservée.
  }, [delivery]);

  // Le suivi en direct est réservé aux expéditeurs : un livreur n'a jamais accès à cette page.
  if (role === "driver") {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <MaterialIcons name="lock-outline" size={32} color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.muted, marginTop: 10 }]}>Le suivi en direct est réservé aux expéditeurs.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }} accessibilityRole="button">
            <Text style={{ color: theme.primary, fontWeight: "700" }}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (deliveryQuery.isLoading || !delivery) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.muted }]}>
            {deliveryQuery.isLoading ? "Chargement du suivi…" : "Livraison introuvable."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const pickup = formatDeliveryDetailPlace(delivery.pickup);
  const dropoff = formatDeliveryDetailPlace(delivery.dropoff);
  const indicative = delivery.routeVisibility === "approximate";
  const driverStats = driverStatsQuery.data ?? null;
  const statusLabel = trackingStatusLabel(delivery.status, Boolean(delivery.driverName));
  const vehicleLabel = (delivery.vehicleTypes ?? []).join(" · ").toUpperCase() || "MOTO";

  /** Quand l'heure d'arrivée n'existe pas, on dit pourquoi plutôt que d'afficher
   *  un tiret : « pas encore de position » n'est pas une panne, c'est l'état le
   *  plus fréquent en début de course. */
  const notice: { tone: "info" | "warning" | "success"; icon: React.ComponentProps<typeof MaterialIcons>["name"]; text: string; short: string } | null = (() => {
    if (isTracking) return null;
    if (delivery.status === "active") {
      return {
        tone: "info",
        icon: "sensors-off",
        text: "Le téléphone du livreur n'a pas encore transmis sa position. Le trajet reste affiché : l'heure d'arrivée apparaîtra dès le premier point reçu.",
        short: "Position en attente",
      };
    }
    if (delivery.status === "pending_confirmation") {
      return {
        tone: "warning",
        icon: "hourglass-empty",
        text: `${delivery.driverName ?? "Le livreur"} doit confirmer sa disponibilité. Vous pouvez encore annuler le choix sans frais.`,
        short: "En attente de confirmation",
      };
    }
    if (delivery.status === "completed") {
      const delivered = milestones.find((milestone) => milestone.key === "completed")?.time;
      return { tone: "success", icon: "check-circle", text: delivered ? `Livrée à ${delivered}.` : "Course livrée.", short: delivered ? `Livrée à ${delivered}` : "Livrée" };
    }
    return { tone: "info", icon: "schedule", text: "Le suivi en direct démarrera dès qu'un livreur aura confirmé la course.", short: "Suivi pas encore démarré" };
  })();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.mapLayer}>
        <DeliveryRouteMap
          pickup={delivery.pickup}
          dropoff={delivery.dropoff}
          coordinates={coordinates}
          routeSource={delivery.routeSource}
          driverPosition={livePosition}
          approachCoordinates={approach}
          bottomInset={sheetHeightFor(sheetLevel)}
        />
        {isRouteLoading ? (
          <View style={[styles.routeLoading, { backgroundColor: theme.surface }]}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.routeLoadingText, { color: theme.muted }]}>Calcul de l’itinéraire…</Text>
          </View>
        ) : null}
      </View>

      <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarInner}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Retour"
            style={({ pressed }) => [styles.topBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.foreground} />
          </Pressable>
          <View style={styles.topBarCenter} pointerEvents="box-none">
            <SignalPill recordedAt={livePosition?.recordedAt ?? null} isTracking={Boolean(isLive)} theme={theme} />
          </View>
          <Pressable
            onPress={() => router.push(`/delivery/${delivery.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel="Ouvrir la fiche de la livraison"
            style={({ pressed }) => [styles.topBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}
          >
            <MaterialIcons name="receipt-long" size={18} color={theme.foreground} />
          </Pressable>
        </View>
      </SafeAreaView>

      <Animated.View style={[styles.sheetWrap, { height: sheetHeight, backgroundColor: theme.surface, borderColor: theme.border }]}>
        <SafeAreaView edges={["bottom"]} style={styles.sheetSafe}>
          <View {...panResponder.panHandlers} style={styles.dragZone} accessibilityRole="adjustable" accessibilityLabel="Glisser pour déplier le suivi">
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
          </View>

          {/* Palier replié : l'heure d'arrivée et l'appel, rien d'autre. Un palier
              ne doit jamais cacher ce dont on a besoin au palier précédent. */}
          {sheetLevel === "mini" ? (
            <View style={styles.miniBar}>
              <View style={styles.miniFigures}>
                {arrivalClock ? (
                  <>
                    <Text style={[styles.miniClock, { color: theme.foreground }]}>{arrivalClock}</Text>
                    <Text style={[styles.miniSub, { color: theme.muted }]} numberOfLines={1}>
                      {[countdown, remainingDistance ? `${remainingDistance.value} ${remainingDistance.unit}` : null].filter(Boolean).join(" · ")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.miniStatus, { color: theme.foreground }]} numberOfLines={1}>{notice?.short ?? statusLabel}</Text>
                    <Text style={[styles.miniSub, { color: theme.muted }]} numberOfLines={1}>
                      {`${formatDistanceKm(delivery.distanceKm).value} ${formatDistanceKm(delivery.distanceKm).unit} · ${formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}`}
                    </Text>
                  </>
                )}
              </View>
              {delivery.driverName && delivery.driverPhone ? (
                <Pressable
                  onPress={() => void callDriver()}
                  accessibilityRole="button"
                  accessibilityLabel={`Appeler ${delivery.driverName}`}
                  style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.success, borderColor: theme.success }, pressed && styles.pressed]}
                >
                  <MaterialIcons name="call" size={16} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
                <View style={styles.statusBlock}>
                  <View style={styles.statusHeader}>
                    <Text style={[styles.statusLabel, { color: theme.primary }]} numberOfLines={1}>{statusLabel}</Text>
                    <Text style={[styles.statusVehicle, { color: theme.muted }]} numberOfLines={1}>{vehicleLabel}</Text>
                  </View>

                  {arrivalClock ? (
                    <View style={styles.statusFigures}>
                      <View style={styles.statusFigureMain}>
                        <Text style={[styles.statusCaption, { color: theme.muted }]}>Arrivée estimée</Text>
                        <Text style={[styles.statusClock, { color: theme.foreground }]}>{arrivalClock}</Text>
                        {countdown ? <Text style={[styles.statusCountdown, { color: theme.muted }]}>{countdown}</Text> : null}
                      </View>
                      {remainingDistance ? (
                        <View style={styles.statusFigureSide}>
                          <Text style={[styles.statusDistance, { color: theme.foreground }]}>{remainingDistance.value} {remainingDistance.unit}</Text>
                          <Text style={[styles.statusCaption, { color: theme.muted }]}>Restants</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {notice ? (
                    <View
                      style={[
                        styles.notice,
                        {
                          backgroundColor: theme.background,
                          borderColor: notice.tone === "warning" ? theme.warning : notice.tone === "success" ? theme.success : theme.border,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={notice.icon}
                        size={16}
                        color={notice.tone === "warning" ? theme.warning : notice.tone === "success" ? theme.success : theme.muted}
                      />
                      <Text style={[styles.noticeText, { color: theme.muted }]}>{notice.text}</Text>
                    </View>
                  ) : null}

                  {indicative ? (
                    <View style={[styles.notice, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <MaterialIcons name="privacy-tip" size={16} color={theme.primary} />
                      <Text style={[styles.noticeText, { color: theme.muted }]}>
                        Aperçu indicatif : les coordonnées précises sont protégées jusqu’à la confirmation de la mission.
                      </Text>
                    </View>
                  ) : null}

                  {routeError ? (
                    <Text style={[styles.routeError, { color: theme.warning }]}>
                      Le tracé détaillé est indisponible. La liaison entre les deux points reste affichée.
                    </Text>
                  ) : null}
                </View>

                {/* Frise des jalons — chacun avec l'heure à laquelle il s'est produit. */}
                <View style={styles.trackTimeline}>
                  {milestones.map((milestone, index) => (
                    <TrackStep key={milestone.key} milestone={milestone} theme={theme} last={index === milestones.length - 1} />
                  ))}
                </View>

                {/* Le livreur, et l'appel juste à côté : c'est l'action qu'on cherche
                    quand quelque chose cloche pendant une course. */}
                {delivery.driverName ? (
                  <View style={[styles.driverCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    <View style={[styles.driverAvatar, { backgroundColor: theme.primary }]}>
                      <Text style={[styles.driverAvatarText, { color: theme.surface }]}>{getInitials(delivery.driverName)}</Text>
                    </View>
                    <View style={styles.driverIdentity}>
                      <Text style={[styles.driverName, { color: theme.foreground }]} numberOfLines={1}>{delivery.driverName}</Text>
                      <Text style={[styles.driverMeta, { color: theme.muted }]} numberOfLines={1}>
                        {driverStats && driverStats.reviewsCount > 0
                          ? `★ ${driverStats.rating.toFixed(1).replace(".", ",")} · ${driverStats.completedDeliveries} course${driverStats.completedDeliveries > 1 ? "s" : ""}`
                          : "Premières courses sur Tikis"}
                      </Text>
                    </View>
                    {delivery.driverPhone ? (
                      <Pressable
                        onPress={() => { void Linking.openURL(`sms:${delivery.driverPhone}`); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Envoyer un message à ${delivery.driverName}`}
                        style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}
                      >
                        <MaterialIcons name="chat-bubble-outline" size={16} color={theme.foreground} />
                      </Pressable>
                    ) : null}
                    {delivery.driverPhone ? (
                      <Pressable
                        onPress={() => void callDriver()}
                        accessibilityRole="button"
                        accessibilityLabel={`Appeler ${delivery.driverName}`}
                        style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.success, borderColor: theme.success }, pressed && styles.pressed]}
                      >
                        <MaterialIcons name="call" size={16} color="#FFFFFF" />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {sheetLevel === "full" ? (
                  <>
                    <View style={styles.tripInfo}>
                      <View style={styles.tripRow}>
                        <View style={[styles.tripDot, { backgroundColor: theme.primary }]} />
                        <View style={styles.tripText}>
                          <Text style={[styles.tripLabel, { color: theme.muted }]}>Récupération</Text>
                          <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{pickup.title}</Text>
                          <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>{pickup.subtitle}</Text>
                        </View>
                      </View>
                      <View style={[styles.tripRail, { backgroundColor: theme.border }]} />
                      <View style={styles.tripRow}>
                        <View style={[styles.tripDot, { backgroundColor: theme.error }]} />
                        <View style={styles.tripText}>
                          <Text style={[styles.tripLabel, { color: theme.muted }]}>Destination</Text>
                          <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{dropoff.title}</Text>
                          <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>{dropoff.subtitle}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Montant, trajet et référence : ce qu'on cherche une fois, pas ce
                        qu'on regarde pendant la course. Donc au palier déployé seulement. */}
                    <View style={styles.facts}>
                      <View style={[styles.fact, { backgroundColor: theme.background, borderColor: theme.border }]}>
                        <Text style={[styles.factLabel, { color: theme.muted }]}>Montant</Text>
                        <Text style={[styles.factValue, { color: theme.foreground }]}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
                      </View>
                      <View style={[styles.fact, { backgroundColor: theme.background, borderColor: theme.border }]}>
                        <Text style={[styles.factLabel, { color: theme.muted }]}>Trajet</Text>
                        <Text style={[styles.factValue, { color: theme.foreground }]}>
                          {formatDistanceKm(delivery.distanceKm).value} {formatDistanceKm(delivery.distanceKm).unit}
                        </Text>
                      </View>
                      <View style={[styles.fact, styles.factWide, { backgroundColor: theme.background, borderColor: theme.border }]}>
                        <Text style={[styles.factLabel, { color: theme.muted }]}>Référence</Text>
                        <Text style={[styles.factValue, { color: theme.foreground }]}>{deliveryReference(delivery.id)}</Text>
                      </View>
                    </View>
                    <Text style={[styles.paymentNote, { color: theme.muted }]}>
                      Vous réglerez directement le livreur à la remise. Tikis ne prélève rien sur ce montant.
                    </Text>
                  </>
                ) : null}
              </ScrollView>

              <View style={[styles.sheetActions, { borderTopColor: theme.border }]}>
                <Pressable
                  onPress={() => router.push(`/delivery/${delivery.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel="Ouvrir la fiche de la livraison"
                  style={({ pressed }) => [styles.sheetBtn, { backgroundColor: theme.background, borderColor: theme.border }, pressed && styles.pressed]}
                >
                  <MaterialIcons name="receipt-long" size={14} color={theme.foreground} />
                  <Text style={[styles.sheetBtnText, { color: theme.foreground }]}>Détails</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/report/${delivery.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel="Signaler un problème"
                  style={({ pressed }) => [styles.sheetBtn, { backgroundColor: theme.background, borderColor: theme.border }, pressed && styles.pressed]}
                >
                  <MaterialIcons name="flag" size={14} color={theme.foreground} />
                  <Text style={[styles.sheetBtnText, { color: theme.foreground }]}>Signaler</Text>
                </Pressable>
              </View>
            </>
          )}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const stylesFor = createStyles((theme: ThemedColors) => ({
  root: { flex: 1 },
  safe: { flex: 1 },
  mapLayer: { flex: 1, position: "relative" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 9, padding: 18 },
  loadingText: { fontWeight: "500" },
  pressed: { opacity: 0.7 },

  routeLoading: { position: "absolute", top: 76, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 8 },
  routeLoadingText: { fontSize: 11, fontWeight: "600" },
  routeError: { fontSize: 11, lineHeight: 16 },

  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topBarInner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  topBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  topBarCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  signalPill: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%", paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  signalDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  signalLabel: { fontSize: 12.5, fontWeight: "700" },
  signalAge: { fontSize: 11.5, fontWeight: "500", flexShrink: 1 },

  sheetWrap: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sheetSafe: { flex: 1 },
  dragZone: { paddingTop: 10, paddingBottom: 6, alignItems: "center" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2 },
  sheetScroll: { flex: 1 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },

  miniBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 2 },
  miniFigures: { flex: 1, minWidth: 0 },
  miniClock: { fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  miniStatus: { fontSize: 13, fontWeight: "700" },
  miniSub: { fontSize: 11.5, marginTop: 2 },

  statusBlock: { paddingTop: 2, gap: 8 },
  statusHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statusLabel: { flexShrink: 1, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6 },
  statusVehicle: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, flexShrink: 0 },
  statusFigures: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  statusFigureMain: { flexShrink: 1, minWidth: 0 },
  statusFigureSide: { alignItems: "flex-end", flexShrink: 0 },
  statusCaption: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  statusClock: { fontSize: 34, fontWeight: "700", lineHeight: 40, fontVariant: ["tabular-nums"] },
  statusCountdown: { fontSize: 12.5 },
  statusDistance: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  noticeText: { flex: 1, fontSize: 11.5, lineHeight: 16 },

  trackTimeline: { flexDirection: "row", alignItems: "flex-start", marginTop: 2 },
  trackStep: { flex: 1, alignItems: "center", position: "relative" },
  trackStepBullet: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 4, zIndex: 1 },
  trackStepLine: { position: "absolute", top: 11, left: "50%", right: "-50%", height: 2 },
  trackStepLabel: { fontSize: 9.5, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: "600" },
  trackStepTime: { fontSize: 10.5, marginTop: 2, fontVariant: ["tabular-nums"] },

  driverCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  driverAvatarText: { fontSize: 13, fontWeight: "700" },
  driverIdentity: { flex: 1, minWidth: 0 },
  driverName: { fontSize: 14, fontWeight: "700" },
  driverMeta: { fontSize: 11.5, marginTop: 2 },
  driverAction: { width: 38, height: 38, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  tripInfo: { position: "relative" },
  tripRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8 },
  tripRail: { position: "absolute", left: 4.5, top: 22, bottom: 22, width: 1 },
  tripDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  tripText: { flex: 1, minWidth: 0 },
  tripLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  tripValue: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  tripAddress: { fontSize: 12, marginTop: 2 },

  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexGrow: 1, flexBasis: "45%", minWidth: 0, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  factWide: { flexBasis: "100%" },
  factLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  factValue: { fontSize: 13, fontWeight: "700", marginTop: 3, fontVariant: ["tabular-nums"] },
  paymentNote: { fontSize: 11, lineHeight: 16 },

  sheetActions: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  sheetBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 11, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, gap: 5 },
  sheetBtnText: { fontSize: 12.5, fontWeight: "600" },
}));
