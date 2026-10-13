import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Загрузка GET-эндпоинта + перезагрузка при возврате в приложение. */
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api<T>("GET", path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);

  useEffect(() => {
    reload();
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  return { data, setData, error, reload };
}
