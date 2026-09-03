import { useEffect } from "react";

type Tone = "default" | "danger" | "primary" | "warning";

type Props = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Affiche une double confirmation : l'utilisateur doit retaper la valeur attendue. */
  doubleCheckValue?: string;
};

const TONE_CLASS: Record<Tone, string> = {
  default: "btn-primary",
  danger: "btn-danger",
  primary: "btn-primary",
  warning: "btn-danger",
};

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirmer", cancelLabel = "Annuler", tone = "default", busy = false, onConfirm, onCancel, doubleCheckValue }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (busy) return;
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title" className="modal-title">{title}</h3>
        <div className="modal-body">{description}</div>
        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${TONE_CLASS[tone]}`} disabled={busy} onClick={onConfirm}>{busy ? "…" : confirmLabel}</button>
        </div>
        {doubleCheckValue ? <DoubleCheckInput value={doubleCheckValue} onMatch={onConfirm} busy={busy} /> : null}
      </div>
    </div>
  );
}

function DoubleCheckInput({ value, onMatch, busy }: { value: string; onMatch: () => void; busy: boolean }) {
  return (
    <div className="modal-double-check">
      <p className="muted" style={{ fontSize: 11.5 }}>Pour confirmer, retapez <code>{value}</code> ci-dessous puis appuyez sur Entrée :</p>
      <input
        className="input"
        autoFocus
        disabled={busy}
        placeholder={value}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.currentTarget.value === value)) onMatch();
        }}
      />
    </div>
  );
}
