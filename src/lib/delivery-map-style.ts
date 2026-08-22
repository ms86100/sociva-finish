/// <reference types="@types/google.maps" />
/**
 * Sociva tracking map visual language.
 * The Google basemap stays quiet; the custom route + markers carry the hierarchy.
 */

export const ROUTE_BLUE = '#1A73E8';
export const ROUTE_BLUE_MUTED = '#8AB4F8';
export const ROUTE_HALO = '#1A73E8';
export const DASH_ROUTE = '#2B2B2B';
export const DEST_RING = '#34A853';

/** Light, desaturated navigation style. Transit + road shields stay on. */
export const SOCIVA_TRACKING_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f3f3f1' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8d8d8d' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3f3f1' }, { weight: 2.2 }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#9a9a9a' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#7b7b7b' }] },
  { featureType: 'administrative.province', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f3f3f1' }, { saturation: -48 }, { lightness: 10 }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#f0f0ee' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#ecece9' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ saturation: -55 }, { lightness: 12 }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e3eadc' }, { saturation: -20 }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e4e4e1' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9b9b9b' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }, { weight: 1.15 }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f6f4ef' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e6dfd0' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ lightness: 6 }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#e7e7e5' }] },
  { featureType: 'transit.station', stylers: [{ visibility: 'on' }] },
  { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ saturation: -10 }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c6d7e4' }, { saturation: -28 }, { lightness: 8 }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7a8b96' }] },
];

export const TRACKING_MAP_CSS = `
.sociva-track-overlay { position: absolute; pointer-events: none; will-change: transform; }
.sociva-vehicle { width: 56px; height: 56px; transform-origin: 50% 58%; filter: drop-shadow(0 3px 5px rgba(0,0,0,0.28)); }
.sociva-vehicle svg { display: block; width: 56px; height: 56px; }
.sociva-vehicle-bob { animation: sociva-vehicle-bob 2.6s ease-in-out infinite; transform-origin: 50% 70%; }
@keyframes sociva-vehicle-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.5px); }
}
.sociva-pin { width: 40px; height: 50px; transform: translate(-50%, -100%); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.32)); }
.sociva-pin svg { display: block; width: 40px; height: 50px; }
.sociva-dest-ring {
  position: absolute;
  left: 50%;
  top: 100%;
  width: 28px;
  height: 28px;
  margin-left: -14px;
  margin-top: -14px;
  border-radius: 999px;
  border: 2px solid rgba(52, 168, 83, 0.55);
  background: rgba(52, 168, 83, 0.12);
  animation: sociva-dest-pulse 2.6s ease-out infinite;
  pointer-events: none;
}
.sociva-dest-ring.arriving {
  border-color: rgba(52, 168, 83, 0.75);
  background: rgba(52, 168, 83, 0.18);
}
@keyframes sociva-dest-pulse {
  0% { transform: scale(0.9); opacity: 0.35; }
  70% { transform: scale(1.05); opacity: 0.08; }
  100% { transform: scale(1.08); opacity: 0; }
}
.sociva-recenter {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: #fff;
  border: none;
  box-shadow: 0 2px 10px rgba(0,0,0,0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #202124;
}
.sociva-recenter:active { transform: scale(0.94); }
`;

/** Top-down delivery scooter facing north. Rotation is applied in the overlay. */
export const VEHICLE_SCOOTER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" fill="none">
  <ellipse cx="36" cy="58" rx="13" ry="4.2" fill="rgba(0,0,0,0.18)"/>
  <g>
    <rect x="32.2" y="40" width="7.6" height="13" rx="3.6" fill="#1a1a1a"/>
    <circle cx="36" cy="53.2" r="5.4" fill="#1f1f1f" stroke="#fff" stroke-width="1.5"/>
    <circle cx="36" cy="53.2" r="2" fill="#9ca3af"/>
    <path d="M28 38.5c0-7.2 3.4-16.8 8-22.8 4.6 6 8 15.6 8 22.8 0 4.4-3.4 7-8 7s-8-2.6-8-7z" fill="#E53935"/>
    <path d="M30.4 37.2c.6-6.4 2.8-13.6 5.6-18.4 2.8 4.8 5 12 5.6 18.4" stroke="#fff" stroke-opacity="0.22" stroke-width="1.2"/>
    <rect x="24.5" y="28.2" width="23" height="3.2" rx="1.6" fill="#111"/>
    <circle cx="24.6" cy="29.8" r="2.1" fill="#374151"/>
    <circle cx="47.4" cy="29.8" r="2.1" fill="#374151"/>
    <path d="M33.4 18.2c.8-3.2 2.6-5.6 2.6-5.6s1.8 2.4 2.6 5.6c-1.6-.8-3.6-.8-5.2 0z" fill="#fff" opacity="0.35"/>
    <rect x="29.2" y="37.6" width="13.6" height="11.4" rx="2.6" fill="#B71C1C" stroke="#fff" stroke-width="1.3"/>
    <rect x="31" y="39.4" width="10" height="6.2" rx="1.4" fill="#7f1111"/>
    <path d="M31.4 37.6c0-2.2 1.8-3.6 4.6-3.6s4.6 1.4 4.6 3.6" stroke="#fff" stroke-width="1.2" fill="none"/>
    <ellipse cx="36" cy="34.6" rx="3.6" ry="2" fill="#111"/>
  </g>
</svg>`;

export const HOME_PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" fill="none">
  <path d="M20 48 L16.5 38 H23.5 Z" fill="#111"/>
  <circle cx="20" cy="20" r="15.2" fill="#111"/>
  <circle cx="20" cy="20" r="13.4" fill="#1a1a1a" stroke="#fff" stroke-width="1.6"/>
  <path d="M20 12.6 L28 19.4 V27.2 H23.2 V22.4 H16.8 V27.2 H12 V19.4 Z" fill="#fff"/>
</svg>`;

export const STORE_PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" fill="none">
  <path d="M20 48 L16.5 38 H23.5 Z" fill="#111"/>
  <circle cx="20" cy="20" r="15.2" fill="#111"/>
  <circle cx="20" cy="20" r="13.4" fill="#1a1a1a" stroke="#fff" stroke-width="1.6"/>
  <g fill="#fff">
    <rect x="13.6" y="12.8" width="1.25" height="6.2" rx="0.5"/>
    <rect x="15.7" y="12.8" width="1.25" height="6.2" rx="0.5"/>
    <rect x="17.8" y="12.8" width="1.25" height="6.2" rx="0.5"/>
    <rect x="14.6" y="18.2" width="3.8" height="2" rx="0.7"/>
    <rect x="15.55" y="19.2" width="1.9" height="9" rx="0.95"/>
    <ellipse cx="24.6" cy="16.1" rx="3.2" ry="3.7"/>
    <rect x="23.65" y="18.8" width="1.9" height="9.4" rx="0.95"/>
  </g>
</svg>`;

export const RECENTER_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="8 3 3 3 3 8"/>
  <polyline points="16 3 21 3 21 8"/>
  <polyline points="8 21 3 21 3 16"/>
  <polyline points="16 21 21 21 21 16"/>
</svg>`;
