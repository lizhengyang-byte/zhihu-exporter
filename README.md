# 知乎内容批量导出工具

一个油猴（Tampermonkey）脚本，用于将知乎内容导出为 Markdown 文件，方便本地存档或在 Obsidian 等工具中阅读。

一体化设计，Tab 切换三种导出模式，无冲突。

## 功能

### 📦 答主内容导出
在用户主页将答主的**回答**、**文章**、**想法**导出为一个合集 Markdown 文件。

### 📋 问题回答导出
在问题页面将该问题下的**所有回答**导出为一个合集 Markdown 文件，支持按热度或时间排序。

### 📚 收藏夹批量导出
在用户主页将**收藏夹**中的文章批量导出，每篇文章保存为独立的 Markdown 文件，支持：
- 勾选指定收藏夹或一键导出全部
- 平铺输出或按收藏夹名分类前缀
- 打包为 ZIP 下载（仅一个文件，速度最快）或逐个文件下载
- 自动补全文章正文（通过知乎 API）
- 自动处理文件名冲突和非法字符

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [点此安装脚本](https://github.com/lizhengyang-byte/zhihu-exporter/raw/main/main.js)（或打开管理面板 → 新建脚本 → 粘贴 `main.js` 全部内容）
3. 打开知乎相关页面，右上角会出现浮动按钮

## 使用

| 页面 | 可用功能 |
|------|---------|
| `zhihu.com/people/*` | Tab「答主内容」+ Tab「收藏夹」 |
| `zhihu.com/question/*` | 问题回答导出 |

1. 点击页面右上角 📦 按钮打开面板
2. 选择功能 Tab，勾选要导出的内容
3. 设置链接风格（Obsidian / 通用 Markdown）
4. 点击「开始导出」，等待完成

## 输出格式

### 合集文件（答主/问题导出）

每个合集文件包含 Frontmatter、目录、正文，格式对 Obsidian 友好。

### 独立文件（收藏夹导出）

每篇文章一个 `.md` 文件，含 Frontmatter 元信息：

```yaml
---
title: "文章标题"
author: "作者"
source: "原文链接"
collection: "所属收藏夹"
export_date: "导出时间"
created: "创建日期"
votes: 123
comments: 45
tags:
  - 知乎导出
  - 收藏夹名称
---
```

## 输出格式

- 使用知乎开放 REST API，无需外部依赖（JSZip 通过 CDN 加载）
- HTML → Markdown 转换，保留图片、代码块、表格等格式
- 支持的链接风格：Obsidian `[[wikilinks]]` 或标准 Markdown

## License

MIT
