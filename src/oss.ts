const ossBaseUrl = (import.meta.env.VITE_OSS_PUBLIC_BASE_URL || "").replace(/\/+$/, "")
const imageProxyBaseUrl = (import.meta.env.VITE_OSS_IMAGE_PROXY_BASE_URL ?? "/api/image").replace(/\/+$/, "")

type ImageSize = "original" | "thumb" | "large"

function cleanObjectKey(path: string) {
  let objectKey = path
  if (/^https?:\/\//i.test(objectKey)) {
    try {
      objectKey = new URL(objectKey).pathname
    } catch {
      return objectKey
    }
  }

  return objectKey.replace(/^\/+/, "").replace(/^uploads\//, "photos/original/")
}

function appendOssStyle(url: string, size: ImageSize) {
  if (size === "original") {
    return url
  }

  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}${imageProxyBaseUrl ? "style" : "x-oss-process"}=${imageProxyBaseUrl ? size : `style/${size}`}`
}

function getProxyUrl(objectKey: string) {
  const separator = imageProxyBaseUrl.includes("?") ? "&" : "?"
  return `${imageProxyBaseUrl}${separator}key=${encodeURIComponent(objectKey)}`
}

export function getOriginalUrl(path: string) {
  if (!path) {
    return ""
  }

  if (path.startsWith("data:")) {
    return path
  }

  const objectKey = cleanObjectKey(path)
  if (imageProxyBaseUrl) {
    return getProxyUrl(objectKey)
  }

  if (/^https?:\/\//i.test(path)) {
    return path
  }

  return ossBaseUrl ? `${ossBaseUrl}/${objectKey}` : `/${objectKey.replace(/^photos\/original\//, "uploads/")}`
}

export function getThumbUrl(path: string) {
  return appendOssStyle(getOriginalUrl(path), "thumb")
}

export function getLargeUrl(path: string) {
  return appendOssStyle(getOriginalUrl(path), "large")
}

export function getObjectKey(path: string) {
  return cleanObjectKey(path)
}
