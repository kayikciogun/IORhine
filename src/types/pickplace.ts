// Taş tipi tanımı
export interface StoneType {
  id: string;
  name: string;
  color: string;
  contourIds: string[];   // DXF entity handle'ları
  thickness: number;       // mm — pick/place Z offset
}

// Pick & Place yapılandırması (strip / grid)
export interface PickPlaceConfig {
  stripOriginX: number;
  stripOriginY: number;
  cellSize: number;
  rowLength: number;
  // P2-B17: ``cellGap`` kaldırıldı — strip generation zaten ``cellSize``
  // kullanıyor, gap feature drop edilmişti (dead field). Eski JSON'larda
  // varsa ignore edilir (backward-compat).
}

// Yerleştirme sırası (CSV export)
export interface PlacementOrder {
  index: number;
  stoneTypeId: string;
  shapeId: string;        // DXF kontur handle
  pickX: number;
  pickY: number;
  placeX: number;
  placeY: number;
  placeAngle: number;
  thickness: number;       // mm — taş kalınlığı
}
