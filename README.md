# Personal Photo Gallery

一个用于展示个人旅行与生活照片的网页项目。网站以 **Years → Locations → Photos** 的三层结构组织照片，前台提供具有液态玻璃视觉效果的照片浏览体验，后台提供照片上传、信息修改、相册重排、背景管理等能力。使用阿里云 OSS 存储照片资源。

---

## 1. 项目简介

本项目的目标是搭建一个可本地运行、可云端部署的个人照片展示网站，用于按照年份、地点和照片层级浏览个人照片。

核心目标包括：

- 前台按年份、地点、照片三层结构展示照片；
- 照片墙不显示文件名，重点突出照片本身；
- 支持照片全屏查看、上一张 / 下一张切换；
- 支持后台登录、上传照片、修改照片信息、删除照片；
- 支持批量导入照片，并根据文件名自动解析地点和日期；
- 支持 CLIP + TSP 智能排序，使同一相册内照片的视觉过渡更自然；
- 支持背景图片轮播、背景切换、背景管理；
- 后续支持通过阿里云 OSS 存储照片、缩略图、大图和背景图；
- 前台隐藏后台入口，后台通过 `/admin` 路径访问。

---

## 2. 功能概览

### 2.1 前台展示

#### Years 页面

- 展示所有存在照片的年份；
- 隐藏无照片的年份；
- 年份按时间顺序排列；
- 年份按钮位于液态玻璃容器中；
- 液态玻璃容器根据年份数量自适应高度；
- Years 页面不显示返回按钮，但保留背景切换按钮。

#### Locations 页面

- 点击年份后进入该年份下的地点页面；
- 地点为单一文本，例如“香港”“京都”“山东”；
- 地点按照该地点下照片的时间排序；
- 时间显示为“月日”格式；
- 支持返回 Years 页面。

#### Photos 页面

- 点击地点后进入照片墙；
- 照片不显示文件名；
- 照片区域尽量紧凑排列，减少无效留白；
- 支持竖屏照片完整显示；
- 支持透明滚动条；
- 支持点击照片进入全屏预览；
- 支持按照 CLIP + TSP 智能排序结果展示照片；
- 如果没有智能排序结果，则按时间顺序展示。

#### 全屏查看

- 点击照片后在当前页面打开全屏查看层；
- 图片居中显示，并保持原始比例；
- 支持上一张 / 下一张切换；
- 支持关闭后回到当前 Photos 页面；
- 切换照片时不刷新页面。

---

### 2.2 后台管理

后台通过固定隐藏路径 `/admin` 访问，前台不展示 Admin 入口。

#### 后台首页

- 后台登录后进入管理首页；
- 管理操作通过按钮触发；
- 点击一个管理模块时，只显示当前模块；
- 再点击其他模块时，自动关闭当前模块；
- 管理入口按钮带有点击反馈效果。

#### 添加照片

- 支持选择单张或多张照片；
- 多张照片选择后，显示第一张照片名称和总数量；
- 支持展开查看全部已选择文件名；
- 支持根据文件名自动解析地点和日期；
- 支持点击“解析日期地点”按钮后自动填充字段；
- 文件名格式要求：

```text
序号_地点_日期
```

示例：

```text
1_香港_20260418.JPG
```

解析规则：

```text
第一个下划线之前：序号
第一个下划线与第二个下划线之间：地点
第二个下划线之后：日期
日期格式：yyyyMMdd
```

#### 修改照片信息

- 支持通过三级菜单选择照片：

```text
Years → Locations → Photos
```

- 支持修改照片时间；
- 支持修改照片地点；
- 支持在设置框中显示当前选中照片的缩略图；
- 缩略图会根据照片比例自适应缩放；
- 支持批量修改某一年某一地点下所有照片的地点名称；
- 修改后前台 Years、Locations、Photos 页面自动更新。

#### 删除照片

- 仅后台支持删除照片；
- 删除前需要二次确认；
- 删除后对应照片不再在前台展示；
- 如果某个地点或年份下已无照片，前台自动隐藏对应地点或年份。

#### 相册重新排列

- 支持选择“时间-地点”对应的相册；
- 点击“重新排列相册”后，对该相册内照片重新排序；
- 支持“重新排列全部相册”；
- 全部重排操作需要二次确认；
- 下拉菜单按时间顺序排列。

#### 背景管理

- 支持后台进入“修改背景”模块；
- 支持批量上传背景图片；
- 支持调整背景播放顺序；
- 支持设置背景播放间隔：

```text
3 分钟
5 分钟
10 分钟
```

- 支持手动切换下一张背景；
- 支持删除背景图片；
- 删除背景前需要二次确认；
- 支持调整前台黑色遮罩透明度；
- 背景采用裁切方案铺满全屏，以适应不同显示器比例。

---

## 3. 智能排序说明

Photos 层级支持基于 **CLIP + TSP** 的智能排序。

排序目标是让同一地点相册中的照片在视觉上过渡更自然。

基本逻辑：

```text
读取目标相册照片
  → 使用 CLIP 模型提取图片视觉特征
  → 计算照片之间的视觉距离
  → 使用 TSP 算法寻找较优排列路径
  → 保存排序结果
  → 前台 Photos 页面按排序结果展示
```

注意事项：

- 智能排序应在后台触发；
- 排序任务应异步执行，避免阻塞页面；
- 如果照片数量过少，可以不执行排序；
- 如果排序失败，前台仍应按时间顺序展示照片；
- 如果相册新增或修改照片，该相册应标记为需要重新排序。

---

## 4. 图片与数据结构

### 4.1 本地阶段

当前阶段可先使用本地目录保存图片。

建议结构：

```text
data/
  uploads/
    photos/
      2026/
        香港/
          1_香港_20260418.JPG
  backgrounds/
    background-001.jpg
```

照片元数据建议结构：

```json
{
  "id": "photo_001",
  "filename": "1_香港_20260418.JPG",
  "path": "/uploads/photos/2026/香港/photo_001.jpg",
  "date": "2026-04-18",
  "year": "2026",
  "location": "香港",
  "sortIndex": 1,
  "createdAt": "2026-05-19T09:00:00"
}
```

### 4.2 OSS 阶段

云端部署阶段建议使用阿里云 OSS 存储图片资源。

推荐结构：

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

建议三档图片访问策略：

```text
thumb      年份页、地点页、照片列表页使用
large      全屏预览使用
original   原图查看或备份使用
```

---

## 5. 阿里云 OSS 部署规划

### 5.1 推荐资源配置

当前第一阶段建议使用：

```text
商品类型：OSS 资源包
资源包类型：标准 - 本地冗余存储
地域：中国内地通用
规格：40GB
```

该配置适合当前个人照片展示站的初期需求。

注意：

```text
40GB 存储包主要抵扣存储容量费用。
图片被访问时产生的外网下行流量、CDN 流量、图片处理费用可能另算。
```

### 5.2 推荐域名规划

```text
rsddp.top        主站
www.rsddp.top    主站别名
img.rsddp.top    OSS / CDN 图片资源域名
```

如果希望在中国大陆稳定访问，需要关注：

```text
域名实名认证
ICP备案
OSS Bucket 中国内地域名
自定义域名绑定
HTTPS 配置
CDN 加速
```

### 5.3 Bucket 建议

```text
地域：华东 1 杭州 或 华东 2 上海
存储类型：标准存储
冗余类型：本地冗余
读写权限：公共读，禁止公共写
版本控制：第一阶段可不开
```

权限建议：

```text
公共读：可以开启，用于网页展示图片
公共写：必须关闭
```

---

## 6. 环境变量

前端只允许保存公开访问地址，不允许保存阿里云密钥。

`.env.example` 示例：

```env
VITE_OSS_PUBLIC_BASE_URL=https://img.rsddp.top
```

前端可封装图片 URL 工具函数：

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

严禁将以下内容写入前端代码、GitHub 仓库或任何 `VITE_` 环境变量：

```text
ALIYUN_OSS_ACCESS_KEY_ID
ALIYUN_OSS_ACCESS_KEY_SECRET
ALIYUN_OSS_BUCKET
ALIYUN_OSS_REGION
```

这些敏感变量只能放在：

```text
本地 .env.local
Vercel Environment Variables
阿里云服务环境变量
后端服务环境变量
```

---

## 7. 本地运行

本项目为前端照片展示项目，通常可按 Vite / React 项目方式运行。

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

本地预览构建结果：

```bash
npm run preview
```

说明：

```text
本地预览时应优先从本地加载图片，避免直接消耗 OSS 外网流量。
```

---

## 8. GitHub 仓库管理

GitHub 仓库建议只保存代码，不保存大量照片资源。

`.gitignore` 建议包含：

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

如果图片已经被 Git 追踪，仅修改 `.gitignore` 不够，需要执行：

```bash
git rm -r --cached data/uploads
git rm -r --cached data/backgrounds
git commit -m "Remove local image assets from repository"
```

---

## 9. Vercel 部署

如果使用 Vercel 部署前端项目，常见流程如下：

```text
1. 将代码推送到 GitHub
2. 在 Vercel 导入 GitHub 仓库
3. 配置环境变量
4. 执行 npm run build
5. 部署 dist 目录
```

如果项目使用 React Router 等前端路由，需要配置 SPA rewrite，避免刷新页面后 404。

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


---


## 10. 已完成的重要更新

### 前台展示

- 修复 Years 层级年份排序；
- 修复 Location 层级日期格式错误；
- 修复 Photo 层级竖屏照片显示不完整；
- 修复返回按钮位置与层级问题；
- 修复底部菜单位置、字体大小和液态玻璃透视效果；
- 优化 Photo 层级照片展示区域；
- 增加背景轮播与背景切换；
- 优化 Years 层级液态玻璃容器自适应。

### 后台管理

- 增加批量导入照片；
- 增加文件名解析地点和日期；
- 增加“解析日期地点”按钮；
- 增加三级菜单选择照片；
- 增加照片缩略图预览；
- 增加重新排列相册和重新排列全部相册；
- 增加背景管理；
- 增加背景删除、顺序调整、播放间隔设置；
- 增加背景遮罩透明度调整；
- 增加批量修改地点。



完整更新记录见：

```text
CHANGELOG.md
```

