import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LiveMap } from "@/components/tikis/live-map";
import { type TrackingEvent } from "@/lib/gps-simulator";
import { TikisButton } from "@/components/tikis/ui";
import { formatNavigationTarget } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryStatusMeta, type DeliveryStatus } from "@/shared/tikis-domain";

const STATUS_STEPS: { status: DeliveryStatus; label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"] }[] = [
  { status: "open", label: "Publiée", icon: "inventory-2" },
  { status: "pending_confirmation", label: "Retenue", icon: "person-pin-circle" },
  { status: "active", label: "En cours", icon: "two-wheeler" },
  { status: "completed", label: "Terminée", icon: "task-alt" },
];

function statusStepIndex(status: DeliveryStatus) {
  if (status === "disabled" || status === "cancelled" || status === "draft") return 0;
  return Math.max(0, STATUS_STEPS.findIndex((step) => step.status === status));
}

export default function TrackDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useTikisStore();
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(id && profile?.phone), refetchInterval: 8_000 });
  const delivery = deliveryQuery.data;
  const trackable = delivery?.status === "pending_confirmation" || delivery?.status === "active" || delivery?.status === "completed";
  const statusPulse = useRef(new Animated.Value(1)).current;
  const [trackingAlert, setTrackingAlert] = useState<TrackingEvent | null>(null);
  const deliveredEvents = useRef(new Set<TrackingEvent["type"]>());

  const handleTrackingEvent = useCallback((event: TrackingEvent) => {
    if (deliveredEvents.current.has(event.type)) return;
    deliveredEvents.current.add(event.type);
    setTrackingAlert(event);
  }, []);

  useEffect(() => {
    if (!delivery?.status) return;
    statusPulse.setValue(0.94);
    Animated.sequence([Animated.timing(statusPulse, { toValue: 1.04, duration: 180, useNativeDriver: true }), Animated.timing(statusPulse, { toValue: 1, duration: 180, useNativeDriver: true })]).start();
  }, [delivery?.status, statusPulse]);

  if (deliveryQuery.isLoading) {
    return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><View style={styles.empty}><Text style={styles.emptyTitle}>Chargement du suivi…</Text></View></SafeAreaView>;
  }

  if (!delivery || !trackable) {
    return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="location-disabled" size={30} color="#B4232D" /></View><Text style={styles.emptyTitle}>Suivi indisponible</Text><Text style={styles.emptyText}>Le suivi devient disponible lorsqu’un livreur est retenu pour cette livraison.</Text><TikisButton label="Retour à la livraison" onPress={() => router.back()} style={styles.emptyButton} /></View></SafeAreaView>;
  }

  const currentStep = statusStepIndex(delivery.status);
  const statusMeta = deliveryStatusMeta[delivery.status];
  const isLive = delivery.status === "active";
  const isAssignedDriver = Boolean(profile?.phone && delivery.driverPhone === profile.phone);
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><ScrollView contentContainerStyle={styles.content}><View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#111111" /></Pressable><View style={styles.heading}><Text style={styles.topTitle}>Suivi de livraison</Text><Text style={styles.topSubtitle}>Statut actualisé automatiquement</Text></View><View style={[styles.live, !isLive && styles.liveIdle]}><View style={[styles.liveDot, !isLive && styles.liveDotIdle]} /><Text style={[styles.liveLabel, !isLive && styles.liveLabelIdle]}>{isLive ? "LIVE" : "SUIVI"}</Text></View></View><Text style={styles.title}>{delivery.title}</Text><Text style={styles.subtitle}>{isLive ? `${delivery.driverName ?? "Votre livreur"} est en route vers votre destination.` : `La livraison est ${statusMeta.label.toLocaleLowerCase()}.`}</Text><Animated.View style={[styles.statusBanner, { transform: [{ scale: statusPulse }] }]}><View style={[styles.statusIcon, { backgroundColor: statusMeta.color }]}><MaterialIcons name={STATUS_STEPS[currentStep]?.icon ?? "info"} size={22} color="#FFFFFF" /></View><View style={styles.statusInfo}><Text style={styles.statusTitle}>{statusMeta.label}</Text><Text style={styles.statusText}>{isLive ? "Position et statut mis à jour en direct." : delivery.status === "completed" ? "Cette livraison est conservée dans votre historique." : "Le livreur sélectionné doit encore confirmer sa disponibilité."}</Text></View></Animated.View><View style={styles.timeline}>{STATUS_STEPS.map((step, index) => <View key={step.status} style={styles.timelineStep}><View style={[styles.timelineDot, index <= currentStep && styles.timelineDotDone]}><MaterialIcons name={index <= currentStep ? "check" : step.icon} size={14} color={index <= currentStep ? "#FFFFFF" : "#747474"} /></View><Text style={[styles.timelineLabel, index <= currentStep && styles.timelineLabelDone]}>{step.label}</Text>{index < STATUS_STEPS.length - 1 ? <View style={[styles.timelineLine, index < currentStep && styles.timelineLineDone]} /> : null}</View>)}</View>{isLive ? <View style={styles.mapWrap}><LiveMap deliveryId={delivery.id} driverName={delivery.driverName ?? "Votre livreur"} pickup={delivery.pickup} dropoff={delivery.dropoff} driverTracksLive={isAssignedDriver} onTrackingEvent={handleTrackingEvent} /></View> : null}{trackingAlert && isLive ? <View style={[styles.alert, trackingAlert.type === "arrived" ? styles.alertArrival : styles.alertNearby]}><View style={styles.alertIcon}><MaterialIcons name={trackingAlert.type === "arrived" ? "place" : "notifications-active"} size={21} color="#FFFFFF" /></View><View style={styles.alertInfo}><Text style={styles.alertTitle}>{trackingAlert.title}</Text><Text style={styles.alertText}>{trackingAlert.body}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Masquer l’alerte" onPress={() => setTrackingAlert(null)} style={styles.alertClose}><MaterialIcons name="close" size={18} color="#666666" /></Pressable></View> : null}<View style={styles.routeCard}><RouteRow icon="inventory-2" label="Récupération" value={formatNavigationTarget(delivery.pickup)} color="#007B8B" /><View style={styles.connector} /><RouteRow icon="location-on" label="Destination" value={formatNavigationTarget(delivery.dropoff)} color="#B4232D" /></View><View style={styles.notice}><MaterialIcons name="my-location" size={18} color="#007B8B" /><Text style={styles.noticeText}>{isAssignedDriver ? "Votre position est partagée uniquement pendant cette livraison active. Vous pouvez arrêter le suivi en quittant l’écran." : "La position du livreur est reçue en direct uniquement pendant cette livraison active."}</Text></View></ScrollView></SafeAreaView>;
}

function RouteRow({ icon, label, value, color }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string; color: string }) { return <View style={styles.routeRow}><View style={[styles.routeIcon, { backgroundColor: color }]}><MaterialIcons name={icon} size={17} color="#FFFFFF" /></View><View style={styles.routeInfo}><Text style={styles.routeLabel}>{label}</Text><Text style={styles.routeValue}>{value}</Text></View></View>; }

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, content: { padding: 20, paddingBottom: 36 }, topBar: { flexDirection: "row", alignItems: "center", marginBottom: 23 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", alignItems: "center", justifyContent: "center" }, heading: { flex: 1, marginLeft: 12 }, topTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, topSubtitle: { color: "#697386", fontSize: 11, marginTop: 1 }, live: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#DCFCE7", paddingHorizontal: 9, height: 27, borderRadius: 14 }, liveIdle: { backgroundColor: "#EAF0F5" }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#18A572" }, liveDotIdle: { backgroundColor: "#697386" }, liveLabel: { color: "#147A58", fontSize: 10, fontWeight: "900", letterSpacing: 0.6 }, liveLabelIdle: { color: "#58677A" }, title: { color: "#0B1F3A", fontSize: 25, fontWeight: "900", lineHeight: 31, letterSpacing: -0.4 }, subtitle: { color: "#697386", fontSize: 14, lineHeight: 21, marginTop: 6 }, statusBanner: { marginTop: 18, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0B1F3A" }, statusIcon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" }, statusInfo: { flex: 1 }, statusTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" }, statusText: { color: "#BED0E7", fontSize: 12, lineHeight: 18, marginTop: 3 }, timeline: { flexDirection: "row", marginTop: 20, marginBottom: 3 }, timelineStep: { flex: 1, alignItems: "center", position: "relative" }, timelineDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#EEF2F6", alignItems: "center", justifyContent: "center", zIndex: 1 }, timelineDotDone: { backgroundColor: "#007B8B" }, timelineLabel: { color: "#8A96A8", fontSize: 10, fontWeight: "800", textAlign: "center", marginTop: 6 }, timelineLabelDone: { color: "#0B1F3A" }, timelineLine: { position: "absolute", top: 14, left: "62%", width: "77%", height: 2, backgroundColor: "#E0E7EE" }, timelineLineDone: { backgroundColor: "#007B8B" }, mapWrap: { marginTop: 21, shadowColor: "#0B1F3A", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 }, alert: { marginTop: 17, borderRadius: 17, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 10 }, alertNearby: { backgroundColor: "#FFF7E6", borderWidth: 1, borderColor: "#F8D89B" }, alertArrival: { backgroundColor: "#ECFBF4", borderWidth: 1, borderColor: "#BEEFD8" }, alertIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#007B8B" }, alertInfo: { flex: 1 }, alertTitle: { color: "#0B1F3A", fontSize: 14, fontWeight: "900" }, alertText: { color: "#5E6B7C", fontSize: 12, lineHeight: 18, marginTop: 2 }, alertClose: { padding: 2 }, routeCard: { marginTop: 18, backgroundColor: "#FFFFFF", borderRadius: 18, padding: 15, borderWidth: 1, borderColor: "#E7ECF2" }, routeRow: { flexDirection: "row", alignItems: "center", gap: 10 }, routeIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" }, routeInfo: { flex: 1 }, routeLabel: { color: "#8A96A8", fontSize: 10, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" }, routeValue: { color: "#0B1F3A", fontSize: 13, fontWeight: "700", marginTop: 2 }, connector: { width: 1.5, height: 16, backgroundColor: "#C9D4DF", marginLeft: 15, marginVertical: 3 }, notice: { marginTop: 16, padding: 13, borderRadius: 15, backgroundColor: "#E5F6F7", flexDirection: "row", alignItems: "flex-start", gap: 9 }, noticeText: { flex: 1, color: "#35656C", fontSize: 12, lineHeight: 18 }, empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 }, emptyIcon: { width: 67, height: 67, borderRadius: 24, backgroundColor: "#FDEBEC", alignItems: "center", justifyContent: "center" }, emptyTitle: { color: "#0B1F3A", fontSize: 22, fontWeight: "900", marginTop: 17 }, emptyText: { color: "#697386", textAlign: "center", fontSize: 14, lineHeight: 21, marginTop: 7 }, emptyButton: { alignSelf: "stretch", marginTop: 24 }, pressed: { opacity: 0.67 },
});

const styles = StyleSheet.create({
  ...baseStyles,
  safe: { ...baseStyles.safe, backgroundColor: "#EEEDF3" },
  content: { ...baseStyles.content, padding: 16, paddingBottom: 28 },
  topBar: { ...baseStyles.topBar, marginBottom: 17 },
  back: { ...baseStyles.back, borderRadius: 8, borderWidth: 0, backgroundColor: "#FFFFFF" },
  topTitle: { ...baseStyles.topTitle, color: "#111111", fontWeight: "600" },
  title: { ...baseStyles.title, color: "#111111", fontWeight: "600", fontSize: 24 },
  liveLabel: { ...baseStyles.liveLabel, fontWeight: "600" },
  statusBanner: { ...baseStyles.statusBanner, borderRadius: 10, marginTop: 14, padding: 12 },
  statusIcon: { ...baseStyles.statusIcon, borderRadius: 9 },
  statusTitle: { ...baseStyles.statusTitle, fontWeight: "600" },
  timeline: { ...baseStyles.timeline, marginTop: 16 },
  timelineLabel: { ...baseStyles.timelineLabel, fontWeight: "600" },
  mapWrap: { ...baseStyles.mapWrap, shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0, marginTop: 16 },
  alert: { ...baseStyles.alert, borderRadius: 10, marginTop: 14 },
  alertNearby: { ...baseStyles.alertNearby, borderWidth: 0 },
  alertArrival: { ...baseStyles.alertArrival, borderWidth: 0 },
  alertIcon: { ...baseStyles.alertIcon, borderRadius: 8 },
  alertTitle: { ...baseStyles.alertTitle, color: "#111111", fontWeight: "600" },
  routeCard: { ...baseStyles.routeCard, borderRadius: 10, borderWidth: 0, marginTop: 15, padding: 13 },
  routeIcon: { ...baseStyles.routeIcon, borderRadius: 8 },
  routeLabel: { ...baseStyles.routeLabel, fontWeight: "600" },
  routeValue: { ...baseStyles.routeValue, color: "#111111", fontWeight: "600" },
  notice: { ...baseStyles.notice, borderRadius: 9, marginTop: 13, backgroundColor: "#E2F3F4" },
  emptyIcon: { ...baseStyles.emptyIcon, borderRadius: 12 },
  emptyTitle: { ...baseStyles.emptyTitle, color: "#111111", fontWeight: "600" },
});
