import { useEffect, useState } from "react";

import type { DocumentModel } from "@/lib/contract/schemas";

export type DocumentModelState = {
  model: DocumentModel | null;
  error: string | null;
};

type Loaded = { key: string; model: DocumentModel | null; error: string | null };

/**
 * Loads a document model once per `key` (null loads nothing). A response for an earlier
 * key is ignored.
 */
export function useDocumentModel(
  key: string | null,
  load: () => Promise<DocumentModel>,
): DocumentModelState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (key === null) {
      return;
    }

    let stale = false;

    load()
      .then((model) => {
        if (!stale) {
          setLoaded({ key, model, error: null });
        }
      })
      .catch((loadError: Error) => {
        if (!stale) {
          setLoaded({ key, model: null, error: loadError.message });
        }
      });

    return () => {
      stale = true;
    };
    // `load` is rebuilt every render, and `key` names what it loads.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loaded === null || loaded.key !== key) {
    return { model: null, error: null };
  }

  return { model: loaded.model, error: loaded.error };
}
