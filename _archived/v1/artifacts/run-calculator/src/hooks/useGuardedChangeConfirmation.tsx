import { useEffect, useRef, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";

type Question = { title: string; description: string; confirmLabel: string };
/** Session-only confirmation. Revoking the manager or closing the owner cancels it. */
export function useGuardedChangeConfirmation(identity: string, authorized: boolean) {
  const [question, setQuestion] = useState<Question | null>(null);
  const resolve = useRef<((answer: boolean) => void) | null>(null);
  function finish(answer: boolean) {
    const pending = resolve.current; resolve.current = null;
    setQuestion(null); pending?.(answer);
  }
  useEffect(() => {
    finish(false);
    return () => { resolve.current?.(false); resolve.current = null; };
  }, [identity, authorized]);
  const uiConfirm = (next: Question) => {
    if (!authorized || resolve.current) return Promise.resolve(false);
    setQuestion(next);
    return new Promise<boolean>((done) => { resolve.current = done; });
  };
  return { uiConfirm, confirmationDialog: authorized && question ? <AlertDialog open onOpenChange={(open) => { if (!open) finish(false); }}>
    <AlertDialogContent className="grid-cols-1 w-[calc(100vw-2rem)] min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere]">
      <AlertDialogHeader className="min-w-0"><AlertDialogTitle>{question.title}</AlertDialogTitle>
        <AlertDialogDescription>{question.description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter className="min-w-0"><AlertDialogCancel className="h-auto min-h-10 min-w-0 whitespace-normal" onClick={() => finish(false)}>Cancel</AlertDialogCancel>
        <AlertDialogAction className="h-auto min-h-10 min-w-0 whitespace-normal" onClick={() => finish(true)}>{question.confirmLabel}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog> : null };
}
