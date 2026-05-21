# Codex 执行文档：照片展示网站接入阿里云 OSS 并部署到云端

## 1. 当前目标

将现有照片展示网站部署到云端，并使用阿里云 OSS 存储照片资源。

目标结构：

```text
GitHub：只存代码
Vercel 或阿里云服务：部署网站前端
阿里云 OSS：存储照片原图、缩略图、背景图
后续数据库：存储照片元数据，如地点、日期、排序、URL
```

当前域名：

```text
rsddp.top
```

建议域名规划：

```text
rsddp.top        主站
www.rsddp.top    主站别名
img.rsddp.top    OSS / CDN 图片资源域名
```

---

## 2. 阿里云 OSS 购买建议

已选择配置：

```text
商品类型：OSS 资源包
资源包类型：标准 - 本地冗余存储
地域：中国内地通用
规格：40GB
```

该配置可以支持当前第一阶段需求。

原因：

```text
1. 当前照片体积约 1GB，短期 40GB 足够。
2. 未来如果扩展到 20GB，40GB 仍可先使用。
3. 标准存储适合网页实时访问。
4. 本地冗余比同城冗余便宜，个人照片展示站初期够用。
```

注意：

```text
40GB 存储包只抵扣存储容量费用，不等于 40GB 免费访问流量。
用户浏览图片产生的外网下行流量、CDN 流量、图片处理费用可能另算。
```

---

## 3. 中国大陆访问要求

如果要让 `rsddp.top` 在中国大陆正常稳定访问，需要重点处理：

```text
1. 域名实名认证
2. ICP 备案
3. OSS Bucket 使用中国内地域名
4. 绑定自定义域名，如 img.rsddp.top
5. 配置 HTTPS
6. 如需更快访问，后续接入阿里云 CDN
```

重要规则：

```text
如果网站域名解析到中国内地服务器，通常需要 ICP 备案。
如果 OSS 绑定自定义域名用于访问静态文件，相关域名也需要符合备案要求。
建议使用 img.rsddp.top 作为 OSS 图片域名。
```

---

## 4. OSS Bucket 创建建议

创建 Bucket 时建议：

```text
地域：华东 1 杭州 或 华东 2 上海
存储类型：标准存储
冗余类型：本地冗余
读写权限：公共读，禁止公共写
版本控制：第一阶段可不开
```

推荐 Bucket 用途：

```text
存储照片原图
存储缩略图
存储大图
存储背景图
```

推荐目录结构：

```text
photos/original/     原图
photos/thumb/        缩略图
photos/large/        大图，可选
backgrounds/         背景图
admin-temp/          临时上传，可选
```

示例：

```text
photos/original/2025/kyoto/001.jpg
photos/thumb/2025/kyoto/001.webp
backgrounds/room.webp
```

---

## 5. 权限与安全要求

不要开启公共写。

推荐：

```text
公共读：可以开启，用于网页展示图片
公共写：必须关闭
```

后台上传不能直接暴露阿里云密钥。

禁止这样做：

```text
把 AccessKeyId / AccessKeySecret 写进前端代码
把密钥写进 GitHub 仓库
使用 VITE_ 前缀保存敏感密钥
```

正确做法：

```text
ALIYUN_OSS_ACCESS_KEY_ID
ALIYUN_OSS_ACCESS_KEY_SECRET
ALIYUN_OSS_BUCKET
ALIYUN_OSS_REGION
```

这些变量只放在：

```text
本地 .env.local
Vercel Environment Variables
阿里云服务环境变量
```

如果以后实现后台上传，应采用：

```text
管理员登录
  -> 后端生成 OSS 上传签名
  -> 浏览器直接上传到 OSS
  -> 后端保存照片 URL 和元数据
```

---

## 6. CORS 配置

由于网站和 OSS 不同域，需要配置 CORS。

建议允许来源：

```text
http://localhost:5173
https://rsddp.top
https://www.rsddp.top
https://你的-vercel-项目.vercel.app
```

建议 Methods：

```text
GET
HEAD
PUT
POST
```

建议 Headers：

```text
*
```

说明：

```text
第一阶段如果只展示图片，GET / HEAD 即可。
如果后续做后台上传，需要 PUT / POST。
```

---

## 7. 图片访问与缩略图策略

不要在网页列表中直接加载原图。

推荐三档图片：

```text
thumb：列表页、年份页、地点页使用
large：详情页、全屏预览使用
original：需要下载或查看原图时使用
```

阿里云 OSS 支持图片处理参数和图片样式，可用于：

```text
图片缩放
质量压缩
格式转换
裁剪
WebP / AVIF 转换
```

建议创建图片样式：

```text
thumb：宽度约 400-600px，WebP，适当压缩
large：宽度约 1600-2400px，WebP 或 JPEG，适当压缩
```

示例 URL：

```text
https://img.rsddp.top/photos/original/2025/kyoto/001.jpg?x-oss-process=style/thumb
```

或：

```text
https://img.rsddp.top/photos/original/2025/kyoto/001.jpg?x-oss-process=image/resize,w_600/quality,q_80/format,webp
```

---

## 8. 前端代码需要修改的方向

不要继续从本地路径读取图片：

```ts
src: "/data/uploads/xxx.jpg"
```

应改成 OSS URL：

```ts
src: "https://img.rsddp.top/photos/original/xxx.jpg?x-oss-process=style/thumb"
```

建议集中封装：

```ts
const OSS_BASE_URL = import.meta.env.VITE_OSS_PUBLIC_BASE_URL

export function getOriginalUrl(path: string) {
  return `${OSS_BASE_URL}/${path}`
}

export function getThumbUrl(path: string) {
  return `${OSS_BASE_URL}/${path}?x-oss-process=style/thumb`
}

export function getLargeUrl(path: string) {
  return `${OSS_BASE_URL}/${path}?x-oss-process=style/large`
}
```

前端公开环境变量：

```text
VITE_OSS_PUBLIC_BASE_URL=https://img.rsddp.top
```

注意：

```text
只有公开可见的基础 URL 可以使用 VITE_ 前缀。
阿里云密钥不能使用 VITE_ 前缀。
```

---

## 9. GitHub 仓库清理要求

GitHub 仓库只保留代码，不要保留大量照片。

需要确认 `.gitignore`：

```gitignore
node_modules/
dist/
.env
.env.local
.env.production
.DS_Store

data/uploads/
data/backgrounds/
.fig-extract/
.venv-clip/

vendor/liquid-glass-react/.git/
```

如果图片已经被 Git 追踪，仅写 `.gitignore` 不够，需要执行：

```bash
git rm -r --cached data/uploads
git rm -r --cached data/backgrounds
git commit -m "Remove local image assets from repository"
```

如果历史提交中已经包含大量图片，后续可能需要清理 Git 历史。

---

## 10. 第一阶段推荐实施方案

第一阶段先不做复杂后台上传，优先完成云端展示。

执行顺序：

```text
1. 购买 40GB 标准-本地冗余存储资源包
2. 创建 OSS Bucket
3. 配置 Bucket 权限：公共读、禁止公共写
4. 配置 CORS
5. 上传少量测试图片
6. 确认 OSS 图片 URL 可访问
7. 创建图片样式：thumb / large
8. 修改前端图片路径为 OSS URL
9. 清理 GitHub 仓库中的本地图片
10. 推送代码到 GitHub
11. 部署到 Vercel 或阿里云服务
12. 开始办理 rsddp.top 备案
13. 备案完成后绑定 img.rsddp.top
14. 配置 HTTPS
15. 后续视访问量接入 CDN
```

---

## 11. 第二阶段：后台上传方案

第二阶段再实现真正后台管理。

目标结构：

```text
/admin
  登录后台
  上传照片
  编辑地点、日期、描述
  删除照片
  重新排序

/api/login
/api/oss/sign
/api/photos/create
/api/photos/update
/api/photos/delete
```

上传流程：

```text
管理员登录
  -> 选择图片
  -> 请求 /api/oss/sign
  -> 后端生成 OSS 上传签名
  -> 浏览器直接上传 OSS
  -> 上传完成后保存照片信息
  -> 前端重新读取照片列表
```

照片数据建议字段：

```ts
type Photo = {
  id: string
  title?: string
  location: string
  year: string
  date: string
  objectKey: string
  originalUrl: string
  thumbUrl: string
  largeUrl: string
  width?: number
  height?: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

第一阶段可以先用静态 JSON：

```text
src/data/photos.json
```

第二阶段再迁移到数据库。

---

## 12. 仍需注意的问题

后续需要继续处理：

```text
1. 下行流量费用
2. CDN 加速费用
3. 图片处理费用
4. 数据库选型
5. 后台登录鉴权
6. OSS 防盗链
7. HTTPS 证书
8. robots.txt / noindex
9. EXIF 信息和地理位置隐私
10. 删除照片时同步删除 OSS 文件
11. 本地原图备份
12. 数据备份
13. 移动端性能优化
14. 图片懒加载
15. LiquidGlass 效果低性能设备降级
```

---

## 13. Codex 当前任务建议

请 Codex 优先完成以下任务：

```text
任务 1：检查项目中所有本地图片路径，列出引用位置。
任务 2：新增 OSS URL 工具函数，例如 getThumbUrl / getLargeUrl / getOriginalUrl。
任务 3：将照片数据结构改为 objectKey + OSS URL 生成方式。
任务 4：补充 .env.example，加入 VITE_OSS_PUBLIC_BASE_URL。
任务 5：补充 .gitignore，排除 data/uploads 和其他本地临时目录。
任务 6：避免在列表页加载原图，统一使用 thumb URL。
任务 7：确认 npm run build 可以通过。
任务 8：如果是 React Router SPA，检查是否需要 vercel.json rewrite。
```

示例 `.env.example`：

```env
VITE_OSS_PUBLIC_BASE_URL=https://img.rsddp.top
```

示例 `vercel.json`：

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

如果项目中已有 API 路由，需要避免把 API 路由错误重写到 `index.html`。
