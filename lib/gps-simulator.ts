export type GpsCoordinate = { latitude: number; longitude: number };
export type TrackingEvent = {
  type: "nearby" | "arrived";
  progress: number;
  title: string;
  body: string;
};

export const SIMULATED_ROUTE: GpsCoordinate[] = [
  { latitude: 12.36419, longitude: -1.53313 },
  { latitude: 12.36285, longitude: -1.53082 },
  { latitude: 12.36161, longitude: -1.52812 },
  { latitude: 12.35992, longitude: -1.52586 },
  { latitude: 12.35819, longitude: -1.52341 },
  { latitude: 12.35655, longitude: -1.52067 },
  { latitude: 12.35478, longitude: -1.51859 },
  { latitude: 12.35332, longitude: -1.51623 },
];

export function routeProgress(step: number, routeLength = SIMULATED_ROUTE.length) {
  if (routeLength <= 1) return 100;
  const safeStep = Math.max(0, Math.min(step, routeLength - 1));
  return Math.round((safeStep / (routeLength - 1)) * 100);
}

export function coordinateAtStep(step: number, route: GpsCoordinate[] = SIMULATED_ROUTE): GpsCoordinate {
  if (route.length === 0) throw new Error("A simulated route requires at least one coordinate");
  return route[Math.max(0, Math.min(step, route.length - 1))];
}

export function remainingMinutes(step: number, routeLength = SIMULATED_ROUTE.length) {
  const progress = routeProgress(step, routeLength);
  return Math.max(1, Math.ceil(((100 - progress) / 100) * 12));
}

export function trackingEventAtStep(step: number, routeLength = SIMULATED_ROUTE.length): TrackingEvent | null {
  const progress = routeProgress(step, routeLength);
  if (progress >= 100) {
    return {
      type: "arrived",
      progress,
      title: "Votre livreur est arrivé",
      body: "Le livreur est à destination. Préparez-vous à réceptionner votre livraison.",
    };
  }
  if (progress >= 80) {
    return {
      type: "nearby",
      progress,
      title: "Votre livreur est à proximité",
      body: "Le livreur approche de la destination. Il devrait arriver dans quelques minutes.",
    };
  }
  return null;
}

