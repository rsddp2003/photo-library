import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const dist = join(root, "dist")

rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, "assets"), { recursive: true })
mkdirSync(join(dist, "data"), { recursive: true })

execFileSync(
  join(root, "node_modules", "esbuild", "bin", "esbuild"),
  [
    "src/main.tsx",
    "--bundle",
    "--format=esm",
    "--jsx=automatic",
    "--target=es2020",
    "--minify",
    "--loader:.jpg=file",
    "--loader:.jpeg=file",
    "--loader:.png=file",
    "--asset-names=[name]-[hash]",
    "--public-path=/assets",
    "--outfile=dist/assets/app.js",
    "--define:process.env.NODE_ENV=\"production\"",
    `--define:import.meta.env.VITE_OSS_PUBLIC_BASE_URL=${JSON.stringify(process.env.VITE_OSS_PUBLIC_BASE_URL || "")}`,
    `--define:import.meta.env.VITE_API_BASE_URL=${JSON.stringify(process.env.VITE_API_BASE_URL || "")}`,
  ],
  { cwd: root, stdio: "inherit" },
)

copyFileSync(join(root, "data", "library.json"), join(dist, "data", "library.json"))
copyFileSync(join(root, "data", "backgrounds.json"), join(dist, "data", "backgrounds.json"))

writeFileSync(
  join(dist, "index.html"),
  `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vision Photo Gallery</title>
    <link rel="stylesheet" href="/assets/app.css" />
    <script type="module" src="/assets/app.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
)
