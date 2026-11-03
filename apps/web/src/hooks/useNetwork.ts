import { useSyncExternalStore } from 'react';
import { network } from '../services/network.ts';

export function useNetwork() {
  return useSyncExternalStore(network.subscribe, network.getState);
}
