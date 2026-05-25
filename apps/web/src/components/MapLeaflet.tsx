import { useEffect, useRef, useState } from "react";
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

export type BaseLayer = "osm" | "ign-plan" | "ign-ortho" | "carto-light";

export function MapLeaflet({
  dossiers,
  height = 300,
  filterStatus,
  filterType,
  commune,
  inseeCode,
  onMarkerClick,
  onMapClick,
  clickMode = false,
  parcelLayer = false,
  pluZoneLayer = false,
  baseLayer = "osm",
  highlightGeometry,
  defaultCenter,
  defaultZoom,
}: {
  dossiers: MapDossier[];
  height?: number | string;
  filterStatus?: string;
  filterType?: string;
  commune?: string;
  /** INSEE commune code (preferred over name — works for PLU and PLUi) */
  inseeCode?: string;
  onMarkerClick?: (d: MapDossier) => void;
  onMapClick?: (lat: number, lng: number) => void;
  clickMode?: boolean;
  parcelLayer?: boolean;
  /** Overlay GPU PLU zone polygons (URBANISME.ZONE_URBA — Géoportail de l'Urbanisme) */
  pluZoneLayer?: boolean;
  /** Base tile layer: osm | ign-plan | ign-ortho | carto-light */
  baseLayer?: BaseLayer;
  /** GeoJSON geometry to highlight (e.g. found parcel polygon) */
  highlightGeometry?: object;
  /** Override initial map center [lat, lng] */
  defaultCenter?: [number, number];
  /** Override initial map zoom level */
  defaultZoom?: number;
}) {
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const boundaryRef = useRef<L.GeoJSON | null>(null);
  const parcelLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const pluLayerRef = useRef<L.Layer | null>(null);
  const clickPinRef = useRef<L.Marker | null>(null);
  const baseTileRef = useRef<L.TileLayer | null>(null);
  const highlightLayerRef = useRef<L.GeoJSON | null>(null);
  // Capture initial center/zoom at mount time (refs avoid re-running the init effect)
  const initialCenterRef = useRef<[number, number]>(defaultCenter ?? DEFAULT_CENTER);
  const initialZoomRef = useRef<number>(defaultZoom ?? DEFAULT_ZOOM);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      zoomControl: false,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;
    // Defer invalidateSize + signal readiness so the container has its final layout
    requestAnimationFrame(() => {
      map.invalidateSize();
      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      baseTileRef.current = null;
      parcelLayerRef.current = null;
      pluLayerRef.current = null;
      highlightLayerRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Base tile layer — swaps when baseLayer prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseTileRef.current) { baseTileRef.current.remove(); baseTileRef.current = null; }
    const WMTS = (layer: string, format: string) =>
      `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${layer}&STYLE=normal&FORMAT=${format}` +
      `&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
    if (baseLayer === "ign-plan") {
      baseTileRef.current = L.tileLayer(WMTS("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png"), { attribution: "© IGN — Géoplateforme", maxZoom: 19, zIndex: 1 }).addTo(map);
    } else if (baseLayer === "ign-ortho") {
      baseTileRef.current = L.tileLayer(WMTS("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"), { attribution: "© IGN — Géoplateforme", maxZoom: 21, zIndex: 1 }).addTo(map);
    } else if (baseLayer === "carto-light") {
      baseTileRef.current = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>', maxZoom: 19, zIndex: 1 }).addTo(map);
    } else {
      baseTileRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19, zIndex: 1 }).addTo(map);
    }
  }, [baseLayer]);

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
        zIndex: 2,
        attribution: "© IGN — Géoplateforme",
      }).addTo(map);
    } else if (!parcelLayer && parcelLayerRef.current) {
      parcelLayerRef.current.remove();
      parcelLayerRef.current = null;
    }
  }, [parcelLayer]);

  // PLU zones — apicarto.ign.fr/api/gpu (CORS-enabled, called client-side).
  // Flow per the OpenAPI spec:
  //   1. geo.api.gouv.fr → commune centroid (Point, tiny URL-safe geom)
  //   2. /api/gpu/document?geom={point} → active PLU partition
  //   3. /api/gpu/zone-urba?partition={partition} → zone polygons
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (pluLayerRef.current) { pluLayerRef.current.remove(); pluLayerRef.current = null; }
    setZoneError(null);
    if (!pluZoneLayer) return;
    if (!inseeCode) { setZoneError("Code INSEE requis"); return; }

    const ZONE_COLORS: Record<string, string> = {
      U: "#C0392B", AU: "#E67E22", A: "#D4AC0D", N: "#27AE60",
    };
    const colorFor = (tz: string) =>
      ZONE_COLORS[tz] ?? ZONE_COLORS[tz.charAt(0)] ?? "#94a3b8";

    const ctrl = new AbortController();
    const sig = ctrl.signal;

    // Step 1 — commune centroid (Point geometry, never causes 414)
    fetch(`https://geo.api.gouv.fr/communes?code=${encodeURIComponent(inseeCode)}&fields=centre&limit=1`, { signal: sig })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`geo.api HTTP ${r.status}`)))
      .then((data: Array<{ centre?: unknown }>) => {
        const centre = data[0]?.centre;
        if (!centre) throw new Error("Commune introuvable");
        // Step 2 — find active PLU document for this point
        const geom = encodeURIComponent(JSON.stringify(centre));
        return fetch(`https://apicarto.ign.fr/api/gpu/document?geom=${geom}`, { signal: sig })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`document HTTP ${r.status}`)));
      })
      .then((docs: { features?: Array<{ properties: { partition?: string; statut?: string } }> }) => {
        if (!docs.features?.length) throw new Error("Aucun document PLU pour cette commune");
        const active =
          docs.features.find(f => ["En vigueur", "Opposable", "Approuvé"].includes(f.properties.statut ?? "")) ??
          docs.features[0];
        const partition = active?.properties?.partition;
        if (!partition) throw new Error("Partition GPU introuvable");
        // Step 3 — all zones for this document
        return fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(partition)}`, { signal: sig })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`zone-urba HTTP ${r.status}`)));
      })
      .then((zones: { features?: unknown[] }) => {
        if (!mapRef.current || sig.aborted) return;
        if (!zones.features?.length) throw new Error("Aucune zone PLU pour cette commune");

        const layer = L.geoJSON(zones as Parameters<typeof L.geoJSON>[0], {
          style: feature => {
            const tz = (feature?.properties as { typezone?: string })?.typezone ?? "";
            const color = colorFor(tz);
            return { fillColor: color, fillOpacity: 0.3, color, weight: 1.5, opacity: 0.8 };
          },
          onEachFeature: (feature, fLayer) => {
            const p = feature.properties as { libelle?: string; typezone?: string };
            const label = p.libelle ? `Zone ${p.libelle}` : p.typezone ? `Type ${p.typezone}` : "";
            if (label) fLayer.bindTooltip(label, { sticky: true });
          },
        }).addTo(mapRef.current);

        pluLayerRef.current = layer;
      })
      .catch((err: Error) => {
        if (sig.aborted) return;
        setZoneError(err.message);
      });

    return () => { ctrl.abort(); };
  }, [pluZoneLayer, inseeCode, mapReady]);

  // Highlight geometry (e.g. parcel polygon returned by analysis)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (highlightLayerRef.current) { highlightLayerRef.current.remove(); highlightLayerRef.current = null; }
    if (!highlightGeometry) return;
    try {
      highlightLayerRef.current = L.geoJSON(highlightGeometry as Parameters<typeof L.geoJSON>[0], {
        style: { fillColor: "#4F46E5", fillOpacity: 0.2, color: "#4F46E5", weight: 2.5, opacity: 0.9, dashArray: "5 4" },
      }).addTo(map);
      const bounds = highlightLayerRef.current.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 19 });
    } catch { /* invalid geometry — ignore */ }
  }, [highlightGeometry]);

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
    if (!map || (!commune && !inseeCode)) return;

    let cancelled = false;

    const boundaryUrl = inseeCode
      ? `https://geo.api.gouv.fr/communes?code=${encodeURIComponent(inseeCode)}&fields=contour&format=geojson&geometry=contour&limit=1`
      : `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(commune!)}&fields=contour&format=geojson&geometry=contour&limit=1`;

    fetch(boundaryUrl)
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
  }, [commune, inseeCode, mapReady]);

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
    <div style={{ width: "100%", height, borderRadius: "inherit", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: "inherit" }} />
      {pluZoneLayer && zoneError && (
        <div style={{
          position: "absolute", bottom: 8, left: 8, zIndex: 1000,
          background: "rgba(239,68,68,0.92)", color: "white",
          borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600,
          backdropFilter: "blur(4px)", maxWidth: 280,
        }}>
          ⚠ Zones PLU indisponibles — {zoneError}
        </div>
      )}
    </div>
  );
}
