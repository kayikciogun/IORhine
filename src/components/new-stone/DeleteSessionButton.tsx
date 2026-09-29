'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { deleteDatasetStone } from '@/lib/runtimeClient';

interface Props {
  stoneId: string;
  stoneName: string;
  onDeleted: () => void;
  className?: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'destructive' | 'ghost';
  /** Liste satırı için sadece çöp ikonu */
  iconOnly?: boolean;
}

export default function DeleteSessionButton({
  stoneId,
  stoneName,
  onDeleted,
  className,
  size = 'sm',
  variant = 'outline',
  iconOnly = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteDatasetStone(stoneId);
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            className={
              iconOnly
                ? 'h-7 w-7 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300'
                : 'h-8 gap-1.5 text-xs text-red-400 border-red-500/40 hover:bg-red-500/10 hover:text-red-300'
            }
            disabled={busy}
            title="Session sil"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {!iconOnly && (busy ? 'Siliniyor…' : 'Session sil')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bu taş session&apos;ını sil?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">{stoneName}</strong>{' '}
                  (<code className="text-[11px]">{stoneId}</code>) için toplanan
                  tüm Düz/Ters crop&apos;lar ve manifest kalıcı olarak silinir.
                </p>
                <p className="text-amber-400/90">Bu işlem geri alınamaz.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
            <Button
              type="button"
              className="bg-red-600 hover:bg-red-500"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              {busy ? 'Siliniyor…' : 'Evet, sil'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p className="mt-1.5 text-[10px] text-red-400">{error}</p>
      )}
    </div>
  );
}
