'use client';

import { useEffect, useState } from 'react';
import { Loader2, BrainCircuit, CheckCircle2, ServerCrash } from 'lucide-react';
import { getDefaultRuntimeClientConfig } from '@/lib/runtimeClient';

export default function BootScreen({ onReady }: { onReady: () => void }) {
  const [aiStatus, setAiStatus] = useState<string>('uninitialized');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const checkStatus = async () => {
      try {
        const base = getDefaultRuntimeClientConfig().restBaseUrl;
        const res = await fetch(`${base}/health`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Backend is not responding. Waiting for startup...');
        }
        const data = await res.json();
        setAiStatus(data.ai_status || 'uninitialized');
        setError(null);

        if (data.ai_status === 'ready') {
          setTimeout(onReady, 800); // Small delay for smooth exit animation
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Connection failed');
      }
    };

    checkStatus();
    interval = setInterval(checkStatus, 1500);

    return () => clearInterval(interval);
  }, [onReady]);

  const steps = [
    { id: 'loading', label: 'Loading Model Weights' },
    { id: 'warming_up', label: 'Compiling MLX Graph' },
    { id: 'ready', label: 'System Ready' }
  ];

  const getStepStatus = (stepId: string) => {
    if (aiStatus === 'ready') return 'done';
    if (aiStatus === 'warming_up') {
      if (stepId === 'loading') return 'done';
      if (stepId === 'warming_up') return 'active';
      return 'pending';
    }
    if (aiStatus === 'loading') {
      if (stepId === 'loading') return 'active';
      return 'pending';
    }
    return 'pending'; // uninitialized
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl transition-all duration-700">
      <div className="w-full max-w-md p-10 rounded-3xl bg-zinc-900/60 border border-white/5 shadow-2xl shadow-purple-500/10 flex flex-col items-center">
        <div className="relative mb-8 mt-4">
          <div className="absolute inset-0 bg-purple-500 rounded-full blur-2xl opacity-40 animate-pulse" />
          <BrainCircuit className="w-16 h-16 text-purple-400 relative z-10 animate-bounce" style={{ animationDuration: '3s' }} />
        </div>

        <h2 className="text-2xl font-bold text-white tracking-tight mb-2">IO-CAM Boot Sequence</h2>
        <p className="text-sm text-zinc-400 mb-10 text-center px-4">
          Initializing hardware and MLX vision models for Apple Silicon.
        </p>

        <div className="w-full space-y-6">
          {error && (
            <div className="w-full flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 animate-in fade-in slide-in-from-top-4">
              <ServerCrash className="w-5 h-5 shrink-0" />
              <p className="text-xs font-medium">{error}</p>
            </div>
          )}
          
          {steps.map((step, idx) => {
            const status = getStepStatus(step.id);
            return (
              <div key={step.id} className="flex items-center gap-5 transition-all duration-500">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                  status === 'done' ? 'bg-purple-500 border-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]' :
                  status === 'active' ? 'border-purple-400 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]' :
                  'border-zinc-800 text-zinc-700 bg-transparent'
                }`}>
                  {status === 'done' ? <CheckCircle2 className="w-5 h-5" /> : 
                   status === 'active' ? <Loader2 className="w-5 h-5 animate-spin" /> :
                   <span className="text-sm font-bold">{idx + 1}</span>}
                </div>
                <div className="flex flex-col">
                  <span className={`text-[15px] font-semibold transition-colors duration-500 ${
                    status === 'done' ? 'text-zinc-200' :
                    status === 'active' ? 'text-white drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]' :
                    'text-zinc-600'
                  }`}>
                    {step.label}
                  </span>
                  {status === 'active' && step.id === 'warming_up' && (
                    <span className="text-[11px] text-purple-400/80 animate-pulse mt-0.5">This takes ~30 seconds...</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
