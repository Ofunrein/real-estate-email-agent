import { useMemo } from 'react';
import { manifest } from './canvas.manifest.js';

export function useScreenInit() {
  return useMemo(() => {
    if (typeof window === 'undefined') return {};
    const screenId = new URLSearchParams(window.location.search).get('mp_screen');
    if (!screenId) return {};
    return manifest?.screens?.[screenId]?.state ?? {};
  }, []);
}