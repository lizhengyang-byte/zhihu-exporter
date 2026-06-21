# 知乎收藏夹批量导出

一个油猴（Tampermonkey）脚本，用于将知乎收藏夹内容导出为 Markdown 文件，方便本地存档或在 Obsidian 等工具中阅读。

## 功能

- 在 `zhihu.com/collection/*` 页面将整个收藏夹导出为 Markdown
- 支持 **合并导出**：所有内容写入一个 `.md` 文件
- 支持 **分别保存**：每篇文章一个独立 `.md` 文件，保存到系统文件夹（需 Chromium 内核浏览器）
- 并发写入控制（1–16），加快分别保存时的写入速度
- 实时进度显示
- 自动补全正文（通过知乎 API）
- 支持视频、图文等混合内容
- HTML → Markdown 转换，保留图片、粗体、列表、引用等格式

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.org/) 浏览器扩展
2. [点此安装脚本](https://github.com/lizhengyang-byte/zhihu-exporter/raw/main/main.js)（或打开管理面板 → 新建脚本 → 粘贴 `main.js` 全部内容）
3. 打开知乎收藏夹页面（`zhihu.com/collection/*`），右上角会出现浮动按钮

## 使用

1. 打开任意知乎收藏夹页面（如 `zhihu.com/collection/123456789`）
2. 点击页面右上角「导出为 Markdown」按钮
3. 如需每篇文章单独保存，勾选「分别保存」（会弹出文件夹选择器）
4. 调节并发数以控制写入速度
5. 等待导出完成

## 输出格式

### 合并文件

所有内容依次写入一个 `.md` 文件，包含标题、原文链接和正文。

### 独立文件

每篇文章一个 `.md` 文件，文件名格式为 `序号_标题.md`：

```
01_文章标题.md
02_文章标题.md
```

## 技术细节

- 使用知乎公开 REST API `/api/v4/collections/{id}/items`
- 纯前端实现，无外部服务依赖
- 分别保存模式使用 File System Access API（`showDirectoryPicker`），仅 Chromium 内核浏览器支持
- 合并模式通过 Blob + `a.click()` 触发下载

## License

MIT
