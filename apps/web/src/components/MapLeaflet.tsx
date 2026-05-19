import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapDossier = {
  id: string;
  numero: string;
  type: string;
  status: string;
  adresse: string;
  lat: number;
  lng: number;
};

const STATUS_COLORS: Record<string, string> = {
  soumis: "#4F46E5",
  pre_instruction: "#F97316",
  incomplet: "#EF4444",
  en_instruction: "#22C55E",
  decision_en_cours: "#8B5CF6",
  accepte: "#10B981",
  refuse: "#EF4444",
  accord_prescription: "#10B981",
  brouillon: "#94A3B8",
};

const STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon",
  soumis: "Nouveau",
  pre_instruction: "Pré-instruction",
  incomplet: "Incomplet",
  en_instruction: "En instruction",
  decision_en_cours: "Décision en cours",
  accepte: "Accepté",
  refuse: "Refusé",
  accord_prescription: "Accord avec prescriptions",
};

const TYPE_LABELS: Record<string, string> = {
  permis_de_construire: "Permis de construire",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
};

// Ballan-Miré center
const DEFAULT_CENTER: [number, number] = [47.354, 0.550];
const DEFAULT_ZOOM = 13;

export function MapLeaflet({
  dossiers,
  height = 300,
  filterStatus,
  commune,
  onMarkerClick,
}: {
  dossiers: MapDossier[];
  height?: number;
  filterStatus?: string;
  commune?: string;
  onMarkerClick?: (d: MapDossier) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const boundaryRef = useRef<L.GeoJSON | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch and draw commune boundary
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !commune) return;

    let cancelled = false;

    fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(commune)}&fields=contour&format=geojson&geometry=contour&limit=1`)
      .then(r => r.json())
      .then((geojson: { features?: unknown[] }) => {
        if (cancelled || !mapRef.current) return;
        if (boundaryRef.current) {
          boundaryRef.current.remove();
          boundaryRef.current = null;
        }
        if (geojson.features && geojson.features.length > 0) {
          const layer = L.geoJSON(geojson as Parameters<typeof L.geoJSON>[0], {
            style: {
              color: "#4F46E5",
              weight: 2.5,
              fillColor: "#4F46E5",
              fillOpacity: 0.07,
              dashArray: "8 5",
            },
          }).addTo(mapRef.current);
          boundaryRef.current = layer;
          mapRef.current.fitBounds(layer.getBounds(), { padding: [30, 30] });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [commune]);

  // Sync markers when dossiers or filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const visible = filterStatus && filterStatus !== "Tous"
      ? dossiers.filter(d => {
          const apiStatus = Object.entries(STATUS_LABELS).find(([, v]) => v === filterStatus)?.[0];
          return apiStatus ? d.status === apiStatus : true;
        })
      : dossiers;

    visible.forEach(d => {
      const color = STATUS_COLORS[d.status] ?? "#6366F1";
      const marker = L.circleMarker([d.lat, d.lng] as [number, number], {
        radius: 11,
        fillColor: color,
        color: "white",
        weight: 2.5,
        fillOpacity: 0.92,
      });

      marker.bindPopup(`
        <div style="min-width:180px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.5">
          <div style="font-weight:700;color:#0F172A;margin-bottom:2px">${d.numero}</div>
          <div style="color:#64748b;font-size:11px;margin-bottom:6px">${d.adresse}</div>
          <div style="font-size:11px;color:#374151;margin-bottom:4px">${TYPE_LABELS[d.type] ?? d.type}</div>
          <span style="background:${color}22;color:${color};font-size:11px;font-weight:600;
            padding:2px 8px;border-radius:10px;border:1px solid ${color}44">
            ${STATUS_LABELS[d.status] ?? d.status}
          </span>
        </div>
      `, { maxWidth: 240 });

      if (onMarkerClick) {
        marker.on("click", () => onMarkerClick(d));
      }

      marker.addTo(map);
      markersRef.current.push(marker);
    });

    // Only fit to markers if there's no commune boundary (boundary handles the initial fit)
    if (visible.length > 0 && !boundaryRef.current) {
      const bounds = L.latLngBounds(visible.map(d => [d.lat, d.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [dossiers, filterStatus, onMarkerClick]);

  // Resize map when height changes (expand/collapse)
  useEffect(() => {
    mapRef.current?.invalidateSize();
  }, [height]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, borderRadius: "inherit" }}
    />
  );
}
