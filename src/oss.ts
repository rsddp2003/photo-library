const ossBaseUrl = (import.meta.env.VITE_OSS_PUBLIC_BASE_URL || "").replace(/\/+$/, "")

type ImageSize = "original" | "thumb" | "large"

function cleanObjectKey(path: string) {
  return path.replace(/^\/+/, "").replace(/^uploads\//, "photos/original/")
}

function appendOssStyle(url: string, size: ImageSize) {
  if (size === "original" || !ossBaseUrl) {
    return url
  }

  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}x-oss-process=style/${size}`
}

export function getOriginalUrl(path: string) {
  if (!path) {
    return ""
  }

  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) {
    return path
  }

  const objectKey = cleanObjectKey(path)
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
