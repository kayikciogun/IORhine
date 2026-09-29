export type StoneLabel = 'unlabeled' | 'true' | 'false' | 'skip';

export interface LabelBox {
  id: number;
  bx1: number;
  by1: number;
  bx2: number;
  by2: number;
  contour: [number, number][] | null;
  cx: number;
  cy: number;
}

export interface LabelUiState {
  boxes: LabelBox[];
  labels: Record<number, StoneLabel>;
  selectedId: number | null;
  history: Array<{ id: number; prev: StoneLabel }>;
  pulseId: number | null;
  toast: string | null;
}

export type LabelAction =
  | { type: 'RESET'; boxes: LabelBox[] }
  | { type: 'SELECT'; id: number }
  | { type: 'LABEL'; id: number; label: StoneLabel }
  | { type: 'UNDO' }
  | { type: 'CLEAR_PULSE' }
  | { type: 'CLEAR_TOAST' };

function nextUnlabeled(
  labels: Record<number, StoneLabel>,
  boxes: LabelBox[],
  afterId: number | null,
): number | null {
  if (boxes.length === 0) return null;
  const startIdx =
    afterId == null
      ? -1
      : boxes.findIndex((b) => b.id === afterId);
  for (let i = 1; i <= boxes.length; i++) {
    const idx = (startIdx + i) % boxes.length;
    const id = boxes[idx].id;
    if ((labels[id] ?? 'unlabeled') === 'unlabeled') return id;
  }
  // Hepsi etiketlendi — sıradaki kutuya geç
  if (afterId == null) return boxes[0]?.id ?? null;
  const cur = boxes.findIndex((b) => b.id === afterId);
  return boxes[(cur + 1) % boxes.length]?.id ?? null;
}

export function labelReducer(
  state: LabelUiState,
  action: LabelAction,
): LabelUiState {
  switch (action.type) {
    case 'RESET': {
      const labels: Record<number, StoneLabel> = {};
      for (const b of action.boxes) labels[b.id] = 'unlabeled';
      return {
        boxes: action.boxes,
        labels,
        selectedId: action.boxes[0]?.id ?? null,
        history: [],
        pulseId: null,
        toast: null,
      };
    }
    case 'SELECT':
      return { ...state, selectedId: action.id };
    case 'LABEL': {
      const prev = state.labels[action.id] ?? 'unlabeled';
      if (prev === action.label) {
        // Aynı etiket — yine de ilerlemeye izin ver
        const nextId = nextUnlabeled(state.labels, state.boxes, action.id);
        return {
          ...state,
          selectedId: nextId,
          pulseId: action.id,
          toast: toastText(action.id, action.label),
        };
      }
      const labels = { ...state.labels, [action.id]: action.label };
      const nextId = nextUnlabeled(labels, state.boxes, action.id);
      return {
        ...state,
        labels,
        selectedId: nextId,
        history: [...state.history.slice(-49), { id: action.id, prev }],
        pulseId: action.id,
        toast: toastText(action.id, action.label),
      };
    }
    case 'UNDO': {
      const last = state.history[state.history.length - 1];
      if (!last) return state;
      const labels = { ...state.labels, [last.id]: last.prev };
      return {
        ...state,
        labels,
        selectedId: last.id,
        history: state.history.slice(0, -1),
        pulseId: last.id,
        toast: `#${last.id} geri alındı`,
      };
    }
    case 'CLEAR_PULSE':
      return { ...state, pulseId: null };
    case 'CLEAR_TOAST':
      return { ...state, toast: null };
    default:
      return state;
  }
}

function toastText(id: number, label: StoneLabel): string {
  if (label === 'true') return `#${id} → Düz`;
  if (label === 'false') return `#${id} → Ters`;
  if (label === 'skip') return `#${id} → Atlandı`;
  return `#${id} → Temizlendi`;
}

export function initialLabelState(): LabelUiState {
  return {
    boxes: [],
    labels: {},
    selectedId: null,
    history: [],
    pulseId: null,
    toast: null,
  };
}

export function boxFromDetected(o: {
  id: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  bx1?: number;
  by1?: number;
  bx2?: number;
  by2?: number;
  contour?: [number, number][] | number[][] | null;
}): LabelBox {
  const bw = Math.max(4, o.w || 40);
  const bh = Math.max(4, o.h || 40);
  const bx1 = o.bx1 ?? Math.round(o.cx - bw / 2);
  const by1 = o.by1 ?? Math.round(o.cy - bh / 2);
  const bx2 = o.bx2 ?? Math.round(o.cx + bw / 2);
  const by2 = o.by2 ?? Math.round(o.cy + bh / 2);
  let contour: [number, number][] | null = null;
  if (Array.isArray(o.contour) && o.contour.length >= 3) {
    contour = o.contour.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
  }
  return { id: o.id, bx1, by1, bx2, by2, contour, cx: o.cx, cy: o.cy };
}
