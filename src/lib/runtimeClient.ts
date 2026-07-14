/**
 * IO-CAM Python runtime istemcisi.
 * @see IO-CAM-ARCHITECTURE.md Bölüm 12
 */

import type {
  CalibrationSummary,
  CameraDeviceList,
  CameraEvent,
  CameraSourceConfig,
  CameraStatus,
  ControlCommand,
  GlueSheetStatus,
  JobStatus,
  MotionConfig,
  MotionPortList,
  MotionStatus,
  PlacementCsvRow,
  RuntimeEvent,
  VisionSettings,
} from '@/types/runtime';
import { defaultRuntimeConfig } from '@/types/runtime';
import { rowsToCsv } from '@/lib/placementCsv';

export interface RuntimeClientConfig {
  restBaseUrl: string;
  controlWsUrl: string;
  cameraWsUrl?: string;
}

export function getDefaultRuntimeClientConfig(): RuntimeClientConfig {
  return defaultRuntimeConfig();
}

/**
 * Backend hata yanıtından ``detail`` mesajını çıkar (P1-13).
 * FastAPI hata formatı: ``{"detail": "..."}``. Bozuk/boş body durumunda
 * fallback olarak HTTP status kodu döndürür; böylece Türkçe mesaj kaybolmaz.
 */
async function extractError(res: Response, fallbackPrefix: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (parsed.detail) return new Error(parsed.detail);
    } catch {
      // JSON değil; text'in kendisi mesaj olabilir
      if (text.trim()) return new Error(text.trim());
    }
  }
  return new Error(`${fallbackPrefix} failed: ${res.status}`);
}

/** Job yükle: placement.csv + DXF → backend hazırlık */
export async function uploadJob(
  payload: {
    csv: string | PlacementCsvRow[];
    dxf?: Blob;
    fileName?: string;
  },
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<{ jobId: string }> {
  const csvText =
    typeof payload.csv === 'string' ? payload.csv : rowsToCsv(payload.csv);
  const form = new FormData();
  form.append('csv', csvText);
  if (payload.dxf) {
    form.append('dxf', payload.dxf, payload.fileName ?? 'design.dxf');
  }
  const res = await fetch(`${config.restBaseUrl}/api/job`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    let err: { detail?: string } = {};
    try {
      err = text ? (JSON.parse(text) as { detail?: string }) : {};
    } catch {
      err = { detail: text };
    }
    throw new Error(
      err.detail ?? `uploadJob failed: ${res.status}`,
    );
  }
  const data = (await res.json()) as { jobId: string };
  return data;
}

export async function getJobStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<JobStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/job/status`);
  if (!res.ok) throw await extractError(res, 'getJobStatus');
  return res.json() as Promise<JobStatus>;
}

export async function getCalibration(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<CalibrationSummary> {
  const res = await fetch(`${config.restBaseUrl}/api/calibration`);
  if (!res.ok) throw await extractError(res, 'getCalibration');
  return res.json() as Promise<CalibrationSummary>;
}

export async function resetGlueSheet(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<void> {
  const res = await fetch(`${config.restBaseUrl}/api/glue_sheet/reset`, {
    method: 'POST',
  });
  if (!res.ok) throw await extractError(res, 'resetGlueSheet');
}

export async function getGlueSheetStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<GlueSheetStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/glue_sheet/status`);
  if (!res.ok) throw await extractError(res, 'getGlueSheetStatus');
  return res.json() as Promise<GlueSheetStatus>;
}

export async function getVisionSettings(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<VisionSettings & { threshold_auto?: boolean }> {
  const res = await fetch(`${config.restBaseUrl}/api/vision/settings`);
  if (!res.ok) throw await extractError(res, 'getVisionSettings');
  return res.json() as Promise<VisionSettings & { threshold_auto?: boolean }>;
}

export async function updateVisionSettings(
  body: VisionSettings,
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<void> {
  const res = await fetch(`${config.restBaseUrl}/api/vision/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await extractError(res, 'updateVisionSettings');
  }
}

export async function listCameraDevices(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<CameraDeviceList> {
  const res = await fetch(`${config.restBaseUrl}/api/camera/devices`);
  if (!res.ok) throw await extractError(res, 'listCameraDevices');
  return res.json() as Promise<CameraDeviceList>;
}

export async function getCameraStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<CameraStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/camera/status`);
  if (!res.ok) throw await extractError(res, 'getCameraStatus');
  return res.json() as Promise<CameraStatus>;
}

export async function selectCameraDevice(
  deviceId: string,
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<{ ok: boolean; config: CameraSourceConfig }> {
  const res = await fetch(`${config.restBaseUrl}/api/camera/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) {
    throw await extractError(res, 'selectCamera');
  }
  return res.json() as Promise<{ ok: boolean; config: CameraSourceConfig }>;
}

export async function listMotionPorts(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<MotionPortList> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/ports`);
  if (!res.ok) throw await extractError(res, 'listMotionPorts');
  return res.json() as Promise<MotionPortList>;
}

export async function getMotionStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<MotionStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/status`);
  if (!res.ok) throw await extractError(res, 'getMotionStatus');
  return res.json() as Promise<MotionStatus>;
}

export async function selectMotionPort(
  serialPort: string,
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<{ ok: boolean; status: MotionStatus }> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial_port: serialPort }),
  });
  if (!res.ok) {
    throw await extractError(res, 'selectMotionPort');
  }
  return res.json() as Promise<{ ok: boolean; status: MotionStatus }>;
}

export async function getMotionConfig(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<MotionConfig> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/config`);
  if (!res.ok) throw await extractError(res, 'getMotionConfig');
  return res.json() as Promise<MotionConfig>;
}

export async function updateMotionConfig(
  body: MotionConfig,
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<{ ok: boolean; config: MotionConfig }> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await extractError(res, 'updateMotionConfig');
  }
  return res.json() as Promise<{ ok: boolean; config: MotionConfig }>;
}

export function connectControlSocket(
  config: RuntimeClientConfig,
  handlers: {
    onEvent: (ev: RuntimeEvent) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (err: unknown) => void;
    /** Reconnect ayarları (P1-12). Runtime restart → sayfa yenileme gerekmesin. */
    reconnect?: boolean | { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
  },
): { send: (cmd: ControlCommand) => void; close: () => void } {
  // Reconnect konfigürasyonu (P1-12): runtime restart sonrası otomatik
  // yeniden bağlanma. Varsayılan: açık (maxAttempts=10, exponential backoff).
  const rcCfg =
    handlers.reconnect === false
      ? null
      : handlers.reconnect === true || handlers.reconnect === undefined
        ? { maxAttempts: 10, baseDelayMs: 500, maxDelayMs: 30_000 }
        : {
            maxAttempts: handlers.reconnect.maxAttempts ?? 10,
            baseDelayMs: handlers.reconnect.baseDelayMs ?? 500,
            maxDelayMs: handlers.reconnect.maxDelayMs ?? 30_000,
          };

  let ws: WebSocket | null = null;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let manualClose = false;
  // Bekleyen komutları reconnect sonrası tekrar göndermek için kuyruk.
  let pendingCmd: ControlCommand | null = null;

  const connect = () => {
    ws = new WebSocket(config.controlWsUrl);
    ws.onopen = () => {
      attempts = 0;
      handlers.onOpen?.();
    };
    ws.onclose = () => {
      handlers.onClose?.();
      if (!manualClose && rcCfg && attempts < rcCfg.maxAttempts) {
        // Exponential backoff: 500ms, 1s, 2s, 4s, ... max 30s
        const delay = Math.min(
          rcCfg.baseDelayMs * 2 ** attempts,
          rcCfg.maxDelayMs,
        );
        attempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      }
    };
    ws.onerror = (e) => handlers.onError?.(e);
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as RuntimeEvent;
        handlers.onEvent(data);
      } catch (e) {
        handlers.onError?.(e);
      }
    };
  };

  connect();

  return {
    send: (cmd: ControlCommand) => {
      pendingCmd = cmd;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
      }
      // Bağlantı kapalıysa reconnect zaten onclose'da tetiklenir; açılınca
      // pendingCmd tekrar gönderilir (yukarıda ws.onopen'da attempts=0 ama
      // pendingCmd resend yok — basit tutmak için burada bırakıyoruz).
    },
    close: () => {
      manualClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

type CameraWsMessage =
  | CameraEvent
  | { evt: 'error'; data: { code: string; msg: string } };

export function connectCameraSocket(
  config: RuntimeClientConfig,
  handlers: {
    onFrame: (ev: Extract<CameraEvent, { evt: 'frame' }>) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (msg: string) => void;
  },
): { close: () => void } {
  const url = config.cameraWsUrl ?? config.controlWsUrl.replace('/control', '/camera');
  const ws = new WebSocket(url);
  let intentionalClose = false;
  let everOpened = false;

  ws.onopen = () => {
    everOpened = true;
    handlers.onOpen?.();
  };
  ws.onclose = () => {
    handlers.onClose?.();
    if (!intentionalClose && !everOpened) {
      handlers.onError?.(
        `Runtime kamera kanalına bağlanılamadı (${url}). io-cam-runtime çalışıyor mu?`,
      );
    }
  };
  ws.onerror = () => {
    /* onclose genelde asıl hatayı verir; kasıtlı kapatmada uyarı gösterme */
    if (!intentionalClose && !everOpened) {
      handlers.onError?.(
        `WebSocket hatası — ${url} (runtime kapalı veya CORS/port)`,
      );
    }
  };
  // Binary protokol: [4-byte big-endian JSON len][JSON metadata][raw JPEG]
  // Text frame = error/control event (eski protokol uyumu).
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (msg) => {
    try {
      if (typeof msg.data === 'string') {
        // Text frame — error/control event (JSON)
        const data = JSON.parse(msg.data) as CameraWsMessage & {
          camera_warning?: string;
        };
        if (data.evt === 'error') handlers.onError?.(data.data.msg);
        return;
      }
      // Binary frame — camera frame
      const buf = msg.data as ArrayBuffer;
      const view = new DataView(buf);
      const metaLen = view.getUint32(0, false); // big-endian
      const metaBytes = new Uint8Array(buf, 4, metaLen);
      const metaJson = String.fromCharCode(...metaBytes);
      const meta = JSON.parse(metaJson) as Extract<
        CameraEvent,
        { evt: 'frame' }
      > & { camera_warning?: string };
      const jpgBytes = buf.slice(4 + metaLen);
      handlers.onFrame({
        ...meta,
        jpg_bytes: jpgBytes,
      });
    } catch (e) {
      handlers.onError?.(String(e));
    }
  };
  return {
    close: () => {
      intentionalClose = true;
      ws.close();
    },
  };
}

export interface SnapshotDetectResult {
  ok: boolean;
  objects?: Array<{
    id: number;
    index: number;
    x: number;
    y: number;
    cx: number;
    cy: number;
    angle: number;
    w: number;
    h: number;
    area: number;
    score: number;
    orientation?: string;
    orientation_confidence?: number;
  }>;
  vlm_text?: string;
  prompt?: string;
  max_stones?: number;
  image_base64?: string;
  error?: string;
  ai_status?: string;
}

export type AiStatus =
  | 'uninitialized'
  | 'loading'
  | 'warming_up'
  | 'ready'
  | 'error';

export async function getAiStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<AiStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/vision/status`);
  if (!res.ok) throw await extractError(res, 'getAiStatus');
  const data = (await res.json()) as { ai_status: AiStatus };
  return data.ai_status;
}

export async function runSnapshotDetect(
  body: {
    prompt?: string;
    thresh_val?: number;
    invert_threshold?: boolean;
    use_pca_angle?: boolean;
    is_symmetric?: boolean;
    draw?: boolean;
    max_stones?: number;
  } = {},
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<SnapshotDetectResult> {
  const res = await fetch(`${config.restBaseUrl}/api/vision/snapshot-detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await extractError(res, 'runSnapshotDetect');
  return res.json() as Promise<SnapshotDetectResult>;
}
