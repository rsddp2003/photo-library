import { createServer } from "node:http"
import { execFile, execFileSync } from "node:child_process"
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const distRoot = join(root, "dist")
const dataDir = join(root, "data")
const uploadDir = join(dataDir, "uploads")
const backgroundDir = join(dataDir, "backgrounds")
const dataFile = join(dataDir, "library.json")
const backgroundFile = join(dataDir, "backgrounds.json")
const env = typeof process === "undefined" ? {} : process.env
const sitePort = Number(globalThis.SITE_PORT || env.SITE_PORT || 4173)
const adminPort = Number(globalThis.ADMIN_PORT || env.ADMIN_PORT || 4174)
const host = globalThis.HOST || env.HOST || "127.0.0.1"
const adminUser = env.ADMIN_USER || "admin"
const adminPassword = env.ADMIN_PASSWORD || "admin123"
const sessionCookie = "photo_admin=1"
const localClipPython = join(root, ".venv-clip", "bin", "python")
const pythonBin = env.PYTHON_BIN || (existsSync(localClipPython) ? localClipPython : "python3")
const clipSortScript = join(root, "scripts", "clip_sort_library.py")
const ossBaseUrl = "https://photo-library-rsddp.oss-cn-guangzhou.aliyuncs.com"
const ossReferer = "https://rsddp.top/"
const ossImageProcessLimitBytes = 20 * 1024 * 1024

mkdirSync(uploadDir, { recursive: true })
mkdirSync(backgroundDir, { recursive: true })

const defaultLibrary = {
  years: ["2015", "2017", "2018", "2019", "2020", "2021", "2022", "2023"].map((year) => ({ year, locations: [] })),
}

if (!existsSync(dataFile)) {
  writeFileSync(dataFile, JSON.stringify(defaultLibrary, null, 2))
}

const defaultBackgrounds = {
  intervalMinutes: 3,
  currentIndex: 0,
  maskOpacity: 1,
  images: [],
}

if (!existsSync(backgroundFile)) {
  writeFileSync(backgroundFile, JSON.stringify(defaultBackgrounds, null, 2))
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

const imageTypes = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
}

const imageProcesses = {
  thumb: "image/resize,w_640/quality,q_82",
  large: "image/resize,w_1800/quality,q_88",
}

function readLibrary() {
  const library = JSON.parse(readFileSync(dataFile, "utf-8"))
  return normalizeLibrary(library)
}

function writeLibrary(library) {
  normalizeLibrary(library)
  library.years.sort((a, b) => b.year.localeCompare(a.year))
  writeFileSync(dataFile, JSON.stringify(library, null, 2))
}

function readBackgrounds() {
  const backgrounds = JSON.parse(readFileSync(backgroundFile, "utf-8"))
  return normalizeBackgrounds(backgrounds)
}

function writeBackgrounds(backgrounds) {
  normalizeBackgrounds(backgrounds)
  writeFileSync(backgroundFile, JSON.stringify(backgrounds, null, 2))
}

function normalizeBackgrounds(backgrounds) {
  backgrounds.intervalMinutes = [3, 5, 10].includes(Number(backgrounds.intervalMinutes))
    ? Number(backgrounds.intervalMinutes)
    : 3
  backgrounds.maskOpacity = Number.isFinite(Number(backgrounds.maskOpacity))
    ? Math.max(0, Math.min(Number(backgrounds.maskOpacity), 1))
    : 1
  backgrounds.images = Array.isArray(backgrounds.images) ? backgrounds.images : []
  for (const image of backgrounds.images) {
    image.objectKey ||= localImageUrlToObjectKey(image.url, "backgrounds")
  }
  backgrounds.currentIndex = backgrounds.images.length
    ? Math.max(0, Math.min(Number(backgrounds.currentIndex) || 0, backgrounds.images.length - 1))
    : 0
  return backgrounds
}

function saveDataImage(dataUrl, mime, prefix, directory) {
  const match = String(dataUrl || "").match(/^data:(.+);base64,(.+)$/)
  if (!match) throw new Error("Invalid image payload")
  const imageMime = mime || match[1]
  const extension = imageMime.includes("png") ? ".png" : imageMime.includes("webp") ? ".webp" : ".jpg"
  const id = safeId(prefix)
  const filename = `${id}${extension}`
  const filePath = join(directory, filename)
  writeFileSync(filePath, Buffer.from(match[2], "base64"))
  compressLargeJpegForOss(filePath)
  return { id, filename }
}

function compressLargeJpegForOss(filePath) {
  if (!/\.jpe?g$/i.test(filePath) || !existsSync(filePath) || statSync(filePath).size <= ossImageProcessLimitBytes) {
    return
  }

  if (!existsSync("/usr/bin/sips")) {
    return
  }

  const tempPath = `${filePath}.oss-tmp.jpg`
  try {
    execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "60", filePath, "--out", tempPath], {
      stdio: "ignore",
    })
    if (existsSync(tempPath) && statSync(tempPath).size < statSync(filePath).size) {
      writeFileSync(filePath, readFileSync(tempPath))
    }
  } finally {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath)
    }
  }
}

function normalizeLibrary(library) {
  library.years ||= []
  for (const year of library.years) {
    year.locations ||= []
    for (const location of year.locations) {
      location.photos ||= []
      for (const photo of location.photos) {
        photo.date ||= `${year.year}-01-01`
        photo.width ||= 4
        photo.height ||= 3
        photo.objectKey ||= localImageUrlToObjectKey(photo.url, "photos/original")
      }
      location.photos.sort(comparePhotos)
    }
  }
  return library
}

function localImageUrlToObjectKey(url, prefix) {
  const cleanUrl = String(url || "").replace(/^\/+/, "")
  if (!cleanUrl) return ""
  if (cleanUrl.startsWith("uploads/")) return cleanUrl.replace(/^uploads\//, `${prefix}/`)
  if (cleanUrl.startsWith("backgrounds/")) return cleanUrl
  if (cleanUrl.startsWith("photos/")) return cleanUrl
  return cleanUrl.includes("://") ? "" : cleanUrl
}

function comparePhotos(left, right) {
  return (left.sortIndex ?? Number.MAX_SAFE_INTEGER) - (right.sortIndex ?? Number.MAX_SAFE_INTEGER)
    || String(left.date || "").localeCompare(String(right.date || ""))
    || String(left.id || "").localeCompare(String(right.id || ""))
}

function comparePhotoTime(left, right) {
  return String(left.date || "").localeCompare(String(right.date || ""))
    || String(left.id || "").localeCompare(String(right.id || ""))
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  })
  response.end(JSON.stringify(body))
}

function isAuthed(request) {
  return String(request.headers.cookie || "").includes(sessionCookie)
}

function requireAdmin(request) {
  if (!isAuthed(request)) {
    const error = new Error("Unauthorized")
    error.status = 401
    throw error
  }
}

async function readBody(request) {
  let body = ""
  for await (const chunk of request) {
    body += chunk
  }
  return body ? JSON.parse(body) : {}
}

function safeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function findYear(library, year) {
  return library.years.find((item) => item.year === String(year))
}

function findPhoto(library, photoId) {
  for (const year of library.years) {
    for (const location of year.locations) {
      const photoIndex = location.photos.findIndex((photo) => photo.id === photoId)
      if (photoIndex >= 0) return { year, location, photo: location.photos[photoIndex], photoIndex }
    }
  }
  return null
}

function removeEmptyGroups(library) {
  for (const year of library.years) {
    year.locations = year.locations.filter((location) => location.photos.length > 0)
  }
  library.years = library.years.filter((year) => year.locations.length > 0)
}

function getOrCreateLocation(library, date, locationName) {
  const yearValue = String(date).slice(0, 4)
  let year = findYear(library, yearValue)
  if (!year) {
    year = { year: yearValue, locations: [] }
    library.years.push(year)
  }
  let location = year.locations.find((item) => item.name === locationName)
  if (!location) {
    location = { id: safeId("loc"), name: locationName, photos: [] }
    year.locations.push(location)
  }
  return location
}

function markNeedsSort(location) {
  location.sortStatus = location.photos.length > 1 ? "needs_sort" : "sorted"
  delete location.sortError
  for (const photo of location.photos) {
    delete photo.sortIndex
  }
}

function runClipSort(yearValue, locationId, onComplete = () => {}) {
  execFile(pythonBin, [clipSortScript, "--year", String(yearValue), "--location-id", String(locationId)], { cwd: root }, (error, stdout, stderr) => {
    const nextLibrary = readLibrary()
    const nextYear = findYear(nextLibrary, yearValue)
    const nextLocation = nextYear?.locations.find((item) => item.id === locationId)
    if (!nextLocation) {
      onComplete(error || new Error("Location not found"))
      return
    }

    nextLocation.sortStatus = error ? "failed" : "sorted"
    if (error) {
      nextLocation.sortError = String(stderr || stdout || error.message).trim()
    } else {
      delete nextLocation.sortError
    }
    writeLibrary(nextLibrary)
    onComplete(error)
  })
}

function runClipSortQueue(targets) {
  const [target, ...rest] = targets
  if (!target) return

  runClipSort(target.year, target.locationId, () => {
    runClipSortQueue(rest)
  })
}

function serveFile(response, baseDir, pathname) {
  const cleanPath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "")
  let filePath = join(baseDir, cleanPath === "/" ? "index.html" : cleanPath)

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(baseDir, "index.html")
  }

  response.setHeader("Content-Type", types[extname(filePath)] || "application/octet-stream")
  createReadStream(filePath).pipe(response)
}

function normalizeImageKey(value) {
  const rawValue = String(value || "").trim()
  if (!rawValue) return ""

  let key = rawValue
  if (/^https?:\/\//i.test(key)) {
    try {
      key = new URL(key).pathname
    } catch {
      return ""
    }
  }

  key = decodeURIComponent(key).replace(/^\/+/, "").replace(/^uploads\//, "photos/original/")
  if (key.includes("..") || key.startsWith("api/")) return ""
  return key
}

function imageContentType(key, upstreamType) {
  if (upstreamType && !upstreamType.includes("application/octet-stream")) {
    return upstreamType
  }

  const extension = key.split(".").pop()?.toLowerCase() || ""
  return imageTypes[extension] || "application/octet-stream"
}

function localImagePathFromKey(key) {
  if (key.startsWith("photos/original/")) {
    const filename = key.replace(/^photos\/original\//, "")
    if (!filename.includes("/") && !filename.includes("\\")) {
      return join(uploadDir, filename)
    }
  }

  if (key.startsWith("backgrounds/")) {
    const filename = key.replace(/^backgrounds\//, "")
    if (!filename.includes("/") && !filename.includes("\\")) {
      return join(backgroundDir, filename)
    }
  }

  return ""
}

function serveLocalImageFallback(key, response) {
  const filePath = localImagePathFromKey(key)
  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    return false
  }

  response.writeHead(200, {
    "Content-Type": imageContentType(key, ""),
    "Content-Disposition": "inline",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  createReadStream(filePath).pipe(response)
  return true
}

async function serveOssImage(requestUrl, response) {
  const key = normalizeImageKey(requestUrl.searchParams.get("key") || requestUrl.searchParams.get("path"))

  if (!key) {
    sendJson(response, { error: "Missing image key" }, 400)
    return
  }

  if (serveLocalImageFallback(key, response)) {
    return
  }

  sendJson(response, { error: "Local image not found" }, 404)
}

function adminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Photo Admin</title>
    <style>
      :root { color: #fff; background: #171411; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; padding: 32px; background: radial-gradient(circle at 30% 10%, #584a39, transparent 32%), #171411; }
      main { width: min(980px, 100%); margin: 0 auto; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { margin: 0 0 18px; color: rgba(255,255,255,.7); }
      section { margin: 18px 0; padding: 20px; border: 1px solid rgba(255,255,255,.18); border-radius: 18px; background: rgba(255,255,255,.08); backdrop-filter: blur(18px); }
      label { display: block; margin: 12px 0 6px; color: rgba(255,255,255,.76); font-size: 13px; }
      input, select, button { height: 40px; border: 0; border-radius: 12px; font: inherit; }
      input, select { width: 100%; padding: 0 12px; background: rgba(255,255,255,.92); color: #181511; }
      input[type="range"] { padding: 0; accent-color: #f0f0f0; background: transparent; }
      button { padding: 0 16px; color: #fff; background: rgba(255,255,255,.18); cursor: pointer; }
      button.primary { background: #f0f0f0; color: #151515; font-weight: 700; }
      button.danger { background: #8f2f2f; }
      .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
      .entry-actions button { transition: transform .12s ease, background .12s ease, box-shadow .12s ease; }
      .entry-actions button:active { transform: translateY(1px) scale(.97); background: rgba(255,255,255,.26); box-shadow: inset 0 1px 6px rgba(0,0,0,.22); }
      .entry-actions button.primary:active { background: rgba(255,255,255,.78); }
      .entry-actions select { width: min(240px, 100%); }
      .sort-control { display: inline-flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .background-list { display: grid; gap: 10px; margin-top: 14px; }
      .background-item { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px; border-radius: 14px; background: rgba(0,0,0,.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
      .background-item img { display: block; width: 92px; height: 58px; object-fit: cover; border-radius: 10px; background: rgba(0,0,0,.3); }
      .background-item strong, .background-item span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .background-item span { margin-top: 4px; color: rgba(255,255,255,.62); font-size: 12px; }
      .background-controls { display: flex; gap: 8px; }
      .background-controls button { display: grid; width: 40px; padding: 0; place-items: center; transition: transform .12s ease, background .12s ease, box-shadow .12s ease; }
      .background-controls button:active { transform: translateY(1px) scale(.96); }
      .background-delete { background: #8f2f2f; box-shadow: inset 0 0 0 1px rgba(255,190,190,.16), 0 8px 18px rgba(60,0,0,.18); }
      .background-delete:hover { background: #a13838; }
      .trash-icon { display: block; width: 21px; height: 21px; color: #f0a3a3; }
      .panel { display: none; }
      .panel.active { display: block; }
      .file-summary { display: none; margin-top: 12px; padding: 12px; border-radius: 12px; background: rgba(0,0,0,.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); cursor: pointer; }
      .file-summary.active { display: block; }
      .file-summary strong, .file-summary span { display: block; }
      .file-summary span { margin-top: 4px; color: rgba(255,255,255,.62); font-size: 12px; }
      .file-list { display: none; margin: 10px 0 0; padding-left: 18px; color: rgba(255,255,255,.72); font-size: 12px; line-height: 1.8; }
      .file-summary.open .file-list { display: block; }
      .library { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .card { padding: 12px; min-height: 96px; border-radius: 14px; background: rgba(0,0,0,.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
      .card strong, .card span { display: block; }
      .card span { margin-top: 5px; color: rgba(255,255,255,.62); font-size: 12px; }
      .photo-preview { align-self: end; min-height: 180px; }
      .photo-preview img { display: block; width: 100%; height: 180px; object-fit: contain; border-radius: 14px; background: rgba(0,0,0,.32); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14), 0 12px 28px rgba(0,0,0,.24); }
      .photo-preview span { display: grid; width: 100%; height: 180px; place-items: center; border-radius: 14px; color: rgba(255,255,255,.52); background: rgba(0,0,0,.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
      .batch-location-panel { margin-top: 14px; padding: 14px; border-radius: 14px; background: rgba(0,0,0,.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
      .batch-location-panel[hidden] { display: none; }
      #message { min-height: 20px; color: #f3d7a5; }
      @media (max-width: 720px) { body { padding: 18px; } .row, .library { grid-template-columns: 1fr; } .background-item { grid-template-columns: 80px minmax(0, 1fr); } .background-controls { grid-column: 1 / -1; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Photo Admin</h1>
      <p>添加、修改、删除照片后，前台会自动按年份和地点更新。</p>
      <p id="message"></p>

      <section>
        <h2>管理入口</h2>
        <div class="actions entry-actions">
          <button data-panel="uploadPanel" class="primary">添加照片</button>
          <button data-panel="editPanel">修改照片信息</button>
          <button data-panel="libraryPanel">当前图库</button>
          <button data-panel="backgroundPanel">修改背景</button>
          <span class="sort-control">
            <button id="sortAlbum">重新排列相册</button>
            <select id="albumSelect" aria-label="选择要重新排列的相册"></select>
          </span>
          <button id="sortAllAlbums">重新排列全部相册</button>
        </div>
      </section>

      <section id="uploadPanel" class="panel">
        <h2>添加照片</h2>
        <div class="row">
          <div>
            <label for="photoFile">照片文件</label>
            <input id="photoFile" type="file" accept="image/*" multiple />
            <div id="fileSummary" class="file-summary" title="点击查看所有文件"></div>
          </div>
          <div>
            <label for="uploadDate">拍摄日期</label>
            <input id="uploadDate" type="date" />
          </div>
          <div>
            <label for="uploadLocation">地点</label>
            <input id="uploadLocation" placeholder="例如 山东 / 香港 / 京都" />
          </div>
        </div>
        <div class="actions">
          <button class="primary" id="uploadButton">上传照片</button>
          <button id="parsePhotoInfo">解析日期地点</button>
        </div>
      </section>

      <section id="editPanel" class="panel">
        <h2>修改照片信息</h2>
        <div class="row">
          <div>
            <label for="editYearSelect">年份</label>
            <select id="editYearSelect"></select>
          </div>
          <div>
            <label for="editLocationSelect">地点</label>
            <select id="editLocationSelect"></select>
          </div>
          <div>
            <label for="photoSelect">照片</label>
            <select id="photoSelect"></select>
          </div>
          <div>
            <label for="editDate">拍摄日期</label>
            <input id="editDate" type="date" />
          </div>
          <div class="photo-preview">
            <label>缩略图</label>
            <img id="editPreview" alt="当前选中照片缩略图" />
            <span id="editPreviewEmpty">未选择照片</span>
          </div>
        </div>
        <div class="actions">
          <button class="primary" id="savePhoto">保存修改</button>
          <button class="danger" id="deletePhoto">删除照片</button>
          <button id="showBatchLocation">批量修改地点</button>
        </div>
        <div id="batchLocationPanel" class="batch-location-panel" hidden>
          <div class="row">
            <div>
              <label for="batchYearSelect">年份</label>
              <select id="batchYearSelect"></select>
            </div>
            <div>
              <label for="batchLocationSelect">原地点</label>
              <select id="batchLocationSelect"></select>
            </div>
            <div>
              <label for="batchLocationName">新地点名称</label>
              <input id="batchLocationName" placeholder="输入新的地点名称" />
            </div>
          </div>
          <div class="actions">
            <button class="primary" id="saveBatchLocation">确定修改</button>
            <button id="cancelBatchLocation">取消</button>
          </div>
        </div>
      </section>

      <section id="libraryPanel" class="panel">
        <h2>当前图库</h2>
        <div id="library" class="library"></div>
      </section>

      <section id="backgroundPanel" class="panel">
        <h2>修改背景</h2>
        <div class="row">
          <div>
            <label for="backgroundFile">背景图片</label>
            <input id="backgroundFile" type="file" accept="image/*" multiple />
            <div id="backgroundFileSummary" class="file-summary" title="点击查看所有文件"></div>
          </div>
          <div>
            <label for="backgroundInterval">播放间隔</label>
            <select id="backgroundInterval">
              <option value="3">3分钟</option>
              <option value="5">5分钟</option>
              <option value="10">10分钟</option>
            </select>
          </div>
          <div>
            <label for="backgroundMaskOpacity">遮罩透明度：<span id="backgroundMaskOpacityValue">100%</span></label>
            <input id="backgroundMaskOpacity" type="range" min="0" max="100" step="5" />
          </div>
        </div>
        <div class="actions">
          <button class="primary" id="uploadBackgrounds">上传背景图片</button>
          <button id="saveBackgrounds">保存顺序和间隔</button>
          <button id="saveMaskOpacity">保存遮罩透明度</button>
          <button id="nextBackground">下一张背景</button>
        </div>
        <div id="backgroundList" class="background-list"></div>
      </section>
    </main>

    <script>
      const api = "";
      let library = { years: [] };
      let backgroundConfig = { intervalMinutes: 3, currentIndex: 0, images: [] };
      let photos = [];
      let albums = [];
      let selectedEditPhotoId = "";
      let selectedFiles = [];
      let selectedBackgroundFiles = [];

      async function request(path, options = {}) {
        const response = await fetch(api + path, {
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          ...options,
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      }

      function setMessage(text) {
        document.getElementById("message").textContent = text || "";
      }

      function parsePhotoName(filename) {
        const normalized = filename.split("＿").join("_").trim();
        const dotIndex = normalized.lastIndexOf(".");
        const base = dotIndex > 0 ? normalized.slice(0, dotIndex) : normalized;
        const firstUnderscore = base.indexOf("_");
        const lastUnderscore = base.lastIndexOf("_");
        if (firstUnderscore < 0 || lastUnderscore <= firstUnderscore) return null;

        const location = base.slice(firstUnderscore + 1, lastUnderscore).trim();
        const rawDate = base.slice(lastUnderscore + 1).trim();
        const digits = rawDate.split("").filter(char => char >= "0" && char <= "9").join("");
        if (!location || digits.length !== 8) return null;

        return {
          location,
          date: digits.slice(0, 4) + "-" + digits.slice(4, 6) + "-" + digits.slice(6, 8),
        };
      }

      function renderFileSummary() {
        const box = document.getElementById("fileSummary");
        if (!selectedFiles.length) {
          box.className = "file-summary";
          box.innerHTML = "";
          return;
        }

        const names = selectedFiles.map(file => file.name);
        box.className = "file-summary active";
        box.innerHTML = '<strong>' + names[0] + ' 等 ' + names.length + ' 张照片</strong><span>点击查看全部文件</span><ul class="file-list">' + names.map(name => '<li>' + name + '</li>').join("") + '</ul>';
      }

      function renderBackgroundFileSummary() {
        const box = document.getElementById("backgroundFileSummary");
        if (!selectedBackgroundFiles.length) {
          box.className = "file-summary";
          box.innerHTML = "";
          return;
        }

        const names = selectedBackgroundFiles.map(file => file.name);
        box.className = "file-summary active";
        box.innerHTML = '<strong>' + names[0] + ' 等 ' + names.length + ' 张背景</strong><span>点击查看全部文件</span><ul class="file-list">' + names.map(name => '<li>' + name + '</li>').join("") + '</ul>';
      }

      function readFileAsDataUrl(file) {
        return new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      }

      function readImageDimensions(dataUrl) {
        return new Promise(resolve => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve({ width: 4, height: 3 });
          img.src = dataUrl;
        });
      }

      function flattenPhotos() {
        return library.years.flatMap(year => year.locations.flatMap(location => location.photos.map(photo => ({
            ...photo,
            year: year.year,
          locationId: location.id,
          locationName: location.name,
        }))));
      }

      function comparePhotoTime(left, right) {
        return String(left.date || "").localeCompare(String(right.date || ""))
          || String(left.id || "").localeCompare(String(right.id || ""));
      }

      function flattenAlbums() {
        return library.years.flatMap(year => year.locations
          .filter(location => location.photos.length > 0)
          .map(location => {
            const sortedPhotos = [...location.photos].sort(comparePhotoTime);
            const date = sortedPhotos[0]?.date || year.year;
            return {
              year: year.year,
              locationId: location.id,
              locationName: location.name,
              date,
              label: date + " - " + location.name,
            };
          }))
          .sort((left, right) => {
            return left.date.localeCompare(right.date)
              || left.locationName.localeCompare(right.locationName)
              || left.locationId.localeCompare(right.locationId);
          });
      }

      function render() {
        const preferredPhotoId = selectedEditPhotoId || document.getElementById("photoSelect")?.value || "";
        photos = flattenPhotos();
        albums = flattenAlbums();
        renderEditSelectors(preferredPhotoId);
        renderBatchLocationSelectors();
        renderBackgrounds();
        document.getElementById("albumSelect").innerHTML = albums.map(album => {
          return '<option value="' + album.year + '|' + album.locationId + '">' + album.label + '</option>';
        }).join("");

        document.getElementById("library").innerHTML = library.years.map(year => {
          const count = year.locations.reduce((sum, location) => sum + location.photos.length, 0);
          const places = year.locations.map(location => {
            const status = location.sortStatus ? " · " + location.sortStatus : "";
            return location.name + " (" + location.photos.length + status + ")";
          }).join(", ") || "暂无地点";
          return '<div class="card"><strong>' + year.year + '</strong><span>' + count + ' photos</span><span>' + places + '</span></div>';
        }).join("");
        fillEditForm();
      }

      function renderBackgrounds() {
        const images = backgroundConfig.images || [];
        document.getElementById("backgroundInterval").value = String(backgroundConfig.intervalMinutes || 3);
        renderMaskOpacity();
        document.getElementById("backgroundList").innerHTML = images.length ? images.map((image, index) => {
          const active = index === Number(backgroundConfig.currentIndex || 0) ? "当前背景" : "第 " + (index + 1) + " 张";
          return '<div class="background-item" data-id="' + image.id + '">'
            + '<img src="' + image.url + '" alt="">'
            + '<div><strong>' + image.name + '</strong><span>' + active + '</span></div>'
            + '<div class="background-controls">'
            + '<button data-bg-action="up" data-id="' + image.id + '" ' + (index === 0 ? "disabled" : "") + '>↑</button>'
            + '<button data-bg-action="down" data-id="' + image.id + '" ' + (index === images.length - 1 ? "disabled" : "") + '>↓</button>'
            + '<button class="background-delete" data-bg-action="delete" data-id="' + image.id + '" aria-label="删除背景" title="删除背景"><svg class="trash-icon" viewBox="0 0 72 72" fill="none" aria-hidden="true"><path d="M24 21V9C24 6.8 25.8 5 28 5H44C46.2 5 48 6.8 48 9V21" stroke="currentColor" stroke-width="7.5" stroke-linejoin="round"/><path d="M9 23H63" stroke="currentColor" stroke-width="7.5" stroke-linecap="square"/><path d="M17 23V62C17 65.3 19.7 68 23 68H49C52.3 68 55 65.3 55 62V23" stroke="currentColor" stroke-width="7.5" stroke-linejoin="round"/><path d="M31 34V57M41 34V57" stroke="currentColor" stroke-width="7.5" stroke-linecap="square"/></svg></button>'
            + '</div>'
            + '</div>';
        }).join("") : '<div class="card"><strong>暂无背景图片</strong><span>上传后会按列表顺序在前台轮播。</span></div>';
      }

      function renderMaskOpacity() {
        const value = Math.round(Number(backgroundConfig.maskOpacity ?? 1) * 100);
        document.getElementById("backgroundMaskOpacity").value = String(value);
        document.getElementById("backgroundMaskOpacityValue").textContent = value + "%";
      }

      function moveBackground(id, direction) {
        const images = [...(backgroundConfig.images || [])];
        const index = images.findIndex(image => image.id === id);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= images.length) return;
        const [image] = images.splice(index, 1);
        images.splice(targetIndex, 0, image);
        const currentId = backgroundConfig.images[backgroundConfig.currentIndex]?.id;
        backgroundConfig.images = images;
        backgroundConfig.intervalMinutes = Number(document.getElementById("backgroundInterval").value);
        backgroundConfig.currentIndex = Math.max(0, images.findIndex(item => item.id === currentId));
        renderBackgrounds();
      }

      async function deleteBackground(id) {
        if (!id) return;
        const target = backgroundConfig.images.find(image => image.id === id);
        const label = target?.name ? "“" + target.name + "”" : "这张背景";
        if (!confirm("确认删除" + label + "？删除后不可恢复。")) return;
        backgroundConfig = await request("/api/backgrounds", {
          method: "DELETE",
          body: JSON.stringify({ id }),
        });
        renderBackgrounds();
        setMessage("背景已删除。");
      }

      function yearsWithPhotos() {
        return library.years.filter(year => year.locations.some(location => location.photos.length > 0));
      }

      function selectedYearGroup() {
        const yearValue = document.getElementById("editYearSelect").value;
        return library.years.find(year => year.year === yearValue);
      }

      function selectedLocationGroup() {
        const locationId = document.getElementById("editLocationSelect").value;
        return selectedYearGroup()?.locations.find(location => location.id === locationId);
      }

      function selectedBatchYearGroup() {
        const yearValue = document.getElementById("batchYearSelect").value;
        return library.years.find(year => year.year === yearValue);
      }

      function selectedBatchLocationGroup() {
        const locationId = document.getElementById("batchLocationSelect").value;
        return selectedBatchYearGroup()?.locations.find(location => location.id === locationId);
      }

      function renderBatchLocationSelectors() {
        const yearSelect = document.getElementById("batchYearSelect");
        const locationSelect = document.getElementById("batchLocationSelect");
        const currentYearValue = yearSelect.value;
        const currentLocationId = locationSelect.value;
        const years = yearsWithPhotos();

        yearSelect.innerHTML = years.map(year => '<option value="' + year.year + '">' + year.year + '</option>').join("");
        if (!years.length) {
          locationSelect.innerHTML = "";
          return;
        }

        const targetYear = years.some(year => year.year === currentYearValue) ? currentYearValue : years[0].year;
        yearSelect.value = targetYear;
        const locations = (selectedBatchYearGroup()?.locations || []).filter(location => location.photos.length > 0);
        locationSelect.innerHTML = locations.map(location => '<option value="' + location.id + '">' + location.name + " (" + location.photos.length + " photos)" + '</option>').join("");
        locationSelect.value = locations.some(location => location.id === currentLocationId) ? currentLocationId : locations[0]?.id || "";
      }

      function renderEditSelectors(preferredPhotoId = "") {
        const yearSelect = document.getElementById("editYearSelect");
        const locationSelect = document.getElementById("editLocationSelect");
        const photoSelect = document.getElementById("photoSelect");
        const currentYearValue = yearSelect.value;
        const currentLocationId = locationSelect.value;
        const preferredPhoto = photos.find(photo => photo.id === preferredPhotoId);
        const years = yearsWithPhotos();

        yearSelect.innerHTML = years.map(year => '<option value="' + year.year + '">' + year.year + '</option>').join("");
        if (!years.length) {
          locationSelect.innerHTML = "";
          photoSelect.innerHTML = "";
          selectedEditPhotoId = "";
          return;
        }

        const targetYear = preferredPhoto?.year || (years.some(year => year.year === currentYearValue) ? currentYearValue : years[0].year);
        yearSelect.value = targetYear;

        const yearGroup = selectedYearGroup();
        const locations = (yearGroup?.locations || []).filter(location => location.photos.length > 0);
        locationSelect.innerHTML = locations.map(location => '<option value="' + location.id + '">' + location.name + '</option>').join("");

        const targetLocationId = preferredPhoto?.locationId || (locations.some(location => location.id === currentLocationId) ? currentLocationId : locations[0]?.id || "");
        locationSelect.value = targetLocationId;

        const locationGroup = selectedLocationGroup();
        const locationPhotos = (locationGroup?.photos || [])
          .map(photo => photos.find(item => item.id === photo.id))
          .filter(Boolean);
        photoSelect.innerHTML = locationPhotos.map(photo => {
          return '<option value="' + photo.id + '">' + (photo.date || "") + ' / ' + photo.name + '</option>';
        }).join("");

        const targetPhotoId = preferredPhoto && locationPhotos.some(photo => photo.id === preferredPhoto.id)
          ? preferredPhoto.id
          : locationPhotos[0]?.id || "";
        photoSelect.value = targetPhotoId;
        selectedEditPhotoId = targetPhotoId;
      }

      async function refresh() {
        const [nextLibrary, nextBackgrounds] = await Promise.all([
          request("/api/library"),
          request("/api/backgrounds"),
        ]);
        library = nextLibrary;
        backgroundConfig = nextBackgrounds;
        render();
      }

      function selectedPhoto() {
        const id = document.getElementById("photoSelect").value;
        return photos.find(photo => photo.id === id);
      }

      function fillEditForm() {
        const photo = selectedPhoto();
        document.getElementById("editDate").value = photo?.date || "";
        const preview = document.getElementById("editPreview");
        const empty = document.getElementById("editPreviewEmpty");
        if (photo?.url) {
          preview.src = photo.url;
          preview.style.display = "block";
          empty.style.display = "none";
        } else {
          preview.removeAttribute("src");
          preview.style.display = "none";
          empty.style.display = "grid";
        }
      }

      document.getElementById("photoFile").onchange = () => {
        selectedFiles = Array.from(document.getElementById("photoFile").files || []);
        renderFileSummary();
      };

      document.getElementById("fileSummary").onclick = () => {
        document.getElementById("fileSummary").classList.toggle("open");
      };

      document.getElementById("backgroundFile").onchange = () => {
        selectedBackgroundFiles = Array.from(document.getElementById("backgroundFile").files || []);
        renderBackgroundFileSummary();
      };

      document.getElementById("backgroundFileSummary").onclick = () => {
        document.getElementById("backgroundFileSummary").classList.toggle("open");
      };

      document.getElementById("backgroundMaskOpacity").oninput = () => {
        document.getElementById("backgroundMaskOpacityValue").textContent = document.getElementById("backgroundMaskOpacity").value + "%";
      };

      document.getElementById("parsePhotoInfo").onclick = () => {
        if (!selectedFiles.length) return setMessage("请先选择照片。");
        const parsed = parsePhotoName(selectedFiles[0].name);
        if (!parsed) return setMessage("第一张照片名称无法解析，请确认格式为：序号_地点_日期。");
        document.getElementById("uploadDate").value = parsed.date;
        document.getElementById("uploadLocation").value = parsed.location;
        setMessage("已解析：" + parsed.location + " / " + parsed.date);
      };

      document.getElementById("uploadButton").onclick = async () => {
        const files = selectedFiles;
        const date = document.getElementById("uploadDate").value;
        const location = document.getElementById("uploadLocation").value.trim();
        if (!files.length) return setMessage("请选择照片。");
        if (!date || !location) return setMessage("请选择照片后确认日期和地点。");

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          setMessage("正在上传 " + (index + 1) + " / " + files.length + "...");
          const dataUrl = await readFileAsDataUrl(file);
          const dimensions = await readImageDimensions(dataUrl);
          await request("/api/photo", {
            method: "POST",
            body: JSON.stringify({ date, location, filename: file.name, mime: file.type, dataUrl, ...dimensions }),
          });
        }
        document.getElementById("photoFile").value = "";
        selectedFiles = [];
        renderFileSummary();
        setMessage("上传成功，共 " + files.length + " 张。");
        await refresh();
      };

      document.getElementById("editYearSelect").onchange = () => {
        selectedEditPhotoId = "";
        renderEditSelectors();
        fillEditForm();
      };

      document.getElementById("editLocationSelect").onchange = () => {
        selectedEditPhotoId = "";
        renderEditSelectors();
        fillEditForm();
      };

      document.getElementById("photoSelect").onchange = () => {
        selectedEditPhotoId = document.getElementById("photoSelect").value;
        fillEditForm();
      };

      document.getElementById("showBatchLocation").onclick = () => {
        renderBatchLocationSelectors();
        document.getElementById("batchLocationPanel").hidden = false;
        document.getElementById("batchLocationName").value = "";
      };

      document.getElementById("cancelBatchLocation").onclick = () => {
        document.getElementById("batchLocationPanel").hidden = true;
        document.getElementById("batchLocationName").value = "";
      };

      document.getElementById("batchYearSelect").onchange = () => {
        renderBatchLocationSelectors();
      };

      document.getElementById("savePhoto").onclick = async () => {
        const photo = selectedPhoto();
        if (!photo) return;
        await request("/api/photo", {
          method: "PATCH",
          body: JSON.stringify({
            id: photo.id,
            date: document.getElementById("editDate").value,
            location: photo.locationName,
          }),
        });
        setMessage("保存成功。");
        await refresh();
      };

      document.getElementById("saveBatchLocation").onclick = async () => {
        const year = document.getElementById("batchYearSelect").value;
        const location = selectedBatchLocationGroup();
        const name = document.getElementById("batchLocationName").value.trim();
        if (!year || !location) return setMessage("请选择要修改的年份和地点。");
        if (!name) return setMessage("请输入新的地点名称。");
        if (name === location.name) return setMessage("新地点名称和原地点相同。");
        const message = "确认将 " + year + " 年“" + location.name + "”下的 " + location.photos.length + " 张照片统一修改为“" + name + "”？";
        if (!confirm(message)) return;
        await request("/api/location", {
          method: "PATCH",
          body: JSON.stringify({ year, locationId: location.id, name }),
        });
        document.getElementById("batchLocationPanel").hidden = true;
        document.getElementById("batchLocationName").value = "";
        setMessage("批量修改地点成功。");
        await refresh();
      };

      document.getElementById("deletePhoto").onclick = async () => {
        const photo = selectedPhoto();
        if (!photo || !confirm("确认删除这张照片？删除后不可恢复。")) return;
        await request("/api/photo", { method: "DELETE", body: JSON.stringify({ id: photo.id }) });
        setMessage("删除成功。");
        await refresh();
      };

      document.getElementById("sortAlbum").onclick = async () => {
        const value = document.getElementById("albumSelect").value;
        const [year, locationId] = value.split("|");
        if (!year || !locationId) return setMessage("请先选择要重新排列的相册。");
        const album = albums.find(item => item.year === year && item.locationId === locationId);
        await request("/api/reorder", { method: "POST", body: JSON.stringify({ year, locationId }) });
        setMessage("已开始重新排列相册：" + (album?.label || year + " - " + locationId) + "。完成后前台会自动读取新顺序。");
        await refresh();
      };

      document.getElementById("sortAllAlbums").onclick = async () => {
        if (!albums.length) return setMessage("当前没有可重新排列的相册。");
        if (!confirm("确认重新排列全部相册？这会依次处理所有相册，可能需要较长时间。")) return;
        await request("/api/reorder-all", { method: "POST" });
        setMessage("已开始重新排列全部相册，共 " + albums.length + " 个。完成后前台会自动读取新顺序。");
        await refresh();
      };

      document.getElementById("uploadBackgrounds").onclick = async () => {
        const files = selectedBackgroundFiles;
        if (!files.length) return setMessage("请选择背景图片。");

        const images = [];
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          setMessage("正在上传背景 " + (index + 1) + " / " + files.length + "...");
          images.push({
            filename: file.name,
            mime: file.type,
            dataUrl: await readFileAsDataUrl(file),
          });
        }

        await request("/api/backgrounds", {
          method: "POST",
          body: JSON.stringify({ images }),
        });
        document.getElementById("backgroundFile").value = "";
        selectedBackgroundFiles = [];
        renderBackgroundFileSummary();
        setMessage("背景上传成功，共 " + files.length + " 张。");
        await refresh();
      };

      document.getElementById("saveBackgrounds").onclick = async () => {
        await request("/api/backgrounds", {
          method: "PATCH",
          body: JSON.stringify({
            intervalMinutes: Number(document.getElementById("backgroundInterval").value),
            images: backgroundConfig.images.map(image => image.id),
            currentIndex: backgroundConfig.currentIndex,
          }),
        });
        setMessage("背景顺序和播放间隔已保存。");
        await refresh();
      };

      document.getElementById("saveMaskOpacity").onclick = async () => {
        const value = Number(document.getElementById("backgroundMaskOpacity").value);
        if (!confirm("确认将前台背景遮罩透明度调整为 " + value + "%？")) return;
        await request("/api/backgrounds", {
          method: "PATCH",
          body: JSON.stringify({ maskOpacity: value / 100 }),
        });
        setMessage("遮罩透明度已保存。");
        await refresh();
      };

      document.getElementById("nextBackground").onclick = async () => {
        if (!backgroundConfig.images.length) return setMessage("请先上传背景图片。");
        backgroundConfig = await request("/api/backgrounds/next", { method: "POST" });
        renderBackgrounds();
        setMessage("已切换到下一张背景。");
      };

      document.getElementById("backgroundList").onclick = async (event) => {
        const button = event.target.closest("[data-bg-action]");
        if (!button) return;
        if (button.dataset.bgAction === "delete") {
          await deleteBackground(button.dataset.id);
          return;
        }
        moveBackground(button.dataset.id, button.dataset.bgAction === "up" ? -1 : 1);
      };

      document.querySelectorAll("[data-panel]").forEach(button => {
        button.onclick = () => {
          document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
          document.getElementById(button.dataset.panel).classList.add("active");
        };
      });

      refresh();
    </script>
  </body>
</html>`
}

function loginHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Photo Admin Login</title>
    <style>
      :root { color: #fff; background: #171411; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: radial-gradient(circle at 30% 10%, #584a39, transparent 32%), #171411; }
      form { width: min(360px, calc(100vw - 36px)); padding: 24px; border-radius: 18px; background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); }
      h1 { margin: 0 0 18px; font-size: 24px; }
      label { display: block; margin: 12px 0 6px; color: rgba(255,255,255,.76); font-size: 13px; }
      input, button { width: 100%; height: 42px; border: 0; border-radius: 12px; font: inherit; }
      input { padding: 0 12px; }
      button { margin-top: 16px; color: #151515; background: #f0f0f0; font-weight: 700; cursor: pointer; }
      p { min-height: 20px; color: #f3d7a5; }
    </style>
  </head>
  <body>
    <form id="loginForm">
      <h1>Photo Admin</h1>
      <label for="user">账号</label>
      <input id="user" autocomplete="username" />
      <label for="password">密码</label>
      <input id="password" type="password" autocomplete="current-password" />
      <button>登录</button>
      <p id="message"></p>
    </form>
    <script>
      document.getElementById("loginForm").onsubmit = async (event) => {
        event.preventDefault();
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user: document.getElementById("user").value,
            password: document.getElementById("password").value,
          }),
        });
        if (response.ok) location.href = "/admin";
        else document.getElementById("message").textContent = "账号或密码错误。";
      };
    </script>
  </body>
</html>`
}

const siteServer = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`)
  if (url.pathname === "/admin") {
    response.writeHead(302, { Location: `http://${host}:${adminPort}/admin` })
    response.end()
    return
  }

  if (request.method === "GET" && url.pathname === "/api/library") {
    sendJson(response, readLibrary())
    return
  }

  if (request.method === "GET" && url.pathname === "/api/backgrounds") {
    sendJson(response, readBackgrounds())
    return
  }

  if (request.method === "POST" && url.pathname === "/api/backgrounds/next") {
    const backgrounds = readBackgrounds()
    if (!backgrounds.images.length) {
      sendJson(response, { error: "No background images" }, 400)
      return
    }
    backgrounds.currentIndex = (backgrounds.currentIndex + 1) % backgrounds.images.length
    writeBackgrounds(backgrounds)
    sendJson(response, backgrounds)
    return
  }

  if (request.method === "GET" && url.pathname === "/api/image") {
    await serveOssImage(url, response)
    return
  }

  if (url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/backgrounds/")) {
    serveFile(response, dataDir, url.pathname)
    return
  }

  serveFile(response, distRoot, request.url || "/")
})

const adminServer = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`)

  if (request.method === "OPTIONS") {
    sendJson(response, {})
    return
  }

  if (url.pathname === "/") {
    response.writeHead(302, { Location: "/admin" })
    response.end()
    return
  }

  if (url.pathname === "/admin") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    response.end(isAuthed(request) ? adminHtml() : loginHtml())
    return
  }

  if (url.pathname.startsWith("/uploads/")) {
    serveFile(response, dataDir, url.pathname)
    return
  }

  if (url.pathname.startsWith("/backgrounds/")) {
    serveFile(response, dataDir, url.pathname)
    return
  }

  try {
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(request)
      if (body.user !== adminUser || body.password !== adminPassword) {
        sendJson(response, { error: "Invalid credentials" }, 401)
        return
      }
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`,
      })
      response.end(JSON.stringify({ ok: true }))
      return
    }

    if (request.method === "GET" && url.pathname === "/api/library") {
      sendJson(response, readLibrary())
      return
    }

    if (request.method === "GET" && url.pathname === "/api/backgrounds") {
      sendJson(response, readBackgrounds())
      return
    }

    requireAdmin(request)

    if (request.method === "POST" && url.pathname === "/api/year") {
      const body = await readBody(request)
      const year = String(body.year || "").trim()
      if (!year) throw new Error("Missing year")
      const library = readLibrary()
      if (!findYear(library, year)) {
        library.years.push({ year, locations: [] })
        writeLibrary(library)
      }
      sendJson(response, library)
      return
    }

    if (request.method === "POST" && url.pathname === "/api/location") {
      const body = await readBody(request)
      const year = String(body.year || "").trim()
      const name = String(body.name || "").trim()
      if (!year || !name) throw new Error("Missing year or location name")
      const library = readLibrary()
      let yearGroup = findYear(library, year)
      if (!yearGroup) {
        yearGroup = { year, locations: [] }
        library.years.push(yearGroup)
      }
      yearGroup.locations.push({ id: safeId("loc"), name, photos: [] })
      writeLibrary(library)
      sendJson(response, library)
      return
    }

    if (request.method === "PATCH" && url.pathname === "/api/location") {
      const body = await readBody(request)
      const library = readLibrary()
      const writableYear = findYear(library, body.year)
      if (!writableYear) throw new Error("Year not found")
      const location = writableYear.locations.find((item) => item.id === body.locationId)
      if (!location) throw new Error("Location not found")
      const name = String(body.name || location.name).trim()
      if (!name) throw new Error("Missing location name")
      const existingLocation = writableYear.locations.find((item) => item.id !== location.id && item.name === name)
      if (existingLocation) {
        existingLocation.photos.push(...location.photos)
        markNeedsSort(existingLocation)
        writableYear.locations = writableYear.locations.filter((item) => item.id !== location.id)
      } else {
        location.name = name
      }
      removeEmptyGroups(library)
      writeLibrary(library)
      sendJson(response, library)
      return
    }

    if (request.method === "POST" && url.pathname === "/api/photo") {
      const body = await readBody(request)
      const library = readLibrary()
      const date = String(body.date || "").trim()
      const locationName = String(body.location || "").trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !locationName) throw new Error("Missing date or location")
      const location = getOrCreateLocation(library, date, locationName)

      const { id, filename } = saveDataImage(body.dataUrl, body.mime, "photo", uploadDir)
      location.photos.push({
        id,
        name: body.filename || filename,
        url: `/uploads/${filename}`,
        objectKey: `photos/original/${filename}`,
        date,
        width: Number(body.width) || 4,
        height: Number(body.height) || 3,
      })
      markNeedsSort(location)
      writeLibrary(library)
      sendJson(response, library)
      return
    }

    if (request.method === "PATCH" && url.pathname === "/api/photo") {
      const body = await readBody(request)
      const library = readLibrary()
      const found = findPhoto(library, body.id)
      if (!found) throw new Error("Photo not found")
      const date = String(body.date || found.photo.date).trim()
      const locationName = String(body.location || found.location.name).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !locationName) throw new Error("Missing date or location")

      found.location.photos.splice(found.photoIndex, 1)
      markNeedsSort(found.location)
      found.photo.date = date
      delete found.photo.sortIndex
      const targetLocation = getOrCreateLocation(library, date, locationName)
      targetLocation.photos.push(found.photo)
      markNeedsSort(targetLocation)
      removeEmptyGroups(library)
      writeLibrary(library)
      sendJson(response, library)
      return
    }

    if (request.method === "DELETE" && url.pathname === "/api/photo") {
      const body = await readBody(request)
      const library = readLibrary()
      const found = findPhoto(library, body.id)
      if (!found) throw new Error("Photo not found")
      found.location.photos.splice(found.photoIndex, 1)
      const filename = found.photo.url?.replace(/^\/uploads\//, "")
      if (filename) {
        const filePath = join(uploadDir, filename)
        if (existsSync(filePath)) unlinkSync(filePath)
      }
      removeEmptyGroups(library)
      writeLibrary(library)
      sendJson(response, library)
      return
    }

    if (request.method === "POST" && url.pathname === "/api/backgrounds") {
      const body = await readBody(request)
      const images = Array.isArray(body.images) ? body.images : []
      if (!images.length) throw new Error("No background images")
      const backgrounds = readBackgrounds()

      for (const image of images) {
        const { id, filename } = saveDataImage(image.dataUrl, image.mime, "background", backgroundDir)
        backgrounds.images.push({
          id,
          name: image.filename || filename,
          url: `/backgrounds/${filename}`,
          objectKey: `backgrounds/${filename}`,
          createdAt: new Date().toISOString(),
        })
      }

      if (backgrounds.images.length === images.length) {
        backgrounds.currentIndex = 0
      }
      writeBackgrounds(backgrounds)
      sendJson(response, backgrounds)
      return
    }

    if (request.method === "PATCH" && url.pathname === "/api/backgrounds") {
      const body = await readBody(request)
      const backgrounds = readBackgrounds()
      const orderedIds = Array.isArray(body.images) ? body.images.map(String) : []
      if (orderedIds.length) {
        const byId = new Map(backgrounds.images.map((image) => [image.id, image]))
        const orderedImages = orderedIds.map((id) => byId.get(id)).filter(Boolean)
        const orderedIdSet = new Set(orderedIds)
        const remainingImages = backgrounds.images.filter((image) => !orderedIdSet.has(image.id))
        backgrounds.images = [...orderedImages, ...remainingImages]
      }
      if (body.intervalMinutes !== undefined) {
        backgrounds.intervalMinutes = Number(body.intervalMinutes)
      }
      if (body.maskOpacity !== undefined) {
        backgrounds.maskOpacity = Number(body.maskOpacity)
      }
      if (body.currentIndex !== undefined) {
        backgrounds.currentIndex = Number(body.currentIndex)
      }
      writeBackgrounds(backgrounds)
      sendJson(response, backgrounds)
      return
    }

    if (request.method === "DELETE" && url.pathname === "/api/backgrounds") {
      const body = await readBody(request)
      const backgrounds = readBackgrounds()
      const deletedIndex = backgrounds.images.findIndex((image) => image.id === body.id)
      if (deletedIndex < 0) throw new Error("Background not found")

      const [removed] = backgrounds.images.splice(deletedIndex, 1)
      const filename = removed.url?.replace(/^\/backgrounds\//, "")
      if (filename && !filename.includes("/") && !filename.includes("\\")) {
        const filePath = join(backgroundDir, filename)
        if (existsSync(filePath)) unlinkSync(filePath)
      }

      if (backgrounds.currentIndex > deletedIndex) {
        backgrounds.currentIndex -= 1
      } else if (backgrounds.currentIndex >= backgrounds.images.length) {
        backgrounds.currentIndex = Math.max(0, backgrounds.images.length - 1)
      }

      writeBackgrounds(backgrounds)
      sendJson(response, backgrounds)
      return
    }

    if (request.method === "POST" && url.pathname === "/api/backgrounds/next") {
      const backgrounds = readBackgrounds()
      if (!backgrounds.images.length) throw new Error("No background images")
      backgrounds.currentIndex = (backgrounds.currentIndex + 1) % backgrounds.images.length
      writeBackgrounds(backgrounds)
      sendJson(response, backgrounds)
      return
    }

    if (request.method === "POST" && url.pathname === "/api/reorder") {
      const body = await readBody(request)
      const library = readLibrary()
      const year = findYear(library, body.year)
      const location = year?.locations.find((item) => item.id === body.locationId)
      if (!location) throw new Error("Location not found")
      location.sortStatus = "sorting"
      delete location.sortError
      writeLibrary(library)
      runClipSort(body.year, body.locationId)
      sendJson(response, library)
      return
    }

    if (request.method === "POST" && url.pathname === "/api/reorder-all") {
      const library = readLibrary()
      const targets = library.years.flatMap((year) => year.locations
        .filter((location) => location.photos.length > 0)
        .map((location) => {
          const sortedPhotos = [...location.photos].sort(comparePhotoTime)
          return {
            year: year.year,
            locationId: location.id,
            locationName: location.name,
            date: sortedPhotos[0]?.date || year.year,
          }
        }))
        .sort((left, right) => (
          left.date.localeCompare(right.date)
          || left.locationName.localeCompare(right.locationName)
          || left.locationId.localeCompare(right.locationId)
        ))

      if (!targets.length) throw new Error("No albums to reorder")

      for (const target of targets) {
        const year = findYear(library, target.year)
        const location = year?.locations.find((item) => item.id === target.locationId)
        if (!location) continue
        location.sortStatus = "sorting"
        delete location.sortError
      }

      writeLibrary(library)
      runClipSortQueue(targets)
      sendJson(response, library)
      return
    }

    sendJson(response, { error: "Not found" }, 404)
  } catch (error) {
    sendJson(response, { error: error.message }, error.status || 400)
  }
})

function explainListenError(name, port) {
  return (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`${name} port ${port} is already in use. Set ${name === "Photo gallery" ? "SITE_PORT" : "ADMIN_PORT"} to another port.`)
      return
    }

    if (error.code === "EPERM") {
      console.error(`${name} could not listen on ${host}:${port}. The current sandbox has not granted local network listening permission.`)
      return
    }

    console.error(error)
  }
}

siteServer.on("error", explainListenError("Photo gallery", sitePort))
adminServer.on("error", explainListenError("Photo admin", adminPort))

siteServer.listen(sitePort, host, () => {
  console.log(`Photo gallery running at http://${host}:${sitePort}`)
})

adminServer.listen(adminPort, host, () => {
  console.log(`Photo admin running at http://${host}:${adminPort}`)
})
