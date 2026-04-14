// Taş tipi tanımı
export interface StoneType {
  id: string;
  name: string;           // "Swarovski 4mm kristal"
  color: string;          // "#E24B4A" — viewer'da renk
  pickZOffset: number;    // -3.5mm
  placeZOffset: number;   // -1.0mm
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

  // Makine / İşlem
  safeZ: number;
  rapidFeed: number;
  pickFeed: number;
  placeFeed: number;
  rotationAxis: 'E' | 'A';
  rotationFeed: number;
  stripAngle: number;
  vacuumOnDwell: number;
  vacuumOffDwell: number;
  vacuumOnCode: string;    // "M10" veya "M106 S255"
  vacuumOffCode: string;   // "M11" veya "M107"
  probeEnabled: boolean;
  probeMode: 'startup' | 'periodic' | 'every_stone';
  probePeriod: number;
  probeOffsetX: number;         // XY: Probe → Nozzle X mesafesi (mm)
  probeOffsetY: number;         // XY: Probe → Nozzle Y mesafesi (mm)
  probeNozzleOffsetZ: number;   // Z:  Probe tetiklenme noktası ile nozzle ucu arasındaki Yükseklik (+ = nozzle yukarıda)
  stripProbeX: number;
  stripProbeY: number;
  fabricProbeX: number;
  fabricProbeY: number;
  probeFeed: number;
  probeRetract: number;
}

// Yerleştirme sırası
export interface PlacementOrder {
  index: number;
  pickX: number;      // Sabit (konveyör aynı noktaya getirir)
  pickY: number;
  pickZ: number;      // stoneType.pickZOffset
  placeX: number;     // Desen koordinatı
  placeY: number;
  placeZ: number;     // stoneType.placeZOffset
  placeAngle: number; // Desen açısı (°)
}
