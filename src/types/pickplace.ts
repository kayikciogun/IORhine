// Taş tipi tanımı
export interface StoneType {
  id: string;
  name: string;
  color: string;
  contourIds: string[];   // DXF entity handle'ları
}

// Pick & Place yapılandırması (strip / grid)
export interface PickPlaceConfig {
  stripOriginX: number;
  stripOriginY: number;
  cellSize: number;
  rowLength: number;
  cellGap: number;
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
}
