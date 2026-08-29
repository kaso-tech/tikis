import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { type TrackingEvent } from "@/lib/gps-simulator";
import { broadcastDeliveryPosition, closeDeliveryTrackingChannel, createDeliveryTrackingChannel, type DeliveryPosition } from "@/lib/supabase-tracking";
import { useDeliveryLiveLocation, type LiveLocationState } from "@/hooks/use-delivery-live-location";
import type { LocationLabel } from "@/shared/tikis-domain";

const liveCopy: Record<LiveLocationState, string> = { idle: "EN ATTENTE GPS", requesting: "LOCALISATION…", active: "POSITION EN DIRECT", denied: "GPS NON AUTORISÉ", unavailable: "GPS INDISPONIBLE", error: "GPS À RÉESSAYER" };

export function LiveMap({ deliveryId, driverName, pickup, dropoff, driverTracksLive }: { deliveryId: string; driverName: string; pickup: LocationLabel; dropoff: LocationLabel; driverTracksLive: boolean; onTrackingEvent?: (event: TrackingEvent) => void }) {
  const [remotePosition, setRemotePosition] = useState<DeliveryPosition | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const trackingChannel = useRef<ReturnType<typeof createDeliveryTrackingChannel>>(null);
  const publishNativePosition = useCallback((position: DeliveryPosition) => { void broadcastDeliveryPosition(trackingChannel.current, position); }, []);
  const nativeTracking = useDeliveryLiveLocation(driverTracksLive, publishNativePosition);
  const position = driverTracksLive ? nativeTracking.position : remotePosition;
  const mapCenter = position ?? { latitude: pickup.latitude, longitude: pickup.longitude };

  useEffect(() => {
    trackingChannel.current = createDeliveryTrackingChannel(deliveryId, setRemotePosition);
    return () => { void closeDeliveryTrackingChannel(trackingChannel.current); trackingChannel.current = null; };
  }, [deliveryId]);

  useEffect(() => {
    if (position) mapRef.current?.animateCamera({ center: position, pitch: 35, heading: position.heading, zoom: 15.3 }, { duration: 720 });
  }, [position]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ latitude: mapCenter.latitude, longitude: mapCenter.longitude, latitudeDelta: 0.018, longitudeDelta: 0.018 }}
        showsUserLocation={driverTracksLive}
        showsCompass={false}
        rotateEnabled={false}
        toolbarEnabled={false}
      >
        <Polyline coordinates={[pickup, dropoff]} strokeColor="#007B8B" strokeWidth={5} lineCap="round" />
        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.startMarker}><MaterialIcons name="inventory-2" size={15} color="#FFFFFF" /></View>
        </Marker>
        <Marker coordinate={dropoff} anchor={{ x: 0.5, y: 0.85 }}>
          <View style={styles.destinationMarker}><MaterialIcons name="location-on" size={26} color="#B4232D" /></View>
        </Marker>
        {position ? <Marker coordinate={position} anchor={{ x: 0.5, y: 0.5 }} flat rotation={position.heading}>
          <View style={styles.driverMarker}><MaterialIcons name="two-wheeler" size={22} color="#FFFFFF" /></View>
        </Marker> : null}
      </MapView>
      <View style={[styles.liveBadge, nativeTracking.state !== "active" && styles.liveBadgeIdle]}><View style={[styles.liveDot, nativeTracking.state !== "active" && styles.liveDotIdle]} /><Text style={[styles.liveText, nativeTracking.state !== "active" && styles.liveTextIdle]}>{driverTracksLive ? liveCopy[nativeTracking.state] : remotePosition ? "POSITION REÇUE" : "POSITION EN ATTENTE"}</Text></View>
      <View style={styles.progressBubble}><Text style={styles.progressMain}>{position ? "Position confirmée" : "Position non disponible"}</Text><Text style={styles.progressSub}>{driverTracksLive ? `${driverName} partage sa position pendant cette course.` : `${driverName} activera sa position à la prise en charge.`}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 360, overflow: "hidden", borderRadius: 10, backgroundColor: "#EEEDF3" },
  map: { ...StyleSheet.absoluteFillObject },
  startMarker: { width: 31, height: 31, borderRadius: 8, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 0 },
  destinationMarker: { width: 33, height: 33, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  driverMarker: { width: 46, height: 46, borderRadius: 12, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", borderWidth: 0, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  liveBadge: { position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.95)" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#167A55" }, liveDotIdle: { backgroundColor: "#9A6200" }, liveText: { color: "#167A55", fontSize: 10, fontWeight: "600", letterSpacing: 0.45 }, liveTextIdle: { color: "#9A6200" }, liveBadgeIdle: { backgroundColor: "rgba(238,237,243,0.96)" },
  progressBubble: { position: "absolute", left: 14, right: 14, bottom: 14, padding: 12, borderRadius: 10, backgroundColor: "rgba(17,17,17,0.94)" },
  progressMain: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" }, progressSub: { color: "#BBBBBB", fontSize: 12, marginTop: 2 },
});
