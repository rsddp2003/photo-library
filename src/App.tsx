import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, CalendarDays, Folder, Image, MapPin, Sparkles, X } from "lucide-react"
import LiquidGlass from "./liquid-glass-react"
import { getLargeUrl, getThumbUrl } from "./oss"

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "")

type Photo = {
  id: string
  name: string
  url: string
  objectKey?: string
  date?: string
  sortIndex?: number
  width?: number
  height?: number
}

type ArrangedPhoto = Photo & {
  originalIndex: number
}

type LocationGroup = {
  id: string
  name: string
  photos: Photo[]
}

type YearGroup = {
  year: string
  locations: LocationGroup[]
}

type BackgroundImage = {
  id: string
  name: string
  url: string
  objectKey?: string
}

type BackgroundConfig = {
  intervalMinutes: 3 | 5 | 10
  currentIndex: number
  maskOpacity: number
  images: BackgroundImage[]
}

type BackgroundLayer = {
  key: string
  src: string
  phase: "active" | "enter" | "exit"
}

const fallbackYears: YearGroup[] = ["2015", "2017", "2018", "2019", "2020", "2021", "2022", "2023"].map((year) => ({
  year,
  locations: [],
}))

const liquidGlassChrome = {
  displacementScale: 72,
  blurAmount: 0.08,
  saturation: 155,
  aberrationIntensity: 0,
  elasticity: 0,
  cornerRadius: 34,
  mode: "prominent" as const,
}

function getYearCover(year: YearGroup) {
  const cover = year.locations.flatMap((location) => location.photos)[0]
  return getPhotoImagePath(cover)
}

function getPhotoCount(year: YearGroup) {
  return year.locations.reduce((sum, location) => sum + location.photos.length, 0)
}

function byDateThenCreated(left: Photo, right: Photo) {
  return (left.sortIndex ?? Number.MAX_SAFE_INTEGER) - (right.sortIndex ?? Number.MAX_SAFE_INTEGER)
    || String(left.date || "").localeCompare(String(right.date || ""))
    || left.id.localeCompare(right.id)
}

function formatMonthDay(date?: string) {
  const [, , month, day] = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/) || []
  return month && day ? `${Number(month)}月${Number(day)}日` : ""
}

function arrangeForColumns(photos: Photo[], cols: number) {
  const columns: { height: number; photos: ArrangedPhoto[] }[] = Array.from({ length: cols }, () => ({
    height: 0,
    photos: [],
  }))

  photos.forEach((photo, index) => {
    const width = photo.width || 4
    const height = photo.height || 3
    const estimatedHeight = 400 * (height / width)
    let shortestColumn = 0

    for (let column = 1; column < columns.length; column += 1) {
      if (columns[column].height < columns[shortestColumn].height) {
        shortestColumn = column
      }
    }

    columns[shortestColumn].photos.push({ ...photo, originalIndex: index })
    columns[shortestColumn].height += estimatedHeight + 8
  })

  return columns.map((column) => column.photos)
}

function getPhotoColumnCount() {
  if (window.innerWidth <= 560) {
    return 1
  }

  if (window.innerWidth <= 860) {
    return 2
  }

  return 3
}

function getPhotoImagePath(photo?: Photo | null) {
  return photo?.objectKey || photo?.url || ""
}

function getBackgroundImagePath(image?: BackgroundImage) {
  return image?.objectKey || image?.url || ""
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null)
  const libraryRef = useRef<HTMLElement>(null)
  const backgroundSignatureRef = useRef("")
  const backgroundFadeTimerRef = useRef<number | null>(null)
  const [years, setYears] = useState<YearGroup[]>(fallbackYears)
  const [backgroundConfig, setBackgroundConfig] = useState<BackgroundConfig>({
    intervalMinutes: 3,
    currentIndex: 0,
    maskOpacity: 1,
    images: [],
  })
  const [backgroundsLoaded, setBackgroundsLoaded] = useState(false)
  const [backgroundLayers, setBackgroundLayers] = useState<BackgroundLayer[]>([])
  const [backgroundIndex, setBackgroundIndex] = useState(0)
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null)
  const [arrangedPhotoColumns, setArrangedPhotoColumns] = useState<ArrangedPhoto[][]>([])
  const [menuAnchors, setMenuAnchors] = useState({
    centerX: "50%",
    topY: "9%",
    bottomY: "82.5%",
  })

  const fetchJson = useCallback(async <T,>(apiPath: string, staticPath: string): Promise<T> => {
    const apiResponse = await fetch(`${API_BASE}${apiPath}`)
    if (apiResponse.ok && apiResponse.headers.get("content-type")?.includes("application/json")) {
      return apiResponse.json()
    }

    const staticResponse = await fetch(staticPath)
    if (!staticResponse.ok) {
      throw new Error(`Unable to load ${staticPath}`)
    }
    return staticResponse.json()
  }, [])

  const loadLibrary = useCallback(() => {
    fetchJson<{ years: YearGroup[] }>("/api/library", "/data/library.json")
      .then((library: { years: YearGroup[] }) => {
        if (Array.isArray(library.years) && library.years.length > 0) {
          setYears(library.years)
        }
      })
      .catch(() => setYears(fallbackYears))
  }, [fetchJson])

  const loadBackgrounds = useCallback(() => {
    fetchJson<BackgroundConfig>("/api/backgrounds", "/data/backgrounds.json")
      .then((config: BackgroundConfig) => {
        const images = Array.isArray(config.images) ? config.images : []
        const intervalMinutes = [3, 5, 10].includes(Number(config.intervalMinutes))
          ? config.intervalMinutes
          : 3
        const currentIndex = images.length
          ? Math.max(0, Math.min(Number(config.currentIndex) || 0, images.length - 1))
          : 0
        const maskOpacity = Number.isFinite(Number(config.maskOpacity))
          ? Math.max(0, Math.min(Number(config.maskOpacity), 1))
          : 1
        const nextConfig = { intervalMinutes, currentIndex, maskOpacity, images } as BackgroundConfig
        const signature = `${images.map((image) => image.id).join("|")}:${intervalMinutes}:${currentIndex}:${maskOpacity}`

        setBackgroundConfig(nextConfig)
        if (backgroundSignatureRef.current !== signature) {
          backgroundSignatureRef.current = signature
          setBackgroundIndex(currentIndex)
        }
      })
      .catch(() => {
        setBackgroundConfig({ intervalMinutes: 3, currentIndex: 0, maskOpacity: 1, images: [] })
        setBackgroundIndex(0)
      })
      .finally(() => setBackgroundsLoaded(true))
  }, [fetchJson])

  const switchToNextBackground = useCallback(() => {
    if (backgroundConfig.images.length <= 1) {
      return
    }

    fetch(`${API_BASE}/api/backgrounds/next`, { method: "POST" })
      .then((response) => response.json())
      .then((config: BackgroundConfig) => {
        if (!Array.isArray(config.images) || config.images.length === 0) {
          return
        }
        setBackgroundConfig(config)
        setBackgroundIndex(Math.max(0, Math.min(Number(config.currentIndex) || 0, config.images.length - 1)))
      })
      .catch(() => {
        setBackgroundIndex((index) => (index + 1) % backgroundConfig.images.length)
      })
  }, [backgroundConfig.images.length])

  useEffect(() => {
    loadLibrary()
    const timer = window.setInterval(loadLibrary, 2500)
    return () => window.clearInterval(timer)
  }, [loadLibrary])

  useEffect(() => {
    loadBackgrounds()
    const timer = window.setInterval(loadBackgrounds, 2500)
    return () => window.clearInterval(timer)
  }, [loadBackgrounds])

  useEffect(() => {
    const count = backgroundConfig.images.length
    if (count === 0) {
      setBackgroundIndex(0)
      return
    }

    setBackgroundIndex((index) => Math.min(index, count - 1))
  }, [backgroundConfig.images.length])

  useEffect(() => {
    const count = backgroundConfig.images.length
    if (count <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      setBackgroundIndex((index) => (index + 1) % count)
    }, backgroundConfig.intervalMinutes * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [backgroundConfig.images.length, backgroundConfig.intervalMinutes])

  const visibleYears = useMemo(
    () => years.filter((year) => getPhotoCount(year) > 0).sort((a, b) => a.year.localeCompare(b.year)),
    [years],
  )
  const activeYear = useMemo(() => years.find((item) => item.year === selectedYear) || null, [selectedYear, years])
  const activeLocations = useMemo(() => {
    return (activeYear?.locations || [])
      .filter((location) => location.photos.length > 0)
      .sort((a, b) => {
        const leftDate = [...a.photos].sort(byDateThenCreated)[0]?.date || ""
        const rightDate = [...b.photos].sort(byDateThenCreated)[0]?.date || ""
        return leftDate.localeCompare(rightDate)
      })
  }, [activeYear])
  const activeLocation = useMemo(() => activeYear?.locations.find((item) => item.id === selectedLocation) || null, [activeYear, selectedLocation])
  const activePhotos = useMemo(() => [...(activeLocation?.photos || [])].sort(byDateThenCreated), [activeLocation])
  const currentFullscreenIndex = fullscreenIndex ?? 0
  const fullscreenPhoto = fullscreenIndex === null ? null : activePhotos[fullscreenIndex]

  useEffect(() => {
    const updateArrangement = () => {
      setArrangedPhotoColumns(arrangeForColumns(activePhotos, getPhotoColumnCount()))
    }

    updateArrangement()
    window.addEventListener("resize", updateArrangement)
    return () => window.removeEventListener("resize", updateArrangement)
  }, [activePhotos])

  const updateMenuAnchors = useCallback(() => {
    if (!libraryRef.current) {
      return
    }

    const rect = libraryRef.current.getBoundingClientRect()
    const nextAnchors = {
      centerX: `${rect.left + rect.width / 2}px`,
      topY: `${rect.top}px`,
      bottomY: `${rect.bottom}px`,
    }

    setMenuAnchors((current) => (
      current.centerX === nextAnchors.centerX
        && current.topY === nextAnchors.topY
        && current.bottomY === nextAnchors.bottomY
        ? current
        : nextAnchors
    ))
  }, [])

  useLayoutEffect(() => {
    let frame = 0

    const scheduleMenuAnchorUpdate = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateMenuAnchors)
    }

    scheduleMenuAnchorUpdate()
    const libraryElement = libraryRef.current
    if (libraryElement) {
      libraryElement.addEventListener("transitionend", scheduleMenuAnchorUpdate)
    }
    window.addEventListener("resize", scheduleMenuAnchorUpdate)
    return () => {
      window.cancelAnimationFrame(frame)
      libraryElement?.removeEventListener("transitionend", scheduleMenuAnchorUpdate)
      window.removeEventListener("resize", scheduleMenuAnchorUpdate)
    }
  }, [updateMenuAnchors])

  useLayoutEffect(() => {
    updateMenuAnchors()
  }, [selectedYear, selectedLocation, updateMenuAnchors])

  const photoDate = formatMonthDay(activePhotos[0]?.date)
  const viewTitle = selectedLocation ? activeLocation?.name || "Location" : selectedYear ? `${selectedYear}` : "Photo Library"
  const viewSubtitle = selectedLocation ? photoDate || selectedYear || "" : selectedYear ? "按地点排列" : ""
  const dockTopY = selectedLocation ? `calc(${menuAnchors.bottomY} - 48px)` : menuAnchors.bottomY
  const activeBackground = backgroundConfig.images[backgroundIndex]
  const backgroundSrc = getBackgroundImagePath(activeBackground) ? getLargeUrl(getBackgroundImagePath(activeBackground)) : ""

  useEffect(() => {
    if (backgroundFadeTimerRef.current) {
      window.clearTimeout(backgroundFadeTimerRef.current)
      backgroundFadeTimerRef.current = null
    }

    setBackgroundLayers((layers) => {
      const current = [...layers].reverse().find((layer) => layer.phase !== "exit")?.src || ""
      if (!backgroundSrc) {
        return []
      }
      if (current === backgroundSrc) {
        return layers
      }

      const stamp = Date.now()
      const nextLayer: BackgroundLayer = {
        key: `${backgroundSrc}-${stamp}-enter`,
        src: backgroundSrc,
        phase: "enter",
      }
      return current
        ? [
          { key: `${current}-${stamp}-exit`, src: current, phase: "exit" },
          nextLayer,
        ]
        : [{ ...nextLayer, phase: "active" }]
    })

    if (!backgroundSrc) {
      return
    }

    backgroundFadeTimerRef.current = window.setTimeout(() => {
      setBackgroundLayers((layers) => (
        layers
          .filter((layer) => layer.phase !== "exit")
          .map((layer) => (layer.phase === "enter" ? { ...layer, phase: "active" } : layer))
      ))
      backgroundFadeTimerRef.current = null
    }, 900)
  }, [backgroundSrc])

  useEffect(() => {
    return () => {
      if (backgroundFadeTimerRef.current) {
        window.clearTimeout(backgroundFadeTimerRef.current)
      }
    }
  }, [])

  return (
    <main ref={stageRef} className="vision-stage">
      {backgroundsLoaded && backgroundLayers.map((layer) => (
        <img
          className={`room-backdrop${layer.phase === "active" ? "" : ` room-backdrop-${layer.phase}`}`}
          key={layer.key}
          src={layer.src}
          alt=""
        />
      ))}
      <div className="ambient-shadow" style={{ opacity: backgroundConfig.maskOpacity }} />

      <LiquidGlass
        mouseContainer={stageRef}
        {...liquidGlassChrome}
        padding="18px 22px"
        style={{ position: "fixed", top: menuAnchors.topY, left: menuAnchors.centerX, zIndex: 8 }}
      >
        <div className={`title-glass${viewSubtitle ? "" : " title-glass-single"}`}>
          <Sparkles size={21} />
          <div>
            <span>{viewTitle}</span>
            {viewSubtitle && <small>{viewSubtitle}</small>}
          </div>
        </div>
      </LiquidGlass>

      {selectedYear && (
        <>
          <button
            className="back-button"
            onClick={() => {
              if (selectedLocation) {
                setSelectedLocation(null)
                return
              }
              setSelectedYear(null)
            }}
          >
            <ArrowLeft size={18} />
          </button>
        </>
      )}
      {backgroundConfig.images.length > 1 && (
        <button className="background-switch-button" onClick={switchToNextBackground}>
          切换背景
        </button>
      )}

      <section ref={libraryRef} className="library-shell" data-view={selectedLocation ? "photos" : selectedYear ? "places" : "years"} aria-label="Photo library">
        {!selectedYear && (
          <div className="folder-grid view-panel">
            {visibleYears.map((year) => {
              const cover = getYearCover(year)
              const count = getPhotoCount(year)
              return (
                <button className="folder-card" key={year.year} onClick={() => setSelectedYear(year.year)}>
                  {cover ? <img src={getThumbUrl(cover)} alt="" /> : <span className="folder-empty"><CalendarDays size={34} /></span>}
                  <strong>{year.year}</strong>
                  <small>{count ? `${count} photos` : "Empty folder"}</small>
                </button>
              )
            })}
          </div>
        )}

        {selectedYear && !selectedLocation && (
          <div className="folder-grid location-grid view-panel">
            {activeLocations.length > 0 ? (
              activeLocations.map((location) => {
                const sortedPhotos = [...location.photos].sort(byDateThenCreated)
                const cover = getPhotoImagePath(sortedPhotos[0])
                const dateLabel = formatMonthDay(sortedPhotos[0]?.date)
                return (
                  <button className="folder-card" key={location.id} onClick={() => setSelectedLocation(location.id)}>
                    {cover ? <img src={getThumbUrl(cover)} alt="" /> : <span className="folder-empty"><MapPin size={34} /></span>}
                    <strong>{location.name}</strong>
                    <small>{dateLabel ? `${dateLabel} · ` : ""}{location.photos.length} photos</small>
                  </button>
                )
              })
            ) : (
              <div className="empty-state">
                <Folder size={34} />
                <span>后台添加地点后，这里会显示 {selectedYear} 年的地点文件夹。</span>
              </div>
            )}
          </div>
        )}

        {selectedYear && selectedLocation && (
          <div className="photo-grid view-panel">
            {activePhotos.length > 0 ? (
              arrangedPhotoColumns.map((column, columnIndex) => (
                <div className="photo-column" key={`column-${columnIndex}`}>
                  {column.map((photo) => (
                    <figure
                      className="photo-card"
                      key={photo.id}
                      style={{ aspectRatio: `${photo.width || 4} / ${photo.height || 3}` }}
                      onClick={() => setFullscreenIndex(photo.originalIndex)}
                    >
                      <img src={getThumbUrl(getPhotoImagePath(photo))} alt="" loading="lazy" />
                    </figure>
                  ))}
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Image size={34} />
                <span>这个地点还没有照片。请在后台端口上传。</span>
              </div>
            )}
          </div>
        )}
      </section>

      <LiquidGlass
        mouseContainer={stageRef}
        {...liquidGlassChrome}
        padding="18px 22px"
        className="dock-glass"
        style={{ position: "fixed", top: dockTopY, left: menuAnchors.centerX, zIndex: 9 }}
      >
        <nav className="segmented-dock" aria-label="Library views">
          <button className={!selectedYear ? "active" : ""} onClick={() => { setSelectedYear(null); setSelectedLocation(null) }}>Years</button>
          <button className={selectedYear && !selectedLocation ? "active" : ""} disabled={!selectedYear} onClick={() => setSelectedLocation(null)}>Places</button>
          <button className={selectedLocation ? "active" : ""} disabled={!selectedYear}>Photos</button>
        </nav>
      </LiquidGlass>
      {fullscreenPhoto && (
        <div className="fullscreen-viewer" onClick={() => setFullscreenIndex(null)}>
          <button className="viewer-close" aria-label="关闭">
            <X size={22} />
          </button>
          <button
            className="viewer-nav viewer-prev"
            disabled={fullscreenIndex === 0}
            onClick={(event) => {
              event.stopPropagation()
              setFullscreenIndex((index) => Math.max(0, (index || 0) - 1))
            }}
          >
            <ArrowLeft size={24} />
          </button>
          <img
            src={getLargeUrl(getPhotoImagePath(fullscreenPhoto))}
            alt=""
            onClick={(event) => {
              event.stopPropagation()
              setFullscreenIndex(null)
            }}
          />
          <button
            className="viewer-nav viewer-next"
            disabled={fullscreenIndex === activePhotos.length - 1}
            onClick={(event) => {
              event.stopPropagation()
              setFullscreenIndex((index) => Math.min(activePhotos.length - 1, (index || 0) + 1))
            }}
          >
            <ArrowLeft size={24} />
          </button>
          <span className="viewer-count">{currentFullscreenIndex + 1} / {activePhotos.length}</span>
        </div>
      )}
    </main>
  )
}
