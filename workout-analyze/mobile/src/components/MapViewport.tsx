import { LocateFixed, Minus, Plus } from 'lucide-react'
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent, useEffect, useRef, useState } from 'react'

export interface MapTransform {
  readonly scale: number
  readonly x: number
  readonly y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 6
const DRAG_THRESHOLD_PX = 6

export const zoomAt = (transform: MapTransform, nextScale: number, anchor: { x: number; y: number }): MapTransform => {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale))
  const ratio = scale / transform.scale
  return {
    scale,
    x: anchor.x - (anchor.x - transform.x) * ratio,
    y: anchor.y - (anchor.y - transform.y) * ratio,
  }
}

export const movedBeyondClickThreshold = (distance: number) => distance >= DRAG_THRESHOLD_PX

interface PointerPosition { readonly x: number; readonly y: number }

export const MapViewport = ({ children, className, label, interactive = true, overlay }: {
  children: ReactNode
  className: string
  label: string
  interactive?: boolean
  overlay?: ReactNode
}) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, PointerPosition>())
  const previousPinch = useRef<{ distance: number; center: PointerPosition } | null>(null)
  const dragDistance = useRef(0)
  const suppressClick = useRef(false)
  const [transform, setTransform] = useState<MapTransform>({ scale: 1, x: 0, y: 0 })

  useEffect(() => {
    if (!interactive) setTransform({ scale: 1, x: 0, y: 0 })
  }, [interactive])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    let prior = { width: root.clientWidth, height: root.clientHeight }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (prior.width && prior.height && (width !== prior.width || height !== prior.height)) {
        setTransform({ scale: 1, x: 0, y: 0 })
      }
      prior = { width, height }
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const center = () => {
    const bounds = rootRef.current?.getBoundingClientRect()
    return { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 }
  }
  const local = (clientX: number, clientY: number) => {
    const bounds = rootRef.current?.getBoundingClientRect()
    return { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) }
  }
  const zoom = (factor: number, anchor = center()) => setTransform((current) => zoomAt(current, current.scale * factor, anchor))
  const reset = () => setTransform({ scale: 1, x: 0, y: 0 })
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY))
    dragDistance.current = 0
    suppressClick.current = false
  }
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const prior = pointers.current.get(event.pointerId)
    if (!interactive || !prior) return
    const next = local(event.clientX, event.clientY)
    pointers.current.set(event.pointerId, next)
    const active = [...pointers.current.values()]
    if (active.length === 1) {
      const dx = next.x - prior.x
      const dy = next.y - prior.y
      dragDistance.current += Math.hypot(dx, dy)
      if (movedBeyondClickThreshold(dragDistance.current)) suppressClick.current = true
      setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
      return
    }
    const [first, second] = active
    if (!first || !second) return
    const distance = Math.hypot(second.x - first.x, second.y - first.y)
    const pinchCenter = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const previous = previousPinch.current
    if (previous?.distance) {
      setTransform((current) => {
        const translated = { ...current, x: current.x + pinchCenter.x - previous.center.x, y: current.y + pinchCenter.y - previous.center.y }
        return zoomAt(translated, current.scale * distance / previous.distance, pinchCenter)
      })
      suppressClick.current = true
    }
    previousPinch.current = { distance, center: pinchCenter }
  }
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    previousPinch.current = null
  }
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!interactive) return
    event.preventDefault()
    zoom(Math.exp(-event.deltaY * 0.002), local(event.clientX, event.clientY))
  }
  const layerStyle = { '--map-x': `${transform.x}px`, '--map-y': `${transform.y}px`, '--map-scale': transform.scale } as CSSProperties

  return <div
    ref={rootRef}
    className={`${className}${interactive ? ' map-interactive' : ''}`}
    role="region"
    aria-label={label}
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerUp}
    onPointerCancel={pointerUp}
    onWheel={wheel}
    onClickCapture={(event) => {
      if (!suppressClick.current) return
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
    }}
  >
    <div className="map-transform-layer" style={layerStyle}>{children}</div>
    {overlay}
    {interactive && <div className="map-controls" aria-label="Map controls" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Zoom in" onClick={() => zoom(1.5)}><Plus /></button>
      <button type="button" aria-label="Zoom out" disabled={transform.scale === MIN_SCALE} onClick={() => zoom(1 / 1.5)}><Minus /></button>
      <button type="button" aria-label="Reset map view" disabled={transform.scale === MIN_SCALE && transform.x === 0 && transform.y === 0} onClick={reset}><LocateFixed /></button>
    </div>}
  </div>
}
