"use client";

// Leaflet + OpenStreetMap (no paid key). Load with next/dynamic and ssr: false: Leaflet needs `window`.
// Tiles default to the OSM standard tile server, which is fine for development and light use under the
// OSM tile usage policy; set NEXT_PUBLIC_MAP_TILE_URL to a tile provider for production traffic.

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";

export const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Lahore, roughly centred on Gulberg. */
const LAHORE: L.LatLngTuple = [31.5, 74.33];

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  dimmed?: boolean;
}

export default function PlacesMap({
  pins,
  origin,
  activeId,
  onSelect,
  className,
  zoom = 12,
  interactive = true,
}: {
  pins: MapPin[];
  origin?: { lat: number; lng: number; kind: "gps" | "area" } | null;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  zoom?: number;
  interactive?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const youLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // Create once.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, {
      center: LAHORE,
      zoom,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: false, // don't hijack page scrolling; pinch and +/- still work
      touchZoom: interactive,
      doubleClickZoom: interactive,
      keyboard: interactive,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);
    pinLayer.current = L.layerGroup().addTo(m);
    youLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      fitted.current = false;
    };
  }, [interactive, zoom]);

  // Pins.
  useEffect(() => {
    const m = map.current;
    const layer = pinLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    for (const p of pins) {
      const icon = L.divIcon({
        className: "",
        html: `<div class="bp-pin" data-active="${p.id === activeId}" data-closed="${!!p.dimmed}">${escapeHtml(p.label)}</div>`,
        iconSize: [0, 0],
      });
      const marker = L.marker([p.lat, p.lng], {
        icon,
        title: p.title,
        alt: p.title,
        keyboard: interactive,
        zIndexOffset: p.id === activeId ? 1000 : 0,
      });
      marker.on("click", () => onSelectRef.current?.(p.id));
      layer.addLayer(marker);
    }
    if (!fitted.current && pins.length) {
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as L.LatLngTuple));
      if (origin) bounds.extend([origin.lat, origin.lng]);
      if (pins.length === 1 && !origin) m.setView([pins[0].lat, pins[0].lng], zoom);
      else m.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
      fitted.current = true;
    }
  }, [pins, activeId, origin, interactive, zoom]);

  // "You are here".
  useEffect(() => {
    const layer = youLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (origin?.kind === "gps") {
      layer.addLayer(
        L.marker([origin.lat, origin.lng], {
          icon: L.divIcon({ className: "", html: '<div class="bp-you"></div>', iconSize: [0, 0] }),
          title: "You are here",
          interactive: false,
          keyboard: false,
        }),
      );
    }
  }, [origin]);

  return <div ref={el} className={`isolate z-0 ${className ?? ""}`} role="region" aria-label="Map of places" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
