import { useEffect, useState, type DependencyList } from 'react';

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Come useEffect, ma esegue l'effetto solo dopo `delay` ms senza cambi delle dipendenze. */
export function useDebouncedEffect(effect: () => void | (() => void), deps: DependencyList, delay: number): void {
  useEffect(() => {
    let cleanup: void | (() => void);
    const timer = setTimeout(() => {
      cleanup = effect();
    }, delay);
    return () => {
      clearTimeout(timer);
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** URL blob: per l'anteprima, revocato automaticamente quando cambia. */
export function useObjectUrl(): [string | null, (blob: Blob | null) => void] {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return [url, (blob) => setUrl(blob ? URL.createObjectURL(blob) : null)];
}
