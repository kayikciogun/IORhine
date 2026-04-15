// Taş tipi tanımı
export interface StoneType {
  id: string;
  name: string;           // "Swarovski 4mm kristal"
  color: string;          // "#E24B4A" — viewer'da renk
  pickZOffset: number;    // Strip (tablo) yüzeyine göre G1 Z ofseti (mm)
  placeZOffset: number;   // Kumaş yüzeyine göre G1 Z ofseti (mm)
  contourIds: string[];   // DXF entity handle'ları
}

// Pick & Place yapılandırması (Strip + Makine ayarları birleşik)
export interface PickPlaceConfig {
  // Strip / Grid
  stripOriginX: number;
  stripOriginY: number;
  cellSize: number;        // 20mm — hücre boyutu
  rowLength: number;       // Satır başına max kutu
  cellGap: number;         // 0mm — hücreler arası boşluk
  contourOffset: number;   // 0.1-1.0mm — geçme payı (offset)
  /** Yeni taş tipi eklerken varsayılan pick Z offset (mm, tablo/strip yüzeyine göre). */
  defaultStonePickZMm: number;
  /** Yeni taş tipi eklerken varsayılan place Z offset (mm). */
  defaultStonePlaceZMm: number;

  // Makine / İşlem
  safeZ: number;
  rapidFeed: number;
  jogFeed: number;           // JOG hareketi (G0) mm/dk — modal ve manuel jog
  pickFeed: number;
  placeFeed: number;
  rotationAxis: 'E' | 'A';
  rotationFeed: number;
  stripAngle: number;
  vacuumOnDwell: number;     // Saniye (Marlin'de ms'ye çevrilir)
  vacuumOffDwell: number;    // Saniye (Marlin'de ms'ye çevrilir)
  vacuumOnCode: string;     // "M10" veya "M106 S255"
  vacuumOffCode: string;    // "M11" veya "M107"
  firmware: 'marlin' | 'standard'; // Firmware tipi (Ender3=Marlin, standart CNC=FluidNC/Mach3)
  /** Marlin: G28 sonrası G92 öncesi nozzle bu makine XY (mm) konumuna G0 ile gider. */
  marlinWorkspaceOriginX: number;
  marlinWorkspaceOriginY: number;
  /**
   * Marlin: G92 yapılan fiziksel noktanın strip+DXF dünyasındaki koordinatı (mm).
   * (0,0) = çizim orijinini tezgâhta G92 ile sıfırladınız (çoğu DXF).
   * Eski tek-sayı davranışı: burayı makine G92 ile aynı sayı yapın (çizim makine mm ile hizalıysa).
   */
  marlinDxfAtG92X: number;
  marlinDxfAtG92Y: number;
  /** Marlin: G92 sonrası strip yüzeyinde nozzle Z (mm) — elle ölçüp girin. */
  marlinStripZMm: number;
  /** Marlin: G92 sonrası kumaş yüzeyinde nozzle Z (mm) — elle ölçüp girin. */
  marlinFabricZMm: number;
}

// Yerleştirme sırası
export interface PlacementOrder {
  index: number;
  pickX: number;      // Strip üzerinde alma X
  pickY: number;      // Strip üzerinde alma Y
  placeX: number;     // Kumaş üzerinde bırakma X (DXF koordinatı)
  placeY: number;     // Kumaş üzerinde bırakma Y
  placeAngle: number; // Döndürme açısı (°)
}
