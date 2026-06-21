'use client';

import { Check, FileText, Gem, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PipelineStep, PipelineStepId } from '@/lib/planningPipeline';

interface Props {
  steps: PipelineStep[];
}

// P3-E36: ``any`` → ``LucideIcon`` (proper type for lucide icon components).
const stepMeta: Record<PipelineStepId, { icon: LucideIcon; label: string }> = {
  dxf: { icon: FileText, label: 'DXF Yükle' },
  stones: { icon: Gem, label: 'Taş Atama' },
  send: { icon: Send, label: 'Makineye Gönder' },
};

export default function PipelineChecklist({ steps }: Props) {
  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const { icon: Icon } = stepMeta[step.id];
        const isDone = step.done;
        const isActive = i === activeIndex;

        return (
          <li
            key={step.id}
            className={`relative flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
              isDone
                ? 'border-green-500/30 bg-green-500/5'
                : isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border/60 bg-muted/20'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {isDone ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="w-3.5 h-3.5" />
                </span>
              ) : isActive ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary text-primary">
                  <Icon className="w-3 h-3" />
                </span>
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/30 text-muted-foreground/40">
                  <Icon className="w-3 h-3" />
                </span>
              )}
            </span>

            <div className="flex-1 min-w-0">
              <span
                className={`block text-xs font-semibold ${
                  isDone
                    ? 'text-foreground'
                    : isActive
                      ? 'text-primary'
                      : 'text-muted-foreground'
                }`}
              >
                {i + 1}. {step.label}
              </span>
              {step.hint && (
                <span
                  className={`block text-[11px] mt-0.5 leading-snug ${
                    isActive ? 'text-primary/80' : 'text-muted-foreground/70'
                  }`}
                >
                  {step.hint}
                </span>
              )}
            </div>

            {isDone && (
              <span className="self-center text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                Tamam
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
