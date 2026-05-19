'use client';

import { Check, Circle } from 'lucide-react';
import type { PipelineStep } from '@/lib/planningPipeline';

interface Props {
  steps: PipelineStep[];
}

export default function PipelineChecklist({ steps }: Props) {
  return (
    <ol className="space-y-1.5 text-[11px]">
      {steps.map((step, i) => (
        <li key={step.id} className="flex gap-2 items-start">
          <span className="mt-0.5 shrink-0">
            {step.done ? (
              <Check className="w-3.5 h-3.5 text-primary" aria-hidden />
            ) : (
              <Circle className="w-3.5 h-3.5 text-muted-foreground/40" aria-hidden />
            )}
          </span>
          <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>
            <span className="font-medium">{i + 1}.</span> {step.label}
            {step.hint && (
              <span className="block text-[10px] text-muted-foreground/80 mt-0.5">
                {step.hint}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
