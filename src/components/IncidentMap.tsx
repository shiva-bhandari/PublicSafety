import {useEffect, useRef, useState} from 'react';
import L from 'leaflet';
import {Crosshair, MapPin} from 'lucide-react';
import type {IncidentRecord} from '../types.ts';
import type {GeoFix} from '../utils/geo.ts';
import {formatCoordinates} from '../utils/geo.ts';

interface IncidentMapProps {
  incidents: IncidentRecord[];
  selectedIncidentId: string | null;
  onSelectIncident: (incident: IncidentRecord) => void;
  userFix: GeoFix | null;
  pinPickingMode: boolean;
  onTogglePinPicking: () => void;
  onPickCoordinates: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER: [number, number] = [37.777, -122.416];

function getMarkerColor(incident: IncidentRecord): string {
  if (incident.status === 'Resolved') return '#15803d';
  if (incident.isSos || incident.severity === 'Critical') return '#dc2626';
  if (incident.severity === 'High') return '#d97706';
  return '#0f172a';
}

function getCategoryGlyph(category: IncidentRecord['category']): string {
  switch (category) {
    case 'Fire':
      return 'F';
    case 'Accident':
      return 'A';
    case 'Harassment':
      return 'H';
    case 'Medical':
      return 'M';
    case 'Natural Hazard':
      return 'N';
    case 'Suspicious Activity':
      return 'S';
    default:
      return '!';
  }
}

export function IncidentMap({
  incidents,
  selectedIncidentId,
  onSelectIncident,
  userFix,
  pinPickingMode,
  onTogglePinPicking,
  onPickCoordinates,
}: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const [tileErrorCount, setTileErrorCount] = useState(0);

  const pinPickingRef = useRef(pinPickingMode);
  pinPickingRef.current = pinPickingMode;

  const onPickRef = useRef(onPickCoordinates);
  onPickRef.current = onPickCoordinates;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 13,
      zoomControl: true,
    });

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });

    tiles.on('tileerror', () => {
      setTileErrorCount((c) => c + 1);
    });
    tiles.addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    const userLayer = L.layerGroup().addTo(map);

    map.on('click', (evt: L.LeafletMouseEvent) => {
      if (pinPickingRef.current) {
        onPickRef.current(Number(evt.latlng.lat.toFixed(6)), Number(evt.latlng.lng.toFixed(6)));
      }
    });

    mapRef.current = map;
    markersLayerRef.current = markersLayer;
    userLayerRef.current = userLayer;

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      userLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const incident of incidents) {
      const color = getMarkerColor(incident);
      const isSelected = incident.id === selectedIncidentId;
      const glyph = getCategoryGlyph(incident.category);

      const icon = L.divIcon({
        className: 'civicguard-marker',
        html: `<div style="
          width: ${isSelected ? 34 : 28}px;
          height: ${isSelected ? 34 : 28}px;
          border-radius: 9999px;
          background: ${color};
          color: #ffffff;
          border: 2.5px solid #ffffff;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-weight: 700;
          font-size: 12px;
          transform: translate(-50%, -50%);
        ">${glyph}</div>`,
        iconSize: [0, 0],
      });

      const marker = L.marker([incident.latitude, incident.longitude], {icon});
      marker.bindTooltip(`${incident.category} · ${incident.status}`, {
        direction: 'top',
        offset: [0, -14],
      });
      marker.on('click', () => {
        onSelectIncident(incident);
      });
      marker.addTo(layer);
    }
  }, [incidents, selectedIncidentId, onSelectIncident]);

  useEffect(() => {
    const map = mapRef.current;
    const userLayer = userLayerRef.current;
    if (!map || !userLayer) return;

    userLayer.clearLayers();
    if (!userFix) return;

    const coords: [number, number] = [userFix.latitude, userFix.longitude];
    if (userFix.accuracyMeters && userFix.accuracyMeters > 0) {
      L.circle(coords, {
        radius: Math.min(userFix.accuracyMeters, 350),
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 1.5,
      }).addTo(userLayer);
    }

    const userIcon = L.divIcon({
      className: 'civicguard-user-pin',
      html: `<div style="
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        background: #2563eb;
        border: 3px solid #ffffff;
        box-shadow: 0 0 0 2px rgba(37,99,235,0.45);
        transform: translate(-50%, -50%);
      "></div>`,
      iconSize: [0, 0],
    });

    L.marker(coords, {icon: userIcon})
      .bindTooltip(`Your GPS Fix (${userFix.source.toUpperCase()})`, {direction: 'top', offset: [0, -10]})
      .addTo(userLayer);

    map.setView(coords, Math.max(map.getZoom(), 14), {animate: true});
  }, [userFix]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedIncidentId) return;
    const target = incidents.find((item) => item.id === selectedIncidentId);
    if (target) {
      map.panTo([target.latitude, target.longitude], {animate: true});
    }
  }, [selectedIncidentId, incidents]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">Live Incident Map</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{incidents.length} plotted</span>
          {userFix && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700 tabular-nums">
                {formatCoordinates(userFix.latitude, userFix.longitude)}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePinPicking}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              pinPickingMode
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            {pinPickingMode ? 'Click Map to Set Pin' : 'Pin Location Manually'}
          </button>
          {userFix && (
            <button
              type="button"
              onClick={() => {
                mapRef.current?.setView([userFix.latitude, userFix.longitude], 15, {animate: true});
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              Center GPS
            </button>
          )}
        </div>
      </div>

      <div className="relative h-[380px] lg:h-[440px] w-full bg-slate-100">
        {tileErrorCount > 6 && (
          <div
            className="pointer-events-none absolute inset-0 z-[1] opacity-45"
            style={{
              backgroundImage:
                'linear-gradient(to right, #cbd5e1 1px, transparent 1px), linear-gradient(to bottom, #cbd5e1 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
        )}
        <div
          ref={containerRef}
          className={`h-full w-full z-10 ${pinPickingMode ? 'cursor-crosshair' : ''}`}
          aria-label="Interactive GPS incident map"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
            Critical / SOS
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />
            High Priority
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-900 inline-block" />
            Moderate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-700 inline-block" />
            Resolved
          </span>
        </div>
        <span className="text-slate-500">
          Markers: A Accident · F Fire · H Harassment · M Medical · N Hazard
        </span>
      </div>
    </div>
  );
}
