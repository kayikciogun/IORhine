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

export interface RuntimeClientConfig {
  restBaseUrl: string;
  controlWsUrl: string;
  cameraWsUrl?: string;
}

export function getDefaultRuntimeClientConfig(): RuntimeClientConfig {
  return defaultRuntimeConfig();
}

function rowsToCsv(rows: PlacementCsvRow[]): string {
  const header = 'id,target_x,target_y,target_angle,shape_id';
  const lines = rows.map(
    (r) =>
      `${r.id},${r.target_x},${r.target_y},${r.target_angle},${r.shape_id}`,
  );
  return [header, ...lines].join('\n');
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
  if (!res.ok) throw new Error(`getJobStatus failed: ${res.status}`);
  return res.json() as Promise<JobStatus>;
}

export async function getCalibration(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<CalibrationSummary> {
  const res = await fetch(`${config.restBaseUrl}/api/calibration`);
  if (!res.ok) throw new Error(`getCalibration failed: ${res.status}`);
  return res.json() as Promise<CalibrationSummary>;
}

export async function resetGlueSheet(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<void> {
  const res = await fetch(`${config.restBaseUrl}/api/glue_sheet/reset`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`resetGlueSheet failed: ${res.status}`);
}

export async function getGlueSheetStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<GlueSheetStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/glue_sheet/status`);
  if (!res.ok) throw new Error(`getGlueSheetStatus failed: ${res.status}`);
  return res.json() as Promise<GlueSheetStatus>;
}

export async function getVisionSettings(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<VisionSettings & { threshold_auto?: boolean }> {
  const res = await fetch(`${config.restBaseUrl}/api/vision/settings`);
  if (!res.ok) throw new Error(`getVisionSettings failed: ${res.status}`);
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
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `updateVisionSettings failed`);
  }
}

export async function listCameraDevices(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<CameraDeviceList> {
  const res = await fetch(`${config.restBaseUrl}/api/camera/devices`);
  if (!res.ok) throw new Error(`listCameraDevices failed: ${res.status}`);
  return res.json() as Promise<CameraDeviceList>;
}

export async function getCameraStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<CameraStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/camera/status`);
  if (!res.ok) throw new Error(`getCameraStatus failed: ${res.status}`);
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
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail ?? `selectCamera failed: ${res.status}`,
    );
  }
  return res.json() as Promise<{ ok: boolean; config: CameraSourceConfig }>;
}

export async function listMotionPorts(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<MotionPortList> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/ports`);
  if (!res.ok) throw new Error(`listMotionPorts failed: ${res.status}`);
  return res.json() as Promise<MotionPortList>;
}

export async function getMotionStatus(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<MotionStatus> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/status`);
  if (!res.ok) throw new Error(`getMotionStatus failed: ${res.status}`);
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
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail ?? `selectMotionPort failed: ${res.status}`,
    );
  }
  return res.json() as Promise<{ ok: boolean; status: MotionStatus }>;
}

export async function getMotionConfig(
  config: RuntimeClientConfig = getDefaultRuntimeClientConfig(),
): Promise<MotionConfig> {
  const res = await fetch(`${config.restBaseUrl}/api/motion/config`);
  if (!res.ok) throw new Error(`getMotionConfig failed: ${res.status}`);
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
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail ?? `updateMotionConfig failed: ${res.status}`,
    );
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
  },
): { send: (cmd: ControlCommand) => void; close: () => void } {
  const ws = new WebSocket(config.controlWsUrl);
  ws.onopen = () => handlers.onOpen?.();
  ws.onclose = () => handlers.onClose?.();
  ws.onerror = (e) => handlers.onError?.(e);
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data as string) as RuntimeEvent;
      handlers.onEvent(data);
    } catch (e) {
      handlers.onError?.(e);
    }
  };
  return {
    send: (cmd: ControlCommand) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
      }
    },
    close: () => ws.close(),
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
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data as string) as CameraWsMessage & {
        camera_warning?: string;
      };
      if (data.evt === 'frame') {
        handlers.onFrame(data);
        /* Kamera uyarısı frame ile gelir; WS kopmasın diye ayrı kanal */
      }
      if (data.evt === 'error') handlers.onError?.(data.data.msg);
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
