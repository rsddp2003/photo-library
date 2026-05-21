const OSS_BASE_URL = "https://photo-library-rsddp.oss-cn-guangzhou.aliyuncs.com"
const REFERER = "https://rsddp.top/"

const contentTypes = {
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

function normalizeKey(value) {
  const rawValue = String(value || "").trim()
  if (!rawValue) {
    return ""
  }

  let key = rawValue
  if (/^https?:\/\//i.test(key)) {
    const url = new URL(key)
    key = url.pathname
  }

  key = decodeURIComponent(key).replace(/^\/+/, "").replace(/^uploads\//, "photos/original/")
  if (key.includes("..") || key.startsWith("api/")) {
    return ""
  }

  return key
}

function contentTypeForKey(key, upstreamType) {
  if (upstreamType && !upstreamType.includes("application/octet-stream")) {
    return upstreamType
  }

  const extension = key.split(".").pop()?.toLowerCase() || ""
  return contentTypes[extension] || "application/octet-stream"
}

export default async function handler(request, response) {
  const requestUrl = new URL(request.url || "/", `https://${request.headers.host || "rsddp.top"}`)
  const key = normalizeKey(requestUrl.searchParams.get("key") || requestUrl.searchParams.get("path"))
  const style = String(requestUrl.searchParams.get("style") || "").trim()

  if (!key) {
    response.status(400).json({ error: "Missing image key" })
    return
  }

  const upstreamUrl = new URL(`${OSS_BASE_URL}/${key}`)
  if (imageProcesses[style]) {
    upstreamUrl.searchParams.set("x-oss-process", imageProcesses[style])
  }

  const upstream = await fetch(upstreamUrl, {
    headers: {
      Referer: REFERER,
    },
  })

  if (!upstream.ok || !upstream.body) {
    response.status(upstream.status).json({ error: "Unable to load image" })
    return
  }

  response.setHeader("Content-Type", contentTypeForKey(key, upstream.headers.get("content-type") || ""))
  response.setHeader("Content-Disposition", "inline")
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  response.setHeader("X-Content-Type-Options", "nosniff")

  const buffer = Buffer.from(await upstream.arrayBuffer())
  response.status(200).send(buffer)
}
