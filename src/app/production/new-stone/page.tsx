'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Gem } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import DefineStoneStep from '@/components/new-stone/DefineStoneStep';
import CollectDataStep from '@/components/new-stone/CollectDataStep';
import TrainStep from '@/components/new-stone/TrainStep';
import { getDatasetStats } from '@/lib/runtimeClient';

type WizardStep = 'define' | 'collect' | 'train';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'define', label: '1. Tanımla' },
  { id: 'collect', label: '2. Veri topla' },
  { id: 'train', label: '3. Eğit' },
];

export default function NewStonePage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('define');
  const [stoneId, setStoneId] = useState('');
  const [stoneName, setStoneName] = useState('');
  const [isSymmetric, setIsSymmetric] = useState(true);
  const [counts, setCounts] = useState({ true: 0, false: 0 });

  const resetSession = useCallback(() => {
    setStoneId('');
    setStoneName('');
    setIsSymmetric(true);
    setCounts({ true: 0, false: 0 });
    setStep('define');
  }, []);

  const handleDeleted = useCallback(() => {
    resetSession();
    router.push('/production/new-stone');
  }, [resetSession, router]);

  const handleCreated = (info: {
    stoneId: string;
    name: string;
    isSymmetric: boolean;
  }) => {
    setStoneId(info.stoneId);
    setStoneName(info.name);
    setIsSymmetric(info.isSymmetric);
    setStep('collect');
  };

  const handleReadyToTrain = useCallback(async () => {
    try {
      const s = await getDatasetStats(stoneId);
      setCounts({ true: s.true, false: s.false });
    } catch {
      /* keep previous */
    }
    setStep('train');
  }, [stoneId]);

  const goCollect = useCallback(async () => {
    if (!stoneId) return;
    try {
      const s = await getDatasetStats(stoneId);
      setCounts({ true: s.true, false: s.false });
    } catch {
      /* ignore */
    }
    setStep('collect');
  }, [stoneId]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="px-4 py-2 flex items-center gap-3">
          <Link
            href="/production"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Production
          </Link>
          <div className="h-4 w-px bg-border" />
          <Gem className="w-4 h-4 text-primary" />
          <h1 className="text-sm font-semibold">Yeni Taş Tanıt</h1>
          {stoneName && (
            <Badge variant="secondary" className="text-[10px]">
              {stoneName}
            </Badge>
          )}
          <div className="flex-1" />
          <nav className="flex items-center gap-1">
            {STEPS.map((s) => {
              const active = s.id === step;
              const canJump =
                (s.id === 'define') ||
                (s.id === 'collect' && !!stoneId) ||
                (s.id === 'train' && !!stoneId);
              const done =
                (s.id === 'define' && step !== 'define') ||
                (s.id === 'collect' && step === 'train');
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!canJump}
                  onClick={() => {
                    if (s.id === 'define') setStep('define');
                    else if (s.id === 'collect') void goCollect();
                    else if (s.id === 'train') void handleReadyToTrain();
                  }}
                  className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                    active
                      ? 'bg-primary/15 text-primary font-semibold'
                      : done
                        ? 'text-emerald-400 hover:bg-emerald-500/10'
                        : canJump
                          ? 'text-muted-foreground hover:bg-muted/60'
                          : 'text-muted-foreground/40 cursor-not-allowed'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        {step === 'define' && <DefineStoneStep onCreated={handleCreated} />}
        {step === 'collect' && (
          <CollectDataStep
            stoneId={stoneId}
            stoneName={stoneName}
            isSymmetric={isSymmetric}
            onReadyToTrain={handleReadyToTrain}
            onBack={() => setStep('define')}
            onDeleted={handleDeleted}
          />
        )}
        {step === 'train' && (
          <TrainStep
            stoneId={stoneId}
            stoneName={stoneName}
            counts={counts}
            onContinueCollect={goCollect}
            onDeleted={handleDeleted}
          />
        )}
      </main>
    </div>
  );
}
