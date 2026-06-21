// ==UserScript==

// @name         知乎收藏夹导出升级版1.0

// @namespace    https://github.com/miao

// @version      1.5.2

// @description  将知乎收藏夹导出为MarkDown文档，带有导出进度显示

// @author       miao

// @license      MIT

// @match        https://www.zhihu.com/collection/*

// @icon         data:image/gif;base64,R_o0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==

// @grant        GM_download

// @downloadURL https://update.greasyfork.org/scripts/551983/%E7%9F%A5%E4%B9%8E%E6%94%B6%E8%97%8F%E5%A4%B9%E5%AF%BC%E5%87%BA.user.js

// @updateURL https://update.greasyfork.org/scripts/551983/%E7%9F%A5%E4%B9%8E%E6%94%B6%E8%97%8F%E5%A4%B9%E5%AF%BC%E5%87%BA.meta.js

// ==/UserScript==

  

(function() {

    'use strict';

  

    const myCollectionExport = {

        ui: {

            controlPanel: null,

            exportButton: null,

            separateSaveCheckbox: null,

            writeConcurrencyInput: null,

            progressContainer: null,

            progressBar: null,

            progressText: null

        },

        markdownScratchEl: null,

        minWriteConcurrency: 1,

        maxWriteConcurrencyLimit: 16,

        maxWriteConcurrency: 4,

        progressUpdateThrottleMs: 80,

        lastProgressUpdateAt: 0,

        lastProgressText: '',

        lastProgressWidth: '',

  

        init: function() {

            this.createUI();

            this.markdownScratchEl = document.createElement('div');

            this.ui.exportButton.onclick = () => this.startExport();

        },

  

        createUI: function() {

            const controlPanel = document.createElement('div');

            Object.assign(controlPanel.style, {

                position: 'fixed',

                top: '60px',

                right: '10px',

                zIndex: '1001',

                width: '220px',

                backgroundColor: '#fff',

                borderRadius: '8px',

                padding: '10px',

                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'

            });

  

            const exportButton = document.createElement('button');

            exportButton.textContent = '导出为Markdown';

            Object.assign(exportButton.style, {

                width: '100%',

                padding: '10px 15px',

                backgroundColor: '#0077FF', // 知乎蓝

                color: 'white',

                border: 'none',

                borderRadius: '5px',

                cursor: 'pointer',

                fontSize: '14px',

                boxShadow: '0 2px 5px rgba(0,0,0,0.2)'

            });

            controlPanel.appendChild(exportButton);

            this.ui.exportButton = exportButton;

  

            const separateSaveLabel = document.createElement('label');

            Object.assign(separateSaveLabel.style, {

                display: 'flex',

                alignItems: 'center',

                marginTop: '10px',

                fontSize: '13px',

                color: '#333',

                cursor: 'pointer',

                userSelect: 'none'

            });

  

            const separateSaveCheckbox = document.createElement('input');

            separateSaveCheckbox.type = 'checkbox';

            separateSaveCheckbox.style.marginRight = '8px';

            separateSaveLabel.appendChild(separateSaveCheckbox);

            separateSaveLabel.appendChild(document.createTextNode('分别保存（每篇文章一个 Markdown，保存到文件夹）'));

            controlPanel.appendChild(separateSaveLabel);

  

            const concurrencyRow = document.createElement('div');

            Object.assign(concurrencyRow.style, {

                display: 'flex',

                alignItems: 'center',

                justifyContent: 'space-between',

                marginTop: '8px',

                fontSize: '12px',

                color: '#333'

            });

            const concurrencyLabel = document.createElement('span');

            concurrencyLabel.textContent = `并发数 (${this.minWriteConcurrency}-${this.maxWriteConcurrencyLimit})`;

            const writeConcurrencyInput = document.createElement('input');

            writeConcurrencyInput.type = 'number';

            writeConcurrencyInput.min = String(this.minWriteConcurrency);

            writeConcurrencyInput.max = String(this.maxWriteConcurrencyLimit);

            writeConcurrencyInput.step = '1';

            writeConcurrencyInput.value = String(this.maxWriteConcurrency);

            Object.assign(writeConcurrencyInput.style, {

                width: '64px',

                padding: '2px 4px',

                border: '1px solid #d9d9d9',

                borderRadius: '4px',

                fontSize: '12px'

            });

            writeConcurrencyInput.addEventListener('change', () => {

                const normalized = this.normalizeWriteConcurrency(writeConcurrencyInput.value);

                writeConcurrencyInput.value = String(normalized);

                this.maxWriteConcurrency = normalized;

            });

            concurrencyRow.appendChild(concurrencyLabel);

            concurrencyRow.appendChild(writeConcurrencyInput);

            controlPanel.appendChild(concurrencyRow);

  

            document.body.appendChild(controlPanel);

            this.ui.controlPanel = controlPanel;

            this.ui.separateSaveCheckbox = separateSaveCheckbox;

            this.ui.writeConcurrencyInput = writeConcurrencyInput;

  

            const progressContainer = document.createElement('div');

            Object.assign(progressContainer.style, {

                position: 'fixed', top: '190px', right: '10px', zIndex: '1000', width: '220px',

                backgroundColor: '#f0f0f0', borderRadius: '5px', padding: '10px',

                boxShadow: '0 2px 5px rgba(0,0,0,0.2)', display: 'none'

            });

            const progressBar = document.createElement('div');

            Object.assign(progressBar.style, {

                width: '0%', height: '10px', backgroundColor: '#2cbe60', borderRadius: '3px',

                transition: 'width 0.2s ease-in-out'

            });

            const progressText = document.createElement('span');

            progressText.textContent = '准备中...';

            Object.assign(progressText.style, {

                display: 'block', marginTop: '5px', fontSize: '12px', color: '#333', textAlign: 'center'

            });

            progressContainer.appendChild(progressBar);

            progressContainer.appendChild(progressText);

            document.body.appendChild(progressContainer);

            this.ui.progressContainer = progressContainer;

            this.ui.progressBar = progressBar;

            this.ui.progressText = progressText;

        },

  

        setProgress: function(percentage, text) {

            const safePercentage = Math.min(Math.max(Number(percentage) || 0, 0), 100);

            const widthText = `${safePercentage.toFixed(2)}%`;

            if (widthText !== this.lastProgressWidth) {

                this.ui.progressBar.style.width = widthText;

                this.lastProgressWidth = widthText;

            }

            if (text !== this.lastProgressText) {

                this.ui.progressText.textContent = text;

                this.lastProgressText = text;

            }

        },

  

        updateProgress: function(processed, total, force = false) {

            if (total === 0) return;

            const now = Date.now();

            const shouldThrottle = !force && processed < total && (now - this.lastProgressUpdateAt < this.progressUpdateThrottleMs);

            if (shouldThrottle) return;

            this.lastProgressUpdateAt = now;

            const percentage = Math.min((processed / total) * 100, 100);

            this.setProgress(percentage, `正在导出: ${processed} / ${total} (${percentage.toFixed(2)}%)`);

        },

  

        normalizeWriteConcurrency: function(value) {

            const parsed = Number.parseInt(value, 10);

            if (Number.isNaN(parsed)) return this.maxWriteConcurrency;

            return Math.min(this.maxWriteConcurrencyLimit, Math.max(this.minWriteConcurrency, parsed));

        },

  

        getWriteConcurrency: function() {

            if (!this.ui.writeConcurrencyInput) return this.maxWriteConcurrency;

            const normalized = this.normalizeWriteConcurrency(this.ui.writeConcurrencyInput.value);

            this.maxWriteConcurrency = normalized;

            this.ui.writeConcurrencyInput.value = String(normalized);

            return normalized;

        },

  

        getDirectoryPicker: function() {

            if (typeof window.showDirectoryPicker === 'function') {

                return window.showDirectoryPicker.bind(window);

            }

            if (typeof unsafeWindow !== 'undefined' && unsafeWindow && typeof unsafeWindow.showDirectoryPicker === 'function') {

                return unsafeWindow.showDirectoryPicker.bind(unsafeWindow);

            }

            return null;

        },

  

        prepareFolderTarget: async function(folderName) {

            const picker = this.getDirectoryPicker();

            if (!picker) {

                throw new Error('当前浏览器不支持文件夹写入，请使用 Chromium 内核浏览器');

            }

            const rootDirHandle = await picker({ mode: 'readwrite' });

            const safeFolderName = this.sanitizeFileName(folderName, 60);

            const collectionDirHandle = await rootDirHandle.getDirectoryHandle(safeFolderName, { create: true });

            if (typeof collectionDirHandle.requestPermission === 'function') {

                const permission = await collectionDirHandle.requestPermission({ mode: 'readwrite' });

                if (permission !== 'granted') {

                    throw new Error('没有文件夹写入权限');

                }

            }

            return {

                folderName: safeFolderName,

                dirHandle: collectionDirHandle

            };

        },

  

        writeMarkdownFile: async function(dirHandle, fileName, content) {

            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });

            const writable = await fileHandle.createWritable();

            await writable.write(content);

            await writable.close();

        },

  

        runTasksWithConcurrency: async function(taskFactories, maxConcurrency, onTaskDone) {

            if (!taskFactories || taskFactories.length === 0) return;

            const workerCount = Math.max(1, Math.min(maxConcurrency, taskFactories.length));

            let cursor = 0;

  

            const worker = async () => {

                while (true) {

                    const taskIndex = cursor;

                    cursor += 1;

                    if (taskIndex >= taskFactories.length) return;

                    await taskFactories[taskIndex]();

                    if (typeof onTaskDone === 'function') {

                        onTaskDone();

                    }

                }

            };

  

            const workers = [];

            for (let i = 0; i < workerCount; i += 1) {

                workers.push(worker());

            }

            await Promise.all(workers);

        },

  

        startExport: async function() {

            this.ui.exportButton.disabled = true;

            this.ui.exportButton.style.opacity = '0.6';

            this.ui.exportButton.style.cursor = 'not-allowed';

            this.ui.separateSaveCheckbox.disabled = true;

            this.ui.writeConcurrencyInput.disabled = true;

            const saveSeparately = Boolean(this.ui.separateSaveCheckbox.checked);

            const writeConcurrency = this.getWriteConcurrency();

            this.lastProgressUpdateAt = 0;

            this.lastProgressText = '';

            this.lastProgressWidth = '';

            this.ui.progressContainer.style.display = 'block';

            this.updateProgress(0, 1);

            this.ui.progressText.textContent = '正在获取收藏夹信息...';

  

            try {

                const pathname = location.pathname;

                const matched = pathname.match(/(?<=\/collection\/)\d+/);

                const collectionId = matched ? matched[0] : "";

                if (!collectionId) throw new Error("无法获取收藏夹ID");

  

                const collectionTitleElement = document.querySelector('.CollectionDetailPageHeader-title');

                let collectionTitle = collectionTitleElement ? collectionTitleElement.innerText.trim() : '知乎收藏夹';

                collectionTitle = collectionTitle.replace(/[\s\r\n]+/g, ' ').replace(/生成PDF.*/, '').trim();

                const safeTitle = this.sanitizeFileName(collectionTitle, 80);

                const folderTarget = saveSeparately ? await this.prepareFolderTarget(safeTitle) : null;

  

                const initialResponse = await fetch(`/api/v4/collections/${collectionId}/items?offset=0&limit=1`);

                if (!initialResponse.ok) throw new Error(`API请求失败: ${initialResponse.status}`);

                const initialData = await initialResponse.json();

                const totalItems = initialData.paging.totals;

  

                if (totalItems === 0) {

                    this.ui.progressText.textContent = '收藏夹为空，无需导出。';

                    this.resetUI(3000);

                    return;

                }

  

                let collectionsMarkdown = [];

                let itemsProcessed = 0;

                const limit = 20;

                const serialWidth = String(totalItems).length;

  

                for (let offset = 0; offset < totalItems; offset += limit) {

                    const response = await fetch(`/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${limit}`);

                     if (!response.ok) {

                        console.warn(`在 offset ${offset} 请求失败, 状态: ${response.status}。可能会跳过此页。`);

                        continue;

                    }

                    const res = await response.json();

                    if (!res.data || res.data.length === 0) break;

  

                    if (saveSeparately) {

                        const pageStartIndex = itemsProcessed;

                        const writeTasks = [];

                        for (let index = 0; index < res.data.length; index += 1) {

                            const itemData = this.buildMarkdownFromItem(res.data[index]);

                            const serial = String(pageStartIndex + index + 1).padStart(serialWidth, '0');

                            const itemTitle = this.sanitizeFileName(itemData.title, 80);

                            const fileName = `${serial}_${itemTitle}.md`;

                            const markdownContent = itemData.markdown;

                            writeTasks.push(() => this.writeMarkdownFile(folderTarget.dirHandle, fileName, markdownContent));

                        }

                        await this.runTasksWithConcurrency(writeTasks, writeConcurrency, () => {

                            itemsProcessed += 1;

                            this.updateProgress(itemsProcessed, totalItems);

                        });

                    } else {

                        for (let index = 0; index < res.data.length; index += 1) {

                            const itemData = this.buildMarkdownFromItem(res.data[index]);

                            collectionsMarkdown.push(itemData.markdown);

                        }

                        itemsProcessed += res.data.length;

                        this.updateProgress(itemsProcessed, totalItems);

                    }

                }

  

                if (itemsProcessed === 0) {

                    throw new Error('未抓取到可导出的内容');

                }

                this.updateProgress(itemsProcessed, totalItems, true);

  

                if (saveSeparately) {

                    this.setProgress(100, `导出完成: ${itemsProcessed} / ${itemsProcessed} (100.00%)`);

                    this.ui.progressText.textContent = `导出完成，已保存到文件夹：${folderTarget.folderName}`;

                } else {

                    this.ui.progressText.textContent = '导出完成，正在生成文件...';

                    const markdownContent = collectionsMarkdown.join("\n---\n\n");

                    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });

                    const url = URL.createObjectURL(blob);

                    const fileName = `${safeTitle}_${itemsProcessed}个内容.md`;

                    this.downloadFile(url, fileName);

                }

  

            } catch (error) {

                console.error('导出过程中发生严重错误:', error);

                if (error && error.name === 'AbortError') {

                    this.ui.progressText.textContent = '已取消选择文件夹。';

                } else {

                    this.ui.progressText.textContent = `导出失败: ${error.message}`;

                }

            } finally {

                this.resetUI(5000);

            }

        },

  

        // --- 核心修复：优先使用 a.click() 下载 ---

        downloadFile: function(url, fileName) {

            console.log(`准备下载文件: ${fileName}`);

            this.ui.progressText.textContent = `准备下载: ${fileName}`;

  

            try {

                console.log('尝试使用兼容模式 (a.click) 进行下载...');

                const a = document.createElement('a');

                a.href = url;

                a.download = fileName;

                document.body.appendChild(a);

                a.click();

                document.body.removeChild(a);

                this.ui.progressText.textContent = `下载已发起!`;

            } catch (e) {

                console.error(`兼容模式下载失败: ${e.message}.`);

                this.ui.progressText.textContent = '下载失败，请检查控制台！';

            } finally {

                // 无论成功与否，都延迟释放URL，确保下载有时间启动

                setTimeout(() => {

                    URL.revokeObjectURL(url);

                    console.log(`Blob URL for ${fileName} has been revoked.`);

                }, 5000);

            }

        },

  

        resetUI: function(delay = 0) {

            setTimeout(() => {

                this.ui.progressContainer.style.display = 'none';

                this.ui.exportButton.disabled = false;

                this.ui.exportButton.style.opacity = '1';

                this.ui.exportButton.style.cursor = 'pointer';

                this.ui.separateSaveCheckbox.disabled = false;

                this.ui.writeConcurrencyInput.disabled = false;

            }, delay);

        },

  

        buildMarkdownFromItem: function(item) {

            try {

                const contentData = item && item.content ? item.content : {};

                const { type, url, question, content, title } = contentData;

                const safeUrl = url || '#';

                const itemTitle = (title || (question ? question.title : '无标题')).trim() || '无标题';

                if (type === 'zvideo') {

                    return {

                        title: `视频_${itemTitle}`,

                        markdown: `# 视频：${itemTitle}\n[视频链接](${safeUrl})\n`

                    };

                }

                return {

                    title: itemTitle,

                    markdown: `# ${itemTitle}\n[原文链接](${safeUrl})\n\n${this.convertHtmlToMarkdown(content)}\n`

                };

            } catch (e) {

                const fallbackItem = item && item.content ? item.content : {};

                const fallbackTitle = fallbackItem.title || '无标题';

                const fallbackUrl = fallbackItem.url || '未知链接';

                console.error(`处理项目失败: ${fallbackUrl}`, e);

                return {

                    title: `[处理失败] ${fallbackTitle}`,

                    markdown: `# [处理失败] ${fallbackTitle}\n原文链接: ${fallbackUrl}\n\n错误信息: ${e.message}\n`

                };

            }

        },

  

        sanitizeFileName: function(name, maxLength = 80) {

            const safeName = String(name || '未命名')

                .replace(/[\s\r\n]+/g, ' ')

                .replace(/[\\/:*?"<>|]/g, '_')

                .replace(/[. ]+$/g, '')

                .trim();

            if (!safeName) return '未命名';

            return safeName.slice(0, maxLength);

        },

  

        convertHtmlToMarkdown: function(html) {

            if (!html) return '';

            const tempDiv = this.markdownScratchEl || document.createElement('div');

            tempDiv.innerHTML = html;

            function parseNode(node) {

                if (node.nodeType === Node.TEXT_NODE) return node.textContent;

                if (node.nodeType !== Node.ELEMENT_NODE) return '';

                let content = '';

                for (let i = 0; i < node.childNodes.length; i += 1) {

                    content += parseNode(node.childNodes[i]);

                }

                const tag = node.tagName.toLowerCase();

                switch (tag) {

                    case 'p': return content.trim() ? content + '\n\n' : '';

                    case 'img':

                        const src = node.getAttribute('data-original') || node.getAttribute('data-actualsrc') || node.src;

                        const fullSrc = src.startsWith('//') ? `https:${src}` : src;

                        return `![图片](${fullSrc})\n\n`;

                    case 'b': case 'strong': return `**${content}**`;

                    case 'i': case 'em': return `*${content}*`;

                    case 'blockquote': return `> ${content.replace(/\n/g, '\n> ')}\n\n`;

                    case 'a': return `[${content}](${node.href})`;

                    case 'ul': return content + '\n';

                    case 'ol':

                        {

                            let listContent = '';

                            for (let i = 0; i < node.children.length; i += 1) {

                                if (i > 0) listContent += '\n';

                                listContent += `${i + 1}. ${parseNode(node.children[i]).trim()}`;

                            }

                            return listContent + '\n\n';

                        }

                    case 'li': return `* ${content.trim()}\n`;

                    case 'h1': return `# ${content}\n\n`;

                    case 'h2': return `## ${content}\n\n`;

                    case 'h3': return `### ${content}\n\n`;

                    case 'h4': return `#### ${content}\n\n`;

                    case 'figure':

                        return content;

                    case 'br': return '\n';

                    case 'hr': return '---\n\n';

                    default: return content;

                }

            }

            let markdown = parseNode(tempDiv).trim();

            tempDiv.innerHTML = '';

            return markdown.replace(/\n{3,}/g, '\n\n');

        }

    };

  

    myCollectionExport.init();

  

})();
