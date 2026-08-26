import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { remainingMinutes, routeProgress, SIMULATED_ROUTE } from "@/lib/gps-simulator";

export function LiveMap({ driverName }: { driverName: string }) {
  const [step, setStep] = useState(3);
  const progress = routeProgress(step);
  const x = 20 + (step / (SIMULATED_ROUTE.length - 1)) * 63;
  const y = 70 - (step / (SIMULATED_ROUTE.length - 1)) * 43;

  useEffect(() => {
    const interval = setInterval(() => setStep((current) => current >= SIMULATED_ROUTE.length - 1 ? 0 : current + 1), 2800);
    return () => clearInterval(interval);
  }, []);

  return <View style={styles.container}><View style={styles.water} /><View style={[styles.road, styles.roadOne]} /><View style={[styles.road, styles.roadTwo]} /><View style={[styles.road, styles.roadThree]} /><View style={styles.routeStart}><MaterialIcons name="inventory-2" size={13} color="#FFFFFF" /></View><View style={styles.destination}><MaterialIcons name="location-on" size={27} color="#E45858" /></View><View style={[styles.driver, { left: `${x}%`, top: `${y}%` }]}><MaterialIcons name="two-wheeler" size={21} color="#FFFFFF" /></View><View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>POSITION MISE À JOUR</Text></View><View style={styles.progressBubble}><Text style={styles.progressMain}>{progress} %</Text><Text style={styles.progressSub}>{driverName} · arrivée estimée dans {remainingMinutes(step)} min</Text></View></View>;
}

const styles = StyleSheet.create({
  container: { height: 360, overflow: "hidden", borderRadius: 24, backgroundColor: "#DCE9D2", position: "relative" }, water: { position: "absolute", backgroundColor: "#C9E7EE", right: -40, top: -20, height: 170, width: 160, borderRadius: 90 }, road: { position: "absolute", height: 10, borderRadius: 10, backgroundColor: "#F7F3E9", borderWidth: 1, borderColor: "#C9C4B8" }, roadOne: { left: -35, top: 235, width: "120%", transform: [{ rotate: "-31deg" }] }, roadTwo: { left: 15, top: 120, width: "90%", transform: [{ rotate: "-19deg" }] }, roadThree: { left: 90, top: 60, width: 230, transform: [{ rotate: "62deg" }] }, routeStart: { position: "absolute", left: "16%", top: "68%", width: 31, height: 31, borderRadius: 12, backgroundColor: "#007B8B", borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }, destination: { position: "absolute", right: "11%", top: "23%", width: 35, height: 35, borderRadius: 18, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }, driver: { position: "absolute", marginLeft: -23, marginTop: -23, width: 46, height: 46, borderRadius: 23, backgroundColor: "#0B1F3A", borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#0B1F3A", shadowOpacity: 0.32, shadowRadius: 7 }, liveBadge: { position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.95)" }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#18A572" }, liveText: { color: "#147A58", fontSize: 10, fontWeight: "900", letterSpacing: 0.45 }, progressBubble: { position: "absolute", left: 14, right: 14, bottom: 14, padding: 12, borderRadius: 17, backgroundColor: "rgba(11,31,58,0.94)" }, progressMain: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" }, progressSub: { color: "#BED0E7", fontSize: 12, marginTop: 2 },
});

