import { createHmac } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const backgroundDir = join(root, "data", "backgrounds")
const envFiles = [".env.local", ".env"].map((file) => join(root, file))
const prefix = "backgrounds/"

loadEnvFiles()

const accessKeyId = env("ALIYUN_OSS_ACCESS_KEY_ID")
const accessKeySecret = env("ALIYUN_OSS_ACCESS_KEY_SECRET")
const bucket = env("ALIYUN_OSS_BUCKET", "photo-library-rsddp")
const region = env("ALIYUN_OSS_REGION", "cn-guangzhou")
const endpoint = env("ALIYUN_OSS_ENDPOINT", `https://${bucket}.oss-${region}.aliyuncs.com`)
const securityToken = env("ALIYUN_OSS_SECURITY_TOKEN", "")
const dryRun = process.argv.includes("--dry-run")

if (!accessKeyId || !accessKeySecret) {
  fail("Missing ALIYUN_OSS_ACCESS_KEY_ID or ALIYUN_OSS_ACCESS_KEY_SECRET.")
}

if (!existsSync(backgroundDir)) {
  fail(`Local background directory not found: ${backgroundDir}`)
}

const localFiles = listLocalBackgroundFiles()
const remoteKeys = await listRemoteBackgroundKeys()
const remoteFiles = new Set(remoteKeys.map((key) => key.replace(prefix, "")))
const toUpload = localFiles.filter((file) => !remoteFiles.has(file))
const toDeleteManually = [...remoteFiles].filter((file) => !localFiles.includes(file)).sort()

console.log(`Local backgrounds: ${localFiles.length}`)
console.log(`OSS backgrounds: ${remoteFiles.size}`)
console.log(`Need upload: ${toUpload.length}`)
console.log(`Only on OSS: ${toDeleteManually.length}`)

if (toUpload.length) {
  console.log("\nUploading:")
  for (const filename of toUpload) {
    const key = `${prefix}${filename}`
    console.log(`- ${filename}${dryRun ? " (dry run)" : ""}`)
    if (!dryRun) {
      await putObject(key, join(backgroundDir, filename))
    }
  }
} else {
  console.log("\nNo new local background files to upload.")
}

if (toDeleteManually.length) {
  console.log("\nOSS has these extra background files. Delete manually if they are no longer needed:")
  for (const filename of toDeleteManually) {
    console.log(`- ${filename}`)
  }
} else {
  console.log("\nNo extra OSS background files found.")
}

function loadEnvFiles() {
  for (const filePath of envFiles) {
    if (!existsSync(filePath)) continue
    const lines = readFileSync(filePath, "utf-8").split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match || process.env[match[1]] !== undefined) continue
      process.env[match[1]] = unquoteEnvValue(match[2].trim())
    }
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function env(name, fallback = "") {
  return process.env[name] || fallback
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function listLocalBackgroundFiles() {
  return readdirSync(backgroundDir)
    .filter((filename) => {
      const filePath = join(backgroundDir, filename)
      return statSync(filePath).isFile() && /\.(jpe?g|png|webp|gif|avif)$/i.test(filename)
    })
    .sort()
}

async function listRemoteBackgroundKeys() {
  const keys = []
  let marker = ""

  while (true) {
    const params = new URLSearchParams({
      prefix,
      "max-keys": "1000",
      "encoding-type": "url",
    })
    if (marker) {
      params.set("marker", marker)
    }

    const response = await ossFetch("GET", `/?${params.toString()}`)
    const text = await response.text()
    if (!response.ok) {
      fail(`Unable to list OSS backgrounds: HTTP ${response.status}\n${text}`)
    }

    keys.push(...xmlValues(text, "Key").map(decodeOssXmlValue).filter((key) => key !== prefix && key.startsWith(prefix)))

    const isTruncated = xmlValues(text, "IsTruncated")[0] === "true"
    const nextMarker = decodeOssXmlValue(xmlValues(text, "NextMarker")[0] || "")
    if (!isTruncated || !nextMarker) {
      break
    }
    marker = nextMarker
  }

  return keys.sort()
}

async function putObject(key, filePath) {
  const body = readFileSync(filePath)
  const contentType = contentTypeForFile(filePath)
  const response = await ossFetch("PUT", `/${encodeObjectKey(key)}`, {
    body,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    fail(`Upload failed for ${key}: HTTP ${response.status}\n${text}`)
  }
}

async function ossFetch(method, pathAndQuery, options = {}) {
  const requestUrl = new URL(pathAndQuery, endpoint)
  const date = new Date().toUTCString()
  const headers = {
    Date: date,
    ...(options.headers || {}),
  }

  if (securityToken) {
    headers["x-oss-security-token"] = securityToken
  }

  headers.Authorization = authorizationHeader(method, requestUrl, headers)

  return fetch(requestUrl, {
    method,
    headers,
    body: options.body,
  })
}

function authorizationHeader(method, requestUrl, headers) {
  const contentMd5 = headers["Content-MD5"] || headers["Content-Md5"] || ""
  const contentType = headers["Content-Type"] || ""
  const canonicalHeaders = Object.entries(headers)
    .filter(([key]) => key.toLowerCase().startsWith("x-oss-"))
    .map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join("")
  const resource = canonicalizedResource(requestUrl)
  const stringToSign = [method, contentMd5, contentType, headers.Date].join("\n") + "\n" + canonicalHeaders + resource
  const signature = createHmac("sha1", accessKeySecret).update(stringToSign, "utf8").digest("base64")
  return `OSS ${accessKeyId}:${signature}`
}

function canonicalizedResource(requestUrl) {
  const objectPath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""))
  const resourcePath = objectPath ? `/${bucket}/${objectPath}` : `/${bucket}/`
  const signedSubresources = new Set([
    "acl",
    "uploads",
    "location",
    "cors",
    "logging",
    "website",
    "referer",
    "lifecycle",
    "delete",
    "append",
    "tagging",
    "objectMeta",
    "uploadId",
    "partNumber",
    "security-token",
    "position",
    "img",
    "style",
    "styleName",
    "replication",
    "replicationProgress",
    "replicationLocation",
    "cname",
    "bucketInfo",
    "comp",
    "qos",
    "live",
    "status",
    "vod",
    "startTime",
    "endTime",
    "symlink",
    "x-oss-process",
    "callback",
    "callback-var",
  ])
  const subresources = [...requestUrl.searchParams.entries()]
    .filter(([key]) => signedSubresources.has(key) || key.startsWith("response-") || key.startsWith("x-oss-ac-"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => (value ? `${key}=${value}` : key))

  return subresources.length ? `${resourcePath}?${subresources.join("&")}` : resourcePath
}

function encodeObjectKey(key) {
  return key.split("/").map(encodeURIComponent).join("/")
}

function xmlValues(xml, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g")
  const values = []
  let match
  while ((match = pattern.exec(xml))) {
    values.push(decodeXmlEntities(match[1]))
  }
  return values
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function decodeOssXmlValue(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function contentTypeForFile(filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".webp") return "image/webp"
  if (extension === ".gif") return "image/gif"
  if (extension === ".avif") return "image/avif"
  return "application/octet-stream"
}
