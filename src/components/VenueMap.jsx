/**
 * VenueMap - 会場と周辺観光スポットを1つの地図上に番号ピンで表示（BOA-134拡張）
 * Google Maps embed（APIキー不要形式）は複数地点の同時表示・経路表示ができないため、
 * 無料で複数マーカーを扱える Leaflet + OpenStreetMap を使用
 */
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function numberedIcon(label, isMain) {
  return L.divIcon({
    className: "venue-map-pin",
    html: `<span class="venue-map-pin-inner${isMain ? " venue-map-pin-inner--main" : ""}">${label}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

// 会場+全観光スポットが収まるようマップの表示範囲を自動調整する
function FitAllMarkers({ latLngs }) {
  const map = useMap();
  useEffect(() => {
    if (latLngs.length > 1) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] });
    }
  }, [map, latLngs]);
  return null;
}

export default function VenueMap({ venue, venueLabel, attractions = [] }) {
  const points = useMemo(
    () => attractions.filter((a) => a.lat != null && a.lng != null),
    [attractions],
  );
  const allLatLngs = useMemo(
    () => [
      ...(venue?.lat != null && venue?.lng != null
        ? [[venue.lat, venue.lng]]
        : []),
      ...points.map((a) => [a.lat, a.lng]),
    ],
    [venue?.lat, venue?.lng, points],
  );

  if (!venue?.lat || !venue?.lng) return null;

  return (
    <div className="evg-map">
      <MapContainer
        center={[venue.lat, venue.lng]}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <FitAllMarkers latLngs={allLatLngs} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={[venue.lat, venue.lng]}
          icon={numberedIcon("🏟", true)}
        >
          <Tooltip permanent direction="top" offset={[0, -28]}>
            {venueLabel}
          </Tooltip>
        </Marker>
        {points.map((a, i) => (
          <Marker
            key={a.name}
            position={[a.lat, a.lng]}
            icon={numberedIcon(i + 1, false)}
          >
            <Tooltip permanent direction="top" offset={[0, -28]}>
              {a.name}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
