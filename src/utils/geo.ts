export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  source: 'gps' | 'manual';
}

export interface GeoCaptureError {
  code: 'unsupported' | 'permission_denied' | 'unavailable' | 'timeout';
  message: string;
}

export function captureGpsPosition(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject({
        code: 'unsupported',
        message: 'Browser geolocation is not supported on this device. Pin your location on the map instead.',
      } satisfies GeoCaptureError);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracyMeters: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
          source: 'gps',
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject({
            code: 'permission_denied',
            message: 'Location permission was denied. Allow GPS access or click the map to set coordinates.',
          } satisfies GeoCaptureError);
        } else if (err.code === err.TIMEOUT) {
          reject({
            code: 'timeout',
            message: 'GPS signal timed out. Try again or click the map to pin your location.',
          } satisfies GeoCaptureError);
        } else {
          reject({
            code: 'unavailable',
            message: 'GPS coordinates are temporarily unavailable. Click the map to set your location.',
          } satisfies GeoCaptureError);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 10000,
      },
    );
  });
}

export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latDir}, ${Math.abs(lng).toFixed(5)}° ${lngDir}`;
}

export function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function formatExactTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
