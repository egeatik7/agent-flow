import { useEffect, useState } from 'react'

export type ViewerDevice = 'phone' | 'tablet' | 'desktop'

/** Native Android screen class wins over viewport size, orientation and split-screen. */
export function viewerDevice(userAgent: string, width: number, height: number, touchPoints = 0): ViewerDevice {
  const native = /\bNubboDevice\/(phone|tablet)\b/i.exec(userAgent)
  if (native) return native[1].toLowerCase() as 'phone' | 'tablet'
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) return 'tablet'
  if (/iPhone|iPod/i.test(userAgent)) return 'phone'
  if (/Android/i.test(userAgent)) {
    const shortEdge = Math.min(width, height)
    return shortEdge > 0 && shortEdge >= 600 ? 'tablet' : 'phone'
  }
  return 'desktop'
}

export function useViewerDevice(): ViewerDevice {
  const read = () => viewerDevice(navigator.userAgent, window.screen.width, window.screen.height, navigator.maxTouchPoints)
  const [device, setDevice] = useState(read)
  useEffect(() => {
    const refresh = () => setDevice(read())
    window.addEventListener('resize', refresh)
    return () => window.removeEventListener('resize', refresh)
  }, [])
  return device
}
