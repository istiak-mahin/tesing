import { useCallback } from 'react';
import { initializeLegacyApp } from '../legacy/legacyApp';

export function useLegacyApp() {
  return useCallback(() => {
    initializeLegacyApp();
  }, []);
}
