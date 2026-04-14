export interface SelectedEntityInfo {
  type?: string;
  layer?: string;
  handle?: string;
  data?: {
    length?: number;
    circumference?: number;
    arcLength?: number;
    diameter?: number;
    radius?: number;
    center?: { x: number; y: number; z?: number };
    startPoint?: { x: number; y: number; z?: number };
    endPoint?: { x: number; y: number; z?: number };
    startAngle?: number; // Radians
    endAngle?: number; // Radians
    isClockwise?: boolean;
    vertexCount?: number;
    isClosed?: boolean;
  };
}

export interface SelectionInfo {
  count: number;
  details?: SelectedEntityInfo; // Tek seçim için
  detailsArray?: SelectedEntityInfo[]; // Çoklu seçim için
} 