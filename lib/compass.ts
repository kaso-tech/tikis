export type GeographicCoordinate = { latitude: number; longitude: number };

function normalizeDegrees(value: number) {
  return (value % 360 + 360) % 360;
}

export function bearingTo(origin: GeographicCoordinate | null, target: GeographicCoordinate): number {
  if (!origin) return 0;
  const radians = (value: number) => value * Math.PI / 180;
  const degrees = (value: number) => value * 180 / Math.PI;
  const originLatitude = radians(origin.latitude);
  const targetLatitude = radians(target.latitude);
  const deltaLongitude = radians(target.longitude - origin.longitude);
  const y = Math.sin(deltaLongitude) * Math.cos(targetLatitude);
  const x = Math.cos(originLatitude) * Math.sin(targetLatitude) - Math.sin(originLatitude) * Math.cos(targetLatitude) * Math.cos(deltaLongitude);
  return normalizeDegrees(degrees(Math.atan2(y, x)));
}

export function compassRotationToTarget(origin: GeographicCoordinate | null, target: GeographicCoordinate, deviceHeading: number | null): number {
  const targetBearing = bearingTo(origin, target);
  return deviceHeading === null || !Number.isFinite(deviceHeading)
    ? targetBearing
    : normalizeDegrees(targetBearing - deviceHeading);
}
