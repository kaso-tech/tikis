import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";

export default function AdminLiveMap() {
  const { colors: theme } = useThemeColors();
  const query = trpc.adminConsole.liveMap.useQuery(undefined, { refetchInterval: 10_000 });
  const isWeb = Platform.OS === "web";

  if (isWeb && query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
          <Text style={[styles.title, { color: theme.foreground }]}>Carte temps réel</Text>
          <Text style={[styles.sub, { color: theme.muted }]}>{query.data.deliveries.length} courses actives</Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16, padding: 16 }]}>
            <MapView deliveries={query.data.deliveries} theme={theme} />
          </View>
          <View style={{ marginTop: 12, gap: 8 }}>
            {query.data.deliveries.map((d) => (
              <View key={d.id} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={[styles.statusDot, { backgroundColor: d.status === "active" ? theme.success : theme.primary }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.foreground }} numberOfLines={1}>
                    {d.pickup.label} → {d.dropoff.label}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                    {d.driverName ?? "—"} · {d.vehicle ?? "—"} · {d.offeredPrice ? formatMoney(d.offeredPrice) : "—"}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: theme.muted }}>{d.status === "active" ? "Live" : "Conf."}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background, padding: 24, gap: 12 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <MaterialIcons name="my-location" size={36} color={theme.primary} />
      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: "600" }}>Carte temps réel</Text>
      <Text style={{ color: theme.muted, fontSize: 12.5, textAlign: "center" }}>Disponible sur la version web de la console.</Text>
      {query.isLoading ? <ActivityIndicator color={theme.primary} /> : null}
    </View>
  );
}

function MapView({ deliveries, theme }: { deliveries: { id: string; pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string }; status: string; driverName: string | null; driverLocation: { latitude: number; longitude: number } | null }[]; theme: any }) {
  if (deliveries.length === 0) {
    return <Text style={{ color: theme.muted, fontSize: 12.5, textAlign: "center", padding: 32 }}>Aucune course active.</Text>;
  }
  const lats = deliveries.flatMap((d) => [d.pickup.lat, d.dropoff.lat, d.driverLocation?.latitude ?? d.pickup.lat]);
  const lngs = deliveries.flatMap((d) => [d.pickup.lng, d.dropoff.lng, d.driverLocation?.longitude ?? d.pickup.lng]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * 0.2 || 0.01;
  const padLng = (maxLng - minLng) * 0.2 || 0.01;
  const bMinLat = minLat - padLat;
  const bMaxLat = maxLat + padLat;
  const bMinLng = minLng - padLng;
  const bMaxLng = maxLng + padLng;
  const W = 100;
  const H = 60;
  const project = (lat: number, lng: number) => ({
    x: ((lng - bMinLng) / (bMaxLng - bMinLng)) * W,
    y: ((bMaxLat - lat) / (bMaxLat - bMinLat)) * H,
  });
  return (
    <View style={{ width: "100%", height: 380, backgroundColor: theme.background, borderRadius: 8, overflow: "hidden" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" } as any}>
        <defs>
          <pattern id="adminGrid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke={theme.primary} strokeOpacity="0.08" strokeWidth="0.1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={theme.background} />
        <rect width={W} height={H} fill="url(#adminGrid)" />
        {deliveries.map((d) => {
          const p = project(d.pickup.lat, d.pickup.lng);
          const e = project(d.dropoff.lat, d.dropoff.lng);
          const driver = d.driverLocation ? project(d.driverLocation.latitude, d.driverLocation.longitude) : null;
          return (
            <g key={d.id}>
              <line x1={p.x} y1={p.y} x2={e.x} y2={e.y} stroke={theme.primary} strokeWidth="0.3" strokeDasharray="0.8 0.5" opacity="0.7" />
              <circle cx={p.x} cy={p.y} r="1.2" fill={theme.primary} />
              <circle cx={e.x} cy={e.y} r="1.2" fill={theme.error} />
              {driver ? <circle cx={driver.x} cy={driver.y} r="1.2" fill={theme.success} stroke="#FFFFFF" strokeWidth="0.3" /> : null}
            </g>
          );
        })}
      </svg>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
});
