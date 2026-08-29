import * as ImagePicker from "expo-image-picker";
import { useCallback, useMemo, useState } from "react";

import type { KycCapture, KycDocumentKind } from "@/components/tikis/kyc-uploader";

export type KycStatus = "not_started" | "in_progress" | "submitted" | "approved" | "rejected";

export type KycSubmission = {
  status: KycStatus;
  submittedAt: string | null;
  rejectionReason: string | null;
};

type KycState = {
  documents: Partial<Record<KycDocumentKind, KycCapture>>;
  submission: KycSubmission;
};

const INITIAL: KycState = {
  documents: {},
  submission: { status: "not_started", submittedAt: null, rejectionReason: null },
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function validateImage(mime: string | undefined, bytes: number): { ok: true; mime: "image/jpeg" | "image/png" | "image/webp" } | { ok: false; error: string } {
  if (!mime || !ALLOWED_MIME.has(mime)) return { ok: false, error: "Format non supporté. Utilisez JPEG, PNG ou WebP." };
  if (bytes > MAX_BYTES) return { ok: false, error: "L'image dépasse 5 Mo. Choisissez une photo plus légère." };
  return { ok: true, mime: mime as "image/jpeg" | "image/png" | "image/webp" };
}

export function useKyc() {
  const [state, setState] = useState<KycState>(INITIAL);
  const [loadingKind, setLoadingKind] = useState<KycDocumentKind | null>(null);

  const pickDocument = useCallback(async (kind: KycDocumentKind) => {
    setLoadingKind(kind);
    try {
      const camera = await ImagePicker.requestCameraPermissionsAsync();
      const media =
        camera.granted ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: kind === "selfie" ? [1, 1] : [16, 10], quality: 0.55, base64: true }) : null;
      const result = media && !media.canceled
        ? media
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: kind === "selfie" ? [1, 1] : [16, 10], quality: 0.55, base64: true });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const validation = validateImage(asset.mimeType, asset.fileSize ?? 0);
      if (!validation.ok) {
        throw new Error(validation.error);
      }
      if (!asset.base64) {
        throw new Error("Impossible de lire l'image. Réessayez.");
      }
      const capture: KycCapture = { kind, uri: asset.uri, base64: asset.base64, mime: validation.mime };
      setState((current) => ({
        ...current,
        documents: { ...current.documents, [kind]: capture },
        submission: current.submission.status === "approved" ? current.submission : { ...current.submission, status: "in_progress" },
      }));
    } finally {
      setLoadingKind(null);
    }
  }, []);

  const clearDocument = useCallback((kind: KycDocumentKind) => {
    setState((current) => {
      const next = { ...current.documents };
      delete next[kind];
      return { ...current, documents: next };
    });
  }, []);

  const submit = useCallback(async (): Promise<{ ok: true; submission: KycSubmission } | { ok: false; error: string }> => {
    const documents = state.documents;
    if (!documents["id-front"] || !documents["id-back"] || !documents.selfie) {
      return { ok: false, error: "Ajoutez les trois documents (recto, verso, selfie) avant de soumettre." };
    }
    setState((current) => ({ ...current, submission: { ...current.submission, status: "submitted", submittedAt: new Date().toISOString() } }));
    return { ok: true, submission: { status: "submitted", submittedAt: new Date().toISOString(), rejectionReason: null } };
  }, [state.documents]);

  const progress = useMemo(() => {
    const total = 3;
    const done = (["id-front", "id-back", "selfie"] as const).filter((kind) => Boolean(state.documents[kind])).length;
    return { done, total, complete: done === total };
  }, [state.documents]);

  return {
    state,
    progress,
    loadingKind,
    pickDocument,
    clearDocument,
    submit,
  };
}
