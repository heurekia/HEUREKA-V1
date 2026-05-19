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
  filterType,
  commune,
  onMarkerClick,
  onMapClick,
  clickMode = false,
  parcelLayer = false,
  pluZoneLayer = false,
  ignBase = false,
}: {
  dossiers: MapDossier[];
  height?: number | string;
  filterStatus?: string;
  filterType?: string;
  commune?: string;
  onMarkerClick?: (d: MapDossier) => void;
  onMapClick?: (lat: number, lng: number) => void;
  clickMode?: boolean;
  parcelLayer?: boolean;
  /** Overlay GPU PLU zone polygons (URBANISME.ZONE_URBA — Géoportail de l'Urbanisme) */
  pluZoneLayer?: boolean;
  /** Use IGN Plan IGN v2 as base layer instead of OpenStreetMap */
  ignBase?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const boundaryRef = useRef<L.GeoJSON | null>(null);
  const parcelLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const pluLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const clickPinRef = useRef<L.Marker | null>(null);
  const baseTileRef = useRef<L.TileLayer | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      baseTileRef.current = null;
      parcelLayerRef.current = null;
      pluLayerRef.current = null;
    };
  }, []);

  // Base tile layer — OSM or IGN Plan v2 depending on ignBase prop
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseTileRef.current) { baseTileRef.current.remove(); baseTileRef.current = null; }
    baseTileRef.current = ignBase
      ? L.tileLayer(
          "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
          "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png" +
          "&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
          { attribution: "© IGN — Géoplateforme", maxZoom: 19 }
        ).addTo(map)
      : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);
  }, [ignBase]);

  // IGN cadastral parcel WMS overlay (shows parcel boundaries)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (parcelLayer && !parcelLayerRef.current) {
      parcelLayerRef.current = L.tileLayer.wms("https://data.geopf.fr/wms-r/ows", {
        layers: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        format: "image/png",
        transparent: true,
        version: "1.3.0",
        opacity: 0.75,
        attribution: "© IGN — Géoplateforme",
      }).addTo(map);
    } else if (!parcelLayer && parcelLayerRef.current) {
      parcelLayerRef.current.remove();
      parcelLayerRef.current = null;
    }
  }, [parcelLayer]);

  // GPU PLU zone WMS overlay (Géoportail de l'Urbanisme)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pluZoneLayer && !pluLayerRef.current) {
      pluLayerRef.current = L.tileLayer.wms("https://data.geopf.fr/wms-r/ows", {
        layers: "URBANISME.ZONE_URBA",
        format: "image/png",
        transparent: true,
        version: "1.3.0",
        opacity: 0.55,
        attribution: "© IGN Géoplateforme — Géoportail de l'Urbanisme",
      }).addTo(map);
    } else if (!pluZoneLayer && pluLayerRef.current) {
      pluLayerRef.current.remove();
      pluLayerRef.current = null;
    }
  }, [pluZoneLayer]);

  // Map click handler — only active in clickMode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    container.style.cursor = clickMode ? "crosshair" : "";

    const handler = (e: L.LeafletMouseEvent) => {
      if (!clickMode || !onMapClick) return;
      const { lat, lng } = e.latlng;

      // Drop a temporary pin at the clicked location
      if (clickPinRef.current) clickPinRef.current.remove();
      clickPinRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          html: `<div style="width:22px;height:22px;background:#4F46E5;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);transform:translate(-50%,-50%)"></div>`,
          iconSize: [0, 0],
          className: "",
        }),
      }).addTo(map);

      onMapClick(lat, lng);
    };

    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [clickMode, onMapClick]);

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

    const visible = dossiers.filter(d => {
      const statusOk = !filterStatus || filterStatus === "Tous" || (() => {
        const apiStatus = Object.entries(STATUS_LABELS).find(([, v]) => v === filterStatus)?.[0];
        return apiStatus ? d.status === apiStatus : true;
      })();
      const typeOk = !filterType || filterType === "Tous les types" || TYPE_LABELS[d.type] === filterType;
      return statusOk && typeOk;
    });

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
  }, [dossiers, filterStatus, filterType, onMarkerClick]);

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
