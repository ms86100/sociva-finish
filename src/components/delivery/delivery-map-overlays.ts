/// <reference types="@types/google.maps" />
import type { LatLng } from '@/lib/delivery-tracking-geometry';
import { HOME_PIN_SVG, STORE_PIN_SVG, VEHICLE_SCOOTER_SVG } from '@/lib/delivery-map-style';

export type VehicleOverlayHandle = {
  setMap: (map: google.maps.Map | null) => void;
  setPose: (position: LatLng, heading: number) => void;
  setVisible: (visible: boolean) => void;
};

export type PinOverlayHandle = {
  setMap: (map: google.maps.Map | null) => void;
  setPosition: (position: LatLng) => void;
  setArriving?: (arriving: boolean) => void;
};

/** OverlayView subclasses must be created after the Maps script is present. */
export function createTrackingOverlays(): {
  VehicleOverlay: new (position: LatLng, heading?: number) => VehicleOverlayHandle & google.maps.OverlayView;
  PinOverlay: new (position: LatLng, kind: 'home' | 'store') => PinOverlayHandle & google.maps.OverlayView;
} {
  class VehicleOverlay extends google.maps.OverlayView implements VehicleOverlayHandle {
    private position: google.maps.LatLngLiteral;
    private heading: number;
    private div: HTMLDivElement | null = null;
    private inner: HTMLDivElement | null = null;
    private visible = true;

    constructor(position: LatLng, heading = 0) {
      super();
      this.position = position;
      this.heading = heading;
    }

    onAdd() {
      const div = document.createElement('div');
      div.className = 'sociva-track-overlay';
      div.style.zIndex = '120';
      const inner = document.createElement('div');
      inner.className = 'sociva-vehicle';
      inner.innerHTML = `<div class="sociva-vehicle-bob">${VEHICLE_SCOOTER_SVG}</div>`;
      div.appendChild(inner);
      this.div = div;
      this.inner = inner;
      this.getPanes()?.overlayMouseTarget.appendChild(div);
    }

    draw() {
      const proj = this.getProjection();
      if (!proj || !this.div || !this.inner) return;
      const pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
      if (!pt) return;
      this.div.style.display = this.visible ? 'block' : 'none';
      this.div.style.left = '0';
      this.div.style.top = '0';
      this.div.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      this.inner.style.transform = `translate(-50%, -58%) rotate(${this.heading}deg)`;
    }

    setPose(position: LatLng, heading: number) {
      this.position = position;
      this.heading = heading;
      this.draw();
    }

    setVisible(visible: boolean) {
      this.visible = visible;
      if (this.div) this.div.style.display = visible ? 'block' : 'none';
    }

    onRemove() {
      this.div?.remove();
      this.div = null;
      this.inner = null;
    }
  }

  class PinOverlay extends google.maps.OverlayView implements PinOverlayHandle {
    private position: google.maps.LatLngLiteral;
    private div: HTMLDivElement | null = null;
    private kind: 'home' | 'store';
    private arriving = false;

    constructor(position: LatLng, kind: 'home' | 'store') {
      super();
      this.position = position;
      this.kind = kind;
    }

    onAdd() {
      const div = document.createElement('div');
      div.className = 'sociva-track-overlay';
      div.style.zIndex = this.kind === 'home' ? '90' : '80';
      const pin = document.createElement('div');
      pin.className = 'sociva-pin';
      pin.innerHTML = this.kind === 'home' ? HOME_PIN_SVG : STORE_PIN_SVG;
      if (this.kind === 'home') {
        const ring = document.createElement('div');
        ring.className = 'sociva-dest-ring';
        pin.appendChild(ring);
      }
      div.appendChild(pin);
      this.div = div;
      this.getPanes()?.overlayImage.appendChild(div);
    }

    draw() {
      const proj = this.getProjection();
      if (!proj || !this.div) return;
      const pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
      if (!pt) return;
      this.div.style.left = `${pt.x}px`;
      this.div.style.top = `${pt.y}px`;
      this.div.style.transform = 'translate(-50%, -100%)';
    }

    setPosition(position: LatLng) {
      this.position = position;
      this.draw();
    }

    setArriving(arriving: boolean) {
      this.arriving = arriving;
      const ring = this.div?.querySelector('.sociva-dest-ring');
      if (ring) ring.classList.toggle('arriving', arriving);
    }

    onRemove() {
      this.div?.remove();
      this.div = null;
    }
  }

  return { VehicleOverlay, PinOverlay };
}
