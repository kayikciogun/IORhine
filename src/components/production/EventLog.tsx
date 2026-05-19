'use client';

import type { RuntimeEvent } from '@/types/runtime';

interface LogEntry {
  id: number;
  ts: Date;
  text: string;
}

interface Props {
  entries: LogEntry[];
}

export default function EventLog({ entries }: Props) {
  return (
    <div className="rounded-md border border-border bg-muted/20 max-h-[160px] overflow-y-auto p-2 text-[10px] font-mono space-y-0.5">
      {entries.length === 0 && (
        <p className="text-muted-foreground">Henüz olay yok.</p>
      )}
      {entries.map((e, i) => (
        <div key={`${e.id}-${e.ts.getTime()}-${i}`} className="text-foreground/90">
          <span className="text-muted-foreground">
            {e.ts.toLocaleTimeString()}{' '}
          </span>
          {e.text}
        </div>
      ))}
    </div>
  );
}

export function runtimeEventToLogText(ev: RuntimeEvent): string {
  switch (ev.evt) {
    case 'state':
      return `state: ${ev.data.phase} (${ev.data.i}/${ev.data.total})`;
    case 'placed':
      return `placed #${ev.data.i} (${ev.data.took_ms} ms)`;
    case 'error':
      return `error [${ev.data.code}]: ${ev.data.msg}`;
    case 'operator_feed_required':
      return 'Taş besle (konveyör)';
    case 'glue_cell':
      return `Yapışkan karo ${ev.data.cell} → (${ev.data.x.toFixed(1)}, ${ev.data.y.toFixed(1)})`;
    case 'glue_sheet_exhausted':
      return 'glue_sheet_exhausted';
    case 'job_complete':
      return 'job_complete';
    default:
      return JSON.stringify(ev);
  }
}
