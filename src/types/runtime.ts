/**
 * Python runtime ↔ Next.js köprüsü — tip sözleşmeleri.
 */

export type JobPhase =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'complete'
  | 'error';

export type CameraKind = 'usb' | 'mock';

export interface CameraDevice {
  id: string;
  label: string;
  kind: CameraKind;
  available: boolean;
  meta?: Record<string, unknown>;
}

export interface CameraDeviceList {
  usb: CameraDevice[];
}

export interface CameraSourceConfig {
  kind: CameraKind;
  source_id: string;
}

export interface CameraStatus {
  config: CameraSourceConfig | null;
  error: string;
  mock_hardware: boolean;
}

export interface MotionPort {
  id: string;
  path: string;
  label: string;
  description?: string;
  hwid?: string;
  manufacturer?: string | null;
  available: boolean;
}

export interface MotionStatus {
  mock_hardware: boolean;
  serial_port: string;
  motion_initialized: boolean;
}

export interface MotionConfig {
  rotation_axis: 'A' | 'E';
  safe_z: number;
  pick_z: number;
  glue_z: number;
  place_z: number;
  xy_feed: number;
  z_feed: number;
  rotation_feed: number;
  vacuum_on_dwell_s: number;
  vacuum_off_dwell_s: number;
  glue_dwell_s: number;
}

export interface MotionPortList {
  ports: MotionPort[];
  status: MotionStatus;
}

export interface JobStatus {
  phase: JobPhase;
  index: number;
  total: number;
  message?: string;
  job_id?: string;
}

export interface PlacementCsvRow {
  id: number;
  target_x: number;
  target_y: number;
  target_angle: number;
  shape_id: string;
}

export interface GlueSheetStatus {
  cursor: number;
  total: number;
  remaining: number;
  cols: number;
  rows: number;
}

export interface CalibrationSummary {
  homography: boolean;
  fabric_offset: boolean;
  glue_sheet: boolean;
  glue_sheet_state: boolean;
}

export interface VisionSettings {
  blur_kernel: number;
  fast_detect_threshold: number;
  min_contour_area: number;
  max_contour_area: number;
  show_mask: boolean;
  match_threshold: number;
  threshold_auto?: boolean;
}

export type ControlCommand =
  | { cmd: 'start' }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'stop' }
  | { cmd: 'estop' };

export type RuntimeEvent =
  | { evt: 'state'; data: { phase: JobPhase; i: number; total: number } }
  | { evt: 'placed'; data: { i: number; took_ms: number } }
  | { evt: 'error'; data: { code: string; msg: string } }
  | { evt: 'operator_feed_required'; data?: Record<string, never> }
  | { evt: 'glue_cell'; data: { cell: number; x: number; y: number } }
  | { evt: 'glue_sheet_exhausted'; data?: Record<string, never> }
  | { evt: 'job_complete'; data?: Record<string, never> };

export interface DetectedStone {
  id?: number;
  x: number;
  y: number;
  angle: number;
  score: number;
  area: number;
  index?: number;
  w?: number;
  h?: number;
  cx?: number;
  cy?: number;
}

export type CameraEvent =
  | {
      evt: 'frame';
      jpg_base64: string;
      stones: DetectedStone[];
      ts: number;
      fps?: number;
      mode?: 'fast' | 'full';
    };

export function defaultRuntimeConfig() {
  const base =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_RUNTIME_URL
      ? process.env.NEXT_PUBLIC_RUNTIME_URL.replace(/\/$/, '')
      : 'http://localhost:8000';
  const wsBase = base.replace(/^http/, 'ws');
  return {
    restBaseUrl: base,
    controlWsUrl: `${wsBase}/ws/control`,
    cameraWsUrl: `${wsBase}/ws/camera`,
  };
}

export const PHASE_LABELS: Record<JobPhase, string> = {
  idle: 'Beklemede',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  running: 'Çalışıyor',
  paused: 'Duraklatıldı',
  stopping: 'Durduruluyor',
  complete: 'Tamamlandı',
  error: 'Hata',
};
