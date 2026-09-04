import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import type { DeliveryStatus } from "@/shared/tikis-domain";
import { formatMoney } from "@/shared/tikis-domain";

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimateEtaMinutes(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  const avgSpeedKmh = 22;
  return Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
}

const MAP_INSET = 0.18;

function projectToMapPercent(
  point: { lat: number; lng: number },
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): { left: number; top: number } {
  const latRange = bounds.maxLat - bounds.minLat || 0.0001;
  const lngRange = bounds.maxLng - bounds.minLng || 0.0001;
  const yRatio = (bounds.maxLat - point.lat) / latRange;
  const xRatio = (point.lng - bounds.minLng) / lngRange;
  const leftPct = MAP_INSET + xRatio * (1 - 2 * MAP_INSET) * 100;
  const topPct = MAP_INSET + yRatio * (1 - 2 * MAP_INSET) * 100;
  return {
    left: Math.max(0, Math.min(100, leftPct)),
    top: Math.max(0, Math.min(100, topPct)),
  };
}

type LiveStep = "published" | "selected" | "pickup" | "delivered";

const TIMELINE_STEPS: { key: LiveStep; label: string; icon: ComponentProps<typeof MaterialIcons>["name"] }[] = [
  { key: "published", label: "Publiée", icon: "campaign" },
  { key: "selected", label: "Attribuée", icon: "assignment-ind" },
  { key: "pickup", label: "Récupérée", icon: "inventory-2" },
  { key: "delivered", label: "Livrée", icon: "check-circle" },
];

function deriveStep(status: DeliveryStatus, hasDriver: boolean): LiveStep {
  if (status === "open") return "published";
  if (status === "pending_confirmation") return "selected";
  if (status === "active") return "pickup";
  return "delivered";
}

function stepIndex(step: LiveStep): number {
  return TIMELINE_STEPS.findIndex((s) => s.key === step);
}

type Props = {
  deliveryId: string;
  status: DeliveryStatus;
  driverName?: string;
  driverPhone?: string;
  driverRating?: number | null;
  driverVehicle?: string;
  driverPlate?: string;
  pickupName: string;
  pickupAddress: string;
  pickupTime?: string;
  dropoffName: string;
  dropoffAddress: string;
  offeredPrice: number;
  senderName?: string;
  senderPhone?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  driverLat?: number | null;
  driverLng?: number | null;
  driverHeading?: number | null;
  recentEvents?: { id: string; title: string; time: string; tone?: "live" | "past" }[];
  onOpenMap: () => void;
  onReport?: () => void;
  onCallDriver?: () => void;
  onMessageDriver?: () => void;
  children?: ReactNode;
};

export function LiveTrackingView({
  deliveryId,
  status,
  driverName,
  driverPhone,
  driverRating,
  driverVehicle,
  driverPlate,
  pickupName,
  pickupAddress,
  pickupTime,
  dropoffName,
  dropoffAddress,
  offeredPrice,
  senderName,
  senderPhone,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  driverLat,
  driverLng,
  driverHeading,
  recentEvents,
  onOpenMap,
  onReport,
  onCallDriver,
  onMessageDriver,
  children,
}: Props) {
  const { colors: theme, isDark } = useThemeColors();
  const router = useRouter();
  const currentStep = useMemo(() => deriveStep(status, Boolean(driverPhone)), [status, driverPhone]);
  const currentStepIdx = stepIndex(currentStep);
  const isLive = status === "pending_confirmation" || status === "active";
  const isWaiting = status === "open";
  const isCompleted = status === "completed";

  const computedRoute = useMemo(() => {
    if (typeof pickupLat === "number" && typeof pickupLng === "number" && typeof dropoffLat === "number" && typeof dropoffLng === "number") {
      const totalKm = haversineKm({ lat: pickupLat, lng: pickupLng }, { lat: dropoffLat, lng: dropoffLng });
      let remainingKm: number;
      if (typeof driverLat === "number" && typeof driverLng === "number") {
        remainingKm = haversineKm({ lat: driverLat, lng: driverLng }, { lat: dropoffLat, lng: dropoffLng });
      } else {
        remainingKm = totalKm;
      }
      return { totalKm, remainingKm };
    }
    return null;
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, driverLat, driverLng]);

  const markerPositions = useMemo(() => {
    if (typeof pickupLat !== "number" || typeof pickupLng !== "number" || typeof dropoffLat !== "number" || typeof dropoffLng !== "number") {
      return null;
    }
    const points: { lat: number; lng: number }[] = [
      { lat: pickupLat, lng: pickupLng },
      { lat: dropoffLat, lng: dropoffLng },
    ];
    if (typeof driverLat === "number" && typeof driverLng === "number") {
      points.push({ lat: driverLat, lng: driverLng });
    }
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latPad = (maxLat - minLat) * 0.25 || 0.005;
    const lngPad = (maxLng - minLng) * 0.25 || 0.005;
    const bounds = {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    };
    const pickupPos = projectToMapPercent({ lat: pickupLat, lng: pickupLng }, bounds);
    const dropoffPos = projectToMapPercent({ lat: dropoffLat, lng: dropoffLng }, bounds);
    const driverPos = typeof driverLat === "number" && typeof driverLng === "number"
      ? projectToMapPercent({ lat: driverLat, lng: driverLng }, bounds)
      : null;
    return { pickup: pickupPos, dropoff: dropoffPos, driver: driverPos };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, driverLat, driverLng]);

  const driverTrail = useMemo(() => {
    if (!markerPositions?.driver) return null;
    const dxPct = markerPositions.dropoff.left - markerPositions.driver.left;
    const dyPct = markerPositions.dropoff.top - markerPositions.driver.top;
    const lengthPct = Math.sqrt(dxPct * dxPct + dyPct * dyPct);
    const angleDeg = Math.atan2(dyPct, dxPct) * (180 / Math.PI);
    return { lengthPct, angleDeg, left: markerPositions.driver.left, top: markerPositions.driver.top };
  }, [markerPositions]);

  const [etaTick, setEtaTick] = useState(0);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isLive) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isLive, pulseAnim]);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setEtaTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [isLive]);

  const displayKm = computedRoute ? computedRoute.remainingKm : 0;
  const displayEta = computedRoute ? estimateEtaMinutes(computedRoute.remainingKm) : 0;
  void etaTick;

  const ringScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.7] });
  const ringOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  const statusLabel = isWaiting ? "Recherche d'un livreur" : isCompleted ? "Livraison terminée" : status === "pending_confirmation" ? "Livreur en route vers le pickup" : "Livreur en route vers la destination";
  const statusMeta = isWaiting ? "2 min" : isCompleted ? "Terminée" : "Live";

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]} accessibilityLabel="Retour">
            <MaterialIcons name="arrow-back" size={18} color={theme.foreground} />
          </Pressable>
          <View style={[styles.statusPill, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {isLive ? <View style={[styles.statusPulse, { backgroundColor: theme.success }]} /> : <View style={[styles.statusPulse, { backgroundColor: isCompleted ? theme.muted : theme.primary }]} />}
            <Text style={[styles.statusPillText, { color: theme.foreground }]} numberOfLines={1}>{statusLabel}</Text>
            <Text style={[styles.statusPillMeta, { color: theme.muted }]}>{statusMeta}</Text>
          </View>
          <Pressable onPress={onOpenMap} style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]} accessibilityLabel="Ouvrir la carte">
            <MaterialIcons name="my-location" size={18} color={theme.primary} />
          </Pressable>
        </View>

        <View style={[styles.mapCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.mapInner}>
            <View style={[styles.mapBg, { backgroundColor: isDark ? "#1A1611" : theme.primary + "14" }]}>
              <View style={[styles.mapGrid, { borderColor: theme.primary + "0F" }]} />
              <View style={[styles.mapRoad, styles.mapRoad1, { backgroundColor: theme.surface }]} />
              <View style={[styles.mapRoad, styles.mapRoad2, { backgroundColor: theme.surface }]} />
              <View style={[styles.mapRoad, styles.mapRoad3, { backgroundColor: theme.surface }]} />
              <View style={[styles.mapBlock, styles.mapBlockA, { backgroundColor: theme.surface, borderColor: theme.primary + "0F" }]} />
              <View style={[styles.mapBlock, styles.mapBlockB, { backgroundColor: theme.surface, borderColor: theme.primary + "0F" }]} />
              <View style={[styles.mapBlock, styles.mapBlockC, { backgroundColor: theme.surface, borderColor: theme.primary + "0F" }]} />

              {isLive ? (
                <>
                  <View style={[styles.routeLine, { backgroundColor: theme.success }]} />
                  <View style={[styles.routeLinePending, { backgroundColor: theme.primary }]} />
                </>
              ) : isWaiting ? (
                <View style={[styles.routeLine, { backgroundColor: theme.muted, opacity: 0.3 }]} />
              ) : (
                <View style={[styles.routeLine, { backgroundColor: theme.success }]} />
              )}

              {isLive ? (
                <>
                  {markerPositions ? (
                    <>
                      <View style={[styles.markerWrap, { top: `${markerPositions.pickup.top}%`, left: `${markerPositions.pickup.left}%` }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerPickup, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                          <MaterialIcons name="check" size={14} color="#FFFFFF" />
                        </View>
                      </View>
                      <View style={[styles.markerWrap, { top: `${markerPositions.dropoff.top}%`, left: `${markerPositions.dropoff.left}%` }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerDest, { backgroundColor: theme.error, borderColor: theme.surface }]}>
                          <MaterialIcons name="place" size={16} color="#FFFFFF" />
                        </View>
                      </View>
                      {markerPositions.driver ? (
                        <>
                          {driverTrail ? (
                            <View
                              pointerEvents="none"
                              style={[
                                styles.driverTrail,
                                {
                                  top: `${driverTrail.top}%`,
                                  left: `${driverTrail.left}%`,
                                  width: `${driverTrail.lengthPct}%`,
                                  backgroundColor: theme.primary,
                                  transform: [{ translateY: -1 }, { rotate: `${driverTrail.angleDeg}deg` }, { translateX: 0 }],
                                },
                              ]}
                            />
                          ) : null}
                          <View style={[styles.markerWrap, { top: `${markerPositions.driver.top}%`, left: `${markerPositions.driver.left}%` }]}>
                            <View style={[styles.markerShadow]} />
                            <Animated.View style={[styles.markerPulse, { backgroundColor: theme.primary, transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
                            <View style={[styles.markerDriver, { backgroundColor: theme.primary, borderColor: theme.surface, transform: [{ rotate: typeof driverHeading === "number" ? `${driverHeading}deg` : "0deg" }] }]}>
                              <MaterialIcons name="navigation" size={18} color="#FFFFFF" />
                            </View>
                          </View>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <View style={[styles.markerWrap, { top: 32, left: "32%" }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerPickup, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                          <MaterialIcons name="check" size={14} color="#FFFFFF" />
                        </View>
                      </View>
                      <View style={[styles.markerWrap, { top: "50%", left: "55%" }]}>
                        <View style={[styles.markerShadow]} />
                        <Animated.View style={[styles.markerPulse, { backgroundColor: theme.primary, transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
                        <View style={[styles.markerDriver, { backgroundColor: theme.primary, borderColor: theme.surface }]}>
                          <MaterialIcons name="two-wheeler" size={18} color="#FFFFFF" />
                        </View>
                      </View>
                      <View style={[styles.markerWrap, { top: "82%", left: "65%" }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerDest, { backgroundColor: theme.error, borderColor: theme.surface }]}>
                          <MaterialIcons name="place" size={16} color="#FFFFFF" />
                        </View>
                      </View>
                    </>
                  )}
                </>
              ) : isWaiting ? (
                <View style={[styles.markerWrap, { top: "50%", left: "50%" }]}>
                  <View style={[styles.markerShadow]} />
                  <Animated.View style={[styles.markerPulse, { backgroundColor: theme.primary, transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
                  <View style={[styles.markerDriver, { backgroundColor: theme.primary, borderColor: theme.surface }]}>
                    <MaterialIcons name="search" size={20} color="#FFFFFF" />
                  </View>
                </View>
              ) : (
                <>
                  {markerPositions ? (
                    <>
                      <View style={[styles.markerWrap, { top: `${markerPositions.pickup.top}%`, left: `${markerPositions.pickup.left}%` }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerPickup, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                          <MaterialIcons name="check" size={14} color="#FFFFFF" />
                        </View>
                      </View>
                      <View style={[styles.markerWrap, { top: `${markerPositions.dropoff.top}%`, left: `${markerPositions.dropoff.left}%` }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerDest, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                          <MaterialIcons name="check" size={16} color="#FFFFFF" />
                        </View>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={[styles.markerWrap, { top: "32%", left: "32%" }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerPickup, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                          <MaterialIcons name="check" size={14} color="#FFFFFF" />
                        </View>
                      </View>
                      <View style={[styles.markerWrap, { top: "82%", left: "65%" }]}>
                        <View style={[styles.markerShadow]} />
                        <View style={[styles.markerDest, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                          <MaterialIcons name="check" size={16} color="#FFFFFF" />
                        </View>
                      </View>
                    </>
                  )}
                </>
              )}

              <View style={[styles.mapControlStack, { top: 12, right: 12 }]}>
                <Pressable style={({ pressed }) => [styles.mapControl, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}>
                  <MaterialIcons name="zoom-in" size={16} color={theme.foreground} />
                </Pressable>
                <Pressable style={({ pressed }) => [styles.mapControl, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}>
                  <MaterialIcons name="my-location" size={16} color={theme.foreground} />
                </Pressable>
              </View>
            </View>
          </View>

          {isLive ? (
            <View style={styles.etaBar}>
              <View style={styles.etaLeft}>
                <Text style={[styles.etaLabel, { color: theme.muted }]}>Arrivée estimée</Text>
                <View style={styles.etaValueRow}>
                  <Text style={[styles.etaValue, { color: theme.foreground }]}>{displayEta}</Text>
                  <Text style={[styles.etaUnit, { color: theme.muted }]}>min</Text>
                </View>
              </View>
              <View style={styles.etaRight}>
                <View style={[styles.etaStatIcon, { backgroundColor: theme.primary + "22" }]}>
                  <MaterialIcons name="arrow-forward" size={12} color={theme.primary} />
                </View>
                <View>
                  <Text style={[styles.etaStatValue, { color: theme.foreground }]}>{displayKm < 0.1 ? "< 100 m" : `${displayKm.toFixed(1).replace(".", ",")} km`}</Text>
                  <Text style={[styles.etaStatLabel, { color: theme.muted }]}>restants</Text>
                </View>
              </View>
            </View>
          ) : isWaiting ? (
            <View style={[styles.waitingBar, { backgroundColor: theme.primary + "14", borderColor: theme.primary + "33" }]}>
              <View style={[styles.waitingEmoji, { backgroundColor: theme.primary + "22" }]}>
                <MaterialIcons name="hourglass-top" size={20} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.waitingTitle, { color: theme.foreground }]}>3 livreurs ont vu votre course</Text>
                <Text style={[styles.waitingDesc, { color: theme.muted }]}>Temps d'attente habituel : 3-5 min</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.waitingBar, { backgroundColor: theme.success + "14", borderColor: theme.success + "33" }]}>
              <View style={[styles.waitingEmoji, { backgroundColor: theme.success + "22" }]}>
                <MaterialIcons name="celebration" size={20} color={theme.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.waitingTitle, { color: theme.foreground }]}>Livraison terminée</Text>
                <Text style={[styles.waitingDesc, { color: theme.muted }]}>Vous pouvez évaluer le livreur</Text>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.timelineCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.timelineBar, { backgroundColor: theme.border }]} />
          <View style={[styles.timelineProgress, { width: `${(currentStepIdx / (TIMELINE_STEPS.length - 1)) * 100}%`, backgroundColor: theme.success }]} />
          {TIMELINE_STEPS.map((step, idx) => {
            const done = idx < currentStepIdx;
            const active = idx === currentStepIdx;
            return (
              <View key={step.key} style={styles.timelineStep}>
                <View style={[
                  styles.timelineDot,
                  { backgroundColor: done ? theme.success : active ? theme.primary : theme.surface, borderColor: done ? theme.success : active ? theme.primary : theme.border },
                ]}>
                  {done ? <MaterialIcons name="check" size={12} color="#FFFFFF" /> : active ? <View style={[styles.timelineDotInner, { backgroundColor: "#FFFFFF" }]} /> : <MaterialIcons name={step.icon} size={11} color={theme.muted} />}
                </View>
                <Text style={[styles.timelineLabel, { color: done ? theme.success : active ? theme.primary : theme.muted }]} numberOfLines={1}>{step.label}</Text>
              </View>
            );
          })}
        </View>

        {isLive && driverName ? (
          <View style={[styles.driverCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.driverAvatar, { backgroundColor: theme.primary }]}>
              <Text style={styles.driverAvatarText}>{getInitials(driverName)}</Text>
              <View style={[styles.driverVerified, { backgroundColor: theme.success, borderColor: theme.surface }]}>
                <MaterialIcons name="check" size={9} color="#FFFFFF" />
              </View>
            </View>
            <View style={styles.driverInfo}>
              <Text style={[styles.driverName, { color: theme.foreground }]} numberOfLines={1}>{driverName}</Text>
              <View style={styles.driverMetaRow}>
                {driverRating && driverRating > 0 ? (
                  <>
                    <MaterialIcons name="star" size={11} color={theme.warning} />
                    <Text style={[styles.driverMeta, { color: theme.foreground }]}>{driverRating.toFixed(1).replace(".", ",")}</Text>
                    <Text style={[styles.driverDot, { color: theme.muted }]}>·</Text>
                  </>
                ) : null}
                <Text style={[styles.driverMeta, { color: theme.muted }]} numberOfLines={1}>
                  {driverVehicle ?? "Livreur"}{driverPlate ? ` · ${driverPlate}` : ""}
                </Text>
              </View>
            </View>
            <View style={styles.driverActions}>
              {driverPhone ? (
                <Pressable
                  onPress={onCallDriver ?? (() => Linking.openURL(`tel:${driverPhone}`).catch(() => undefined))}
                  style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
                  accessibilityLabel="Appeler le livreur"
                >
                  <MaterialIcons name="phone" size={16} color={theme.foreground} />
                </Pressable>
              ) : null}
              {driverPhone ? (
                <Pressable
                  onPress={onMessageDriver ?? (() => Linking.openURL(`sms:${driverPhone}`).catch(() => undefined))}
                  style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.primary }, pressed && { opacity: 0.7 }]}
                  accessibilityLabel="Envoyer un message"
                >
                  <MaterialIcons name="chat-bubble" size={16} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={[styles.routeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.routeStops}>
            <View style={styles.routeStop}>
              <View style={[styles.routePin, { backgroundColor: theme.success, borderColor: theme.surface }]} />
              <View style={styles.routeStopBody}>
                <Text style={[styles.routeStopLabel, { color: theme.muted }]}>Récupération</Text>
                <Text style={[styles.routeStopName, { color: theme.foreground }]} numberOfLines={1}>{pickupName}</Text>
                <Text style={[styles.routeStopAddr, { color: theme.muted }]} numberOfLines={1}>{pickupAddress}</Text>
                {pickupTime ? <Text style={[styles.routeStopTime, { color: theme.muted }]}>Récupérée {pickupTime}</Text> : null}
              </View>
            </View>
            <View style={[styles.routeLineConnector, { backgroundColor: theme.border }]} />
            <View style={styles.routeStop}>
              <View style={[styles.routePin, { backgroundColor: theme.error, borderColor: theme.surface }]} />
              <View style={styles.routeStopBody}>
                <Text style={[styles.routeStopLabel, { color: theme.muted }]}>Destination</Text>
                <Text style={[styles.routeStopName, { color: theme.foreground }]} numberOfLines={1}>{dropoffName}</Text>
                <Text style={[styles.routeStopAddr, { color: theme.muted }]} numberOfLines={1}>{dropoffAddress}</Text>
                {senderName ? <Text style={[styles.routeStopTime, { color: theme.muted }]}>Pour {senderName}</Text> : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.detailGrid}>
          <View style={[styles.detailCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.detailIcon, { backgroundColor: theme.primary + "22" }]}>
              <MaterialIcons name="payments" size={14} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.detailLabel, { color: theme.muted }]}>Montant</Text>
              <Text style={[styles.detailValue, { color: theme.foreground }]}>{formatMoney(offeredPrice)}</Text>
            </View>
          </View>
          <View style={[styles.detailCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.detailIcon, { backgroundColor: theme.primary + "22" }]}>
              <MaterialIcons name="confirmation-number" size={14} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.detailLabel, { color: theme.muted }]}>Référence</Text>
              <Text style={[styles.detailValue, { color: theme.foreground }]} numberOfLines={1}>{deliveryId.slice(0, 8).toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {isLive ? (
          <View style={styles.actionRow}>
            {onReport ? (
              <Pressable onPress={onReport} style={({ pressed }) => [styles.actionBtn, styles.actionBtnSecondary, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}>
                <MaterialIcons name="flag" size={16} color={theme.foreground} />
                <Text style={[styles.actionBtnText, { color: theme.foreground }]}>Signaler</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onOpenMap} style={({ pressed }) => [styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: theme.primary }, pressed && { opacity: 0.85 }]}>
              <MaterialIcons name="map" size={16} color="#FFFFFF" />
              <Text style={[styles.actionBtnText, { color: "#FFFFFF" }]}>Voir l'itinéraire</Text>
            </Pressable>
          </View>
        ) : isWaiting ? (
          <View style={[styles.noticeCard, { backgroundColor: theme.primary + "10", borderColor: theme.primary + "33" }]}>
            <MaterialIcons name="info" size={14} color={theme.primary} />
            <Text style={[styles.noticeText, { color: theme.foreground }]}>La course expire automatiquement si aucun livreur n'accepte sous 24h.</Text>
          </View>
        ) : null}

        {recentEvents && recentEvents.length > 0 ? (
          <View style={[styles.activityCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.activityTitle, { color: theme.muted }]}>Activité récente</Text>
            {recentEvents.slice(0, 5).map((evt) => (
              <View key={evt.id} style={styles.activityItem}>
                <View style={[styles.activityBullet, { backgroundColor: evt.tone === "past" ? theme.muted : theme.primary }]} />
                <Text style={[styles.activityText, { color: theme.foreground }]} numberOfLines={1}>{evt.title}</Text>
                <Text style={[styles.activityTime, { color: theme.muted }]}>{evt.time}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {children}
      </ScrollView>
    </View>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 36, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  statusPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 38, borderRadius: 99, borderWidth: 1 },
  statusPulse: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { flex: 1, fontSize: 12, fontWeight: "600" },
  statusPillMeta: { fontSize: 10, fontWeight: "500" },

  mapCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  mapInner: { height: 240, position: "relative" },
  mapBg: { flex: 1, position: "relative" },
  mapGrid: { position: "absolute", inset: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "transparent" },
  mapRoad: { position: "absolute", borderRadius: 3 },
  mapRoad1: { top: 50, left: -10, right: -10, height: 14, transform: [{ rotate: "-10deg" }] },
  mapRoad2: { top: 110, left: 30, width: 12, bottom: 30, transform: [{ rotate: "5deg" }] },
  mapRoad3: { bottom: 30, left: "30%", right: 10, height: 10, transform: [{ rotate: "2deg" }] },
  mapBlock: { position: "absolute", borderRadius: 3, borderWidth: 1 },
  mapBlockA: { top: 16, left: 16, width: 60, height: 40 },
  mapBlockB: { top: 16, right: 50, width: 50, height: 36 },
  mapBlockC: { bottom: 50, left: 30, width: 70, height: 50 },
  routeLine: { position: "absolute", top: 30, left: "50%", width: 3, height: 180, transform: [{ translateX: -1.5 }, { rotate: "8deg" }], borderRadius: 99, opacity: 0.9 },
  routeLinePending: { position: "absolute", top: 110, left: "50%", width: 3, height: 100, transform: [{ translateX: -1.5 }, { rotate: "8deg" }], borderRadius: 99, opacity: 0.9 },

  markerWrap: { position: "absolute", alignItems: "center", transform: [{ translateX: -22 }, { translateY: -28 }] },
  markerShadow: { position: "absolute", bottom: 0, width: 22, height: 6, backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 11, transform: [{ translateY: 3 }] },
  markerPickup: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  markerDriver: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 4 },
  markerDest: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  markerPulse: { position: "absolute", width: 56, height: 56, borderRadius: 28 },

  mapControlStack: { position: "absolute", flexDirection: "column", gap: 6 },
  mapControl: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1 },

  etaBar: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", padding: 14, borderTopWidth: 1, borderTopColor: "transparent" },
  etaLeft: { gap: 2 },
  etaLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  etaValueRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  etaValue: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6 },
  etaUnit: { fontSize: 13, fontWeight: "500" },
  etaRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  etaStatIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  etaStatValue: { fontSize: 13, fontWeight: "600" },
  etaStatLabel: { fontSize: 9, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },

  waitingBar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, margin: 8, borderRadius: 12, borderWidth: 1 },
  waitingEmoji: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  waitingTitle: { fontSize: 13, fontWeight: "600" },
  waitingDesc: { fontSize: 11, marginTop: 1 },

  driverTrail: { position: "absolute", height: 2, borderRadius: 1, opacity: 0.65, transformOrigin: "left center" as const },

  timelineCard: { flexDirection: "row", alignItems: "stretch", position: "relative", padding: 12, borderRadius: 14, borderWidth: 1, height: 64 },
  timelineBar: { position: "absolute", top: 28, left: 36, right: 36, height: 2, borderRadius: 1 },
  timelineProgress: { position: "absolute", top: 28, left: 36, height: 2, borderRadius: 1 },
  timelineStep: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  timelineDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  timelineDotInner: { width: 6, height: 6, borderRadius: 3 },
  timelineLabel: { fontSize: 9, fontWeight: "600", textAlign: "center", letterSpacing: 0.3, textTransform: "uppercase" },

  driverCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  driverAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", position: "relative" },
  driverAvatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  driverVerified: { position: "absolute", bottom: -1, right: -1, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  driverInfo: { flex: 1, minWidth: 0 },
  driverName: { fontSize: 13, fontWeight: "600" },
  driverMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  driverMeta: { fontSize: 10, fontWeight: "500" },
  driverDot: { fontSize: 10 },
  driverActions: { flexDirection: "row", gap: 6 },
  driverAction: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },

  routeCard: { padding: 12, borderRadius: 14, borderWidth: 1 },
  routeStops: { gap: 0 },
  routeStop: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  routeLineConnector: { width: 2, height: 18, marginLeft: 7 },
  routePin: { width: 16, height: 16, borderRadius: 8, marginTop: 2, borderWidth: 3 },
  routeStopBody: { flex: 1, minWidth: 0 },
  routeStopLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 },
  routeStopName: { fontSize: 13, fontWeight: "600" },
  routeStopAddr: { fontSize: 11, marginTop: 1 },
  routeStopTime: { fontSize: 10, marginTop: 2, fontStyle: "italic" },

  detailGrid: { flexDirection: "row", gap: 8 },
  detailCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
  detailIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  detailLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  detailValue: { fontSize: 12, fontWeight: "600" },

  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actionBtnSecondary: { borderWidth: 1 },
  actionBtnPrimary: {},
  actionBtnText: { fontSize: 13, fontWeight: "600" },

  noticeCard: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16 },

  activityCard: { padding: 12, borderRadius: 14, borderWidth: 1, gap: 6 },
  activityTitle: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 },
  activityItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  activityBullet: { width: 6, height: 6, borderRadius: 3 },
  activityText: { flex: 1, fontSize: 11 },
  activityTime: { fontSize: 10, fontWeight: "500" },
});
