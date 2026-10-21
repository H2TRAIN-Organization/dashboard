import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

// Hook to detect whether the application has hydrated on the client.
export function useHydration() {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
