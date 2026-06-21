// ==UserScript==
// @name         知乎收藏夹批量导出
// @namespace    https://github.com/heritager/zhihu-exporter
// @version      1.0.0
// @description  批量导出知乎收藏夹内容为独立Markdown文件，支持选择收藏夹/全部导出/按文件夹分类/并行下载
// @author       ZhihuExporter
// @license      MIT
// @match        https://www.zhihu.com/people/*
// @icon         https://static.zhihu.com/heifetz/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ======================== 配置 ========================
    const CONFIG = {
        apiDelay: 350,          // API 请求间隔 (ms)
        apiConcurrency: 3,      // 并发 API 请求数
        linkStyle: 'obsidian',  // 'obsidian' | 'standard'
        addFrontmatter: true,
    };

    // ======================== 主对象 ========================
    const FavoritesExporter = {
        urlToken: null,
        collections: [],
        aborted: false,
        ui: {},
        stats: { total: 0, success: 0, fail: 0 },

        // ==================== 初始化 ====================
        init: function() {
            const m = location.pathname.match(/\/people\/([^\/]+)/);
            if (!m) return;
            this.urlToken = m[1];
            this.createUI();
        },

        // ==================== UI ====================
        createUI: function() {
            const panel = document.createElement('div');
            panel.id = 'zhihu-fav-export-panel';
            Object.assign(panel.style, {
                position: 'fixed', top: '70px', right: '20px', zIndex: '10000',
                width: '380px', maxHeight: '90vh', overflowY: 'auto',
                backgroundColor: '#fff', borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                border: '1px solid #e8e8e8'
            });

            // ---- 头部 ----
            const header = document.createElement('div');
            Object.assign(header.style, {
                background: 'linear-gradient(135deg, #E67E22 0%, #F39C12 100%)',
                padding: '16px 20px', color: 'white', position: 'relative'
            });
            header.innerHTML =
                '<div style="font-size:16px;font-weight:600;">📚 收藏夹批量导出</div>' +
                '<div style="font-size:12px;opacity:0.85;margin-top:4px;">导出收藏夹内容为独立 Markdown 文件</div>';

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            Object.assign(closeBtn.style, {
                position: 'absolute', top: '12px', right: '12px',
                background: 'rgba(255,255,255,0.3)', border: 'none', color: 'white',
                fontSize: '18px', cursor: 'pointer', width: '24px', height: '24px',
                borderRadius: '50%', lineHeight: '22px', textAlign: 'center', padding: '0'
            });
            header.appendChild(closeBtn);
            panel.appendChild(header);

            // ---- 内容区 ----
            const body = document.createElement('div');
            body.id = 'zhihu-fav-body';

            // 加载状态
            const loadingDiv = document.createElement('div');
            loadingDiv.id = 'zhihu-fav-loading';
            Object.assign(loadingDiv.style, { padding: '30px 20px', textAlign: 'center', color: '#999', fontSize: '14px' });
            loadingDiv.textContent = '正在加载收藏夹列表...';
            body.appendChild(loadingDiv);
            panel.appendChild(body);

            // ---- 按钮区 ----
            const btnDiv = document.createElement('div');
            Object.assign(btnDiv.style, { padding: '12px 20px 16px', display: 'none' });
            btnDiv.id = 'zhihu-fav-btns';

            const exportBtn = document.createElement('button');
            exportBtn.id = 'zhihu-fav-export-btn';
            exportBtn.textContent = '🚀 开始导出';
            Object.assign(exportBtn.style, {
                width: '100%', padding: '10px', backgroundColor: '#E67E22', color: '#fff',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
                cursor: 'pointer', transition: 'all 0.2s'
            });
            exportBtn.onmouseenter = () => { if (!exportBtn.disabled) exportBtn.style.backgroundColor = '#D35400'; };
            exportBtn.onmouseleave = () => { if (!exportBtn.disabled) exportBtn.style.backgroundColor = '#E67E22'; };
            exportBtn.onclick = () => this.startExport();
            btnDiv.appendChild(exportBtn);

            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'zhihu-fav-cancel-btn';
            cancelBtn.textContent = '取消';
            Object.assign(cancelBtn.style, {
                width: '100%', padding: '8px', backgroundColor: 'transparent', color: '#999',
                border: '1px solid #e8e8e8', borderRadius: '8px', fontSize: '13px',
                cursor: 'pointer', marginTop: '8px', display: 'none'
            });
            cancelBtn.onclick = () => { this.aborted = true; };
            btnDiv.appendChild(cancelBtn);
            panel.appendChild(btnDiv);

            // ---- 进度区 ----
            const progressDiv = document.createElement('div');
            progressDiv.id = 'zhihu-fav-progress';
            Object.assign(progressDiv.style, { padding: '12px 20px', display: 'none' });

            const progressBarBg = document.createElement('div');
            Object.assign(progressBarBg.style, {
                width: '100%', height: '8px', backgroundColor: '#f0f0f0',
                borderRadius: '4px', overflow: 'hidden'
            });
            const progressBar = document.createElement('div');
            Object.assign(progressBar.style, {
                width: '0%', height: '100%',
                background: 'linear-gradient(90deg, #E67E22, #F39C12)',
                borderRadius: '4px', transition: 'width 0.3s ease'
            });
            progressBarBg.appendChild(progressBar);
            progressDiv.appendChild(progressBarBg);

            const progressText = document.createElement('div');
            Object.assign(progressText.style, { fontSize: '12px', color: '#666', marginTop: '8px', textAlign: 'center' });
            progressText.textContent = '准备中...';
            progressDiv.appendChild(progressText);

            const stageText = document.createElement('div');
            Object.assign(stageText.style, { fontSize: '11px', color: '#999', marginTop: '4px', textAlign: 'center' });
            progressDiv.appendChild(stageText);
            panel.appendChild(progressDiv);

            // ---- 折叠按钮 ----
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'zhihu-fav-toggle-btn';
            toggleBtn.textContent = '📚';
            Object.assign(toggleBtn.style, {
                position: 'fixed', top: '70px', right: '20px', zIndex: '10001',
                width: '40px', height: '40px', borderRadius: '50%',
                backgroundColor: '#E67E22', color: 'white', border: 'none',
                fontSize: '18px', cursor: 'pointer', display: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            });
            toggleBtn.onclick = () => {
                panel.style.display = 'block';
                toggleBtn.style.display = 'none';
            };
            document.body.appendChild(toggleBtn);

            closeBtn.onclick = () => {
                panel.style.display = 'none';
                toggleBtn.style.display = 'block';
            };

            document.body.appendChild(panel);
            this.ui = {
                panel, body, loadingDiv, btnDiv, exportBtn, cancelBtn,
                progressDiv, progressBar, progressText, stageText, toggleBtn
            };

            // 自动加载收藏夹
            this.fetchCollections();
        },

        setProgress: function(pct, text, stage) {
            this.ui.progressBar.style.width = pct + '%';
            if (text) this.ui.progressText.textContent = text;
            if (stage !== undefined) this.ui.stageText.textContent = stage;
        },

        lockUI: function() {
            this.ui.exportBtn.disabled = true;
            this.ui.exportBtn.style.opacity = '0.6';
            this.ui.exportBtn.style.cursor = 'not-allowed';
            this.ui.cancelBtn.style.display = 'block';
            this.ui.progressDiv.style.display = 'block';
        },

        resetUI: function(delay) {
            setTimeout(() => {
                this.ui.progressDiv.style.display = 'none';
                this.ui.cancelBtn.style.display = 'none';
                this.ui.exportBtn.disabled = false;
                this.ui.exportBtn.style.opacity = '1';
                this.ui.exportBtn.style.cursor = 'pointer';
            }, delay || 0);
        },

        // ==================== 获取收藏夹列表 ====================
        // 探测收藏夹 API 路径（不同用户/页面可能不同）
        probeApiBase: async function() {
            const candidates = [
                '/api/v4/people/' + this.urlToken + '/collections',
                '/api/v4/members/' + this.urlToken + '/collections',
            ];
            for (const url of candidates) {
                try {
                    const probe = await fetch(url + '?limit=1&offset=0');
                    if (probe.ok) return url;
                    // 403 = 存在但无权限, 也视为路径正确
                    if (probe.status === 403) return url;
                } catch (e) { /* 忽略网络错误，继续尝试下一个 */ }
            }
            return null;
        },

        fetchCollections: async function() {
            try {
                const apiBase = await this.probeApiBase();
                if (!apiBase) throw new Error('未找到收藏夹 API 路径');

                const collections = [];
                let offset = 0;
                const limit = 20;

                while (true) {
                    const params = new URLSearchParams({
                        include: 'data[*].id,title,description,updated_time,item_count,followers_count,is_public',
                        limit: String(limit),
                        offset: String(offset)
                    });
                    const resp = await fetch(apiBase + '?' + params.toString());
                    if (!resp.ok) throw new Error('获取收藏夹失败: ' + resp.status);
                    const data = await resp.json();
                    if (!data.data || data.data.length === 0) break;
                    collections.push(...data.data);
                    if (data.paging && data.paging.is_end) break;
                    offset += limit;
                    await this.sleep(CONFIG.apiDelay);
                }

                this.collections = collections;
                this.renderCollectionList();
            } catch (err) {
                console.error('获取收藏夹失败:', err);
                this.ui.loadingDiv.textContent = '❌ 获取收藏夹失败: ' + err.message;
            }
        },

        // ==================== 渲染收藏夹列表 ====================
        renderCollectionList: function() {
            const body = this.ui.body;
            body.innerHTML = '';

            if (this.collections.length === 0) {
                body.innerHTML = '<div style="padding:30px 20px;text-align:center;color:#999;">暂无公开收藏夹</div>';
                return;
            }

            // 选项区
            const optionsDiv = document.createElement('div');
            Object.assign(optionsDiv.style, { padding: '12px 20px', borderBottom: '1px solid #f0f0f0' });

            // 分类方式
            const categoryLabel = document.createElement('div');
            categoryLabel.textContent = '文件组织方式';
            Object.assign(categoryLabel.style, { fontSize: '13px', color: '#666', marginBottom: '8px' });
            optionsDiv.appendChild(categoryLabel);

            const flatWrapper = document.createElement('label');
            Object.assign(flatWrapper.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '16px', cursor: 'pointer', fontSize: '13px', color: '#333' });
            const flatRb = document.createElement('input');
            flatRb.type = 'radio'; flatRb.name = 'fav-org'; flatRb.value = 'flat'; flatRb.checked = true;
            flatWrapper.appendChild(flatRb);
            flatWrapper.appendChild(document.createTextNode('不分类（平铺输出）'));

            const folderRbWrap = document.createElement('label');
            Object.assign(folderRbWrap.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '13px', color: '#333' });
            const folderRb = document.createElement('input');
            folderRb.type = 'radio'; folderRb.name = 'fav-org'; folderRb.value = 'folder'; folderRb.checked = false;
            folderRbWrap.appendChild(folderRb);
            folderRbWrap.appendChild(document.createTextNode('按收藏夹分类'));

            optionsDiv.appendChild(flatWrapper);
            optionsDiv.appendChild(folderRbWrap);

            // 链接风格
            const linkDiv = document.createElement('div');
            Object.assign(linkDiv.style, { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f0f0f0' });
            const linkLabel = document.createElement('div');
            linkLabel.textContent = '链接风格';
            Object.assign(linkLabel.style, { fontSize: '13px', color: '#666', marginBottom: '6px' });
            linkDiv.appendChild(linkLabel);

            const obsidianW = document.createElement('label');
            Object.assign(obsidianW.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '16px', cursor: 'pointer', fontSize: '13px', color: '#333' });
            const obsidianRb = document.createElement('input');
            obsidianRb.type = 'radio'; obsidianRb.name = 'fav-link'; obsidianRb.value = 'obsidian'; obsidianRb.checked = true;
            obsidianW.appendChild(obsidianRb);
            obsidianW.appendChild(document.createTextNode('Obsidian'));

            const stdW = document.createElement('label');
            Object.assign(stdW.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '13px', color: '#333' });
            const stdRb = document.createElement('input');
            stdRb.type = 'radio'; stdRb.name = 'fav-link'; stdRb.value = 'standard';
            stdW.appendChild(stdRb);
            stdW.appendChild(document.createTextNode('通用 Markdown'));

            linkDiv.appendChild(obsidianW);
            linkDiv.appendChild(stdW);
            optionsDiv.appendChild(linkDiv);

            // ZIP 打包下载
            const zipDiv = document.createElement('div');
            Object.assign(zipDiv.style, { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f0f0f0' });
            const zipLabel = document.createElement('label');
            Object.assign(zipLabel.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: '#333' });
            const zipCb = document.createElement('input');
            zipCb.type = 'checkbox'; zipCb.id = 'fav-use-zip'; zipCb.checked = true;
            Object.assign(zipCb.style, { width: '15px', height: '15px', accentColor: '#E67E22' });
            zipLabel.appendChild(zipCb);
            zipLabel.appendChild(document.createTextNode('打包为 ZIP 下载（更快，仅一个文件）'));
            zipDiv.appendChild(zipLabel);
            // 提示文字
            const zipHint = document.createElement('div');
            zipHint.textContent = '勾选后所有 Markdown 文件打包成一个 ZIP，大幅提升下载速度';
            Object.assign(zipHint.style, { fontSize: '11px', color: '#bbb', marginTop: '4px', marginLeft: '21px' });
            zipDiv.appendChild(zipHint);
            optionsDiv.appendChild(zipDiv);
            body.appendChild(optionsDiv);

            // 收藏夹列表标题栏
            const listHeader = document.createElement('div');
            Object.assign(listHeader.style, {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 20px 8px', fontSize: '14px', fontWeight: '600', color: '#333'
            });
            listHeader.innerHTML = '<span>选择收藏夹</span>';

            const btnGroup = document.createElement('div');
            const selectAllBtn = document.createElement('a');
            selectAllBtn.textContent = '全选';
            Object.assign(selectAllBtn.style, { fontSize: '12px', color: '#E67E22', cursor: 'pointer', marginRight: '12px' });
            selectAllBtn.onclick = () => this.setAllCheckboxes(true);

            const deselectBtn = document.createElement('a');
            deselectBtn.textContent = '取消全选';
            Object.assign(deselectBtn.style, { fontSize: '12px', color: '#999', cursor: 'pointer' });
            deselectBtn.onclick = () => this.setAllCheckboxes(false);

            btnGroup.appendChild(selectAllBtn);
            btnGroup.appendChild(deselectBtn);
            listHeader.appendChild(btnGroup);
            body.appendChild(listHeader);

            // 收藏夹列表
            const listDiv = document.createElement('div');
            Object.assign(listDiv.style, { padding: '0 20px 12px', maxHeight: '300px', overflowY: 'auto' });

            // 全部收藏选项（特殊项）
            const allWrapper = this.createCheckboxItem('__all__', '📦 全部收藏', '所有收藏夹的内容合集', this.collections.reduce((s, c) => s + (c.item_count || 0), 0), true);
            listDiv.appendChild(allWrapper);

            // 分隔线
            const sep = document.createElement('div');
            Object.assign(sep.style, { height: '1px', backgroundColor: '#f0f0f0', margin: '6px 0' });
            listDiv.appendChild(sep);

            this.collections.forEach(c => {
                const wrapper = this.createCheckboxItem(
                    c.id,
                    '📁 ' + (c.title || '未命名'),
                    c.description || (c.is_public === false ? '私密收藏夹' : ''),
                    c.item_count || 0,
                    false
                );
                listDiv.appendChild(wrapper);
            });

            body.appendChild(listDiv);
            this.ui.btnDiv.style.display = 'block';

            // 同步 "全部收藏" 默认选中状态的视觉效果
            this.onAllCheckboxChange(true);
        },

        createCheckboxItem: function(id, title, desc, count, checked) {
            const wrapper = document.createElement('label');
            Object.assign(wrapper.style, {
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '7px 0', cursor: 'pointer', fontSize: '13px', color: '#333'
            });
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.dataset.collectionId = id; cb.checked = checked;
            Object.assign(cb.style, { width: '15px', height: '15px', accentColor: '#E67E22', flexShrink: '0' });

            const textDiv = document.createElement('div');
            textDiv.style.flex = '1';
            const titleSpan = document.createElement('div');
            titleSpan.textContent = title;
            titleSpan.style.fontSize = '13px';
            if (id === '__all__') titleSpan.style.fontWeight = '600';
            textDiv.appendChild(titleSpan);

            if (desc) {
                const descSpan = document.createElement('div');
                descSpan.textContent = desc.length > 60 ? desc.substring(0, 60) + '…' : desc;
                Object.assign(descSpan.style, { fontSize: '11px', color: '#999', marginTop: '2px' });
                textDiv.appendChild(descSpan);
            }

            const countSpan = document.createElement('span');
            countSpan.textContent = count + ' 项';
            Object.assign(countSpan.style, { fontSize: '11px', color: '#bbb', flexShrink: '0' });

            wrapper.appendChild(cb);
            wrapper.appendChild(textDiv);
            wrapper.appendChild(countSpan);

            // "全部收藏" 点击时控制子项
            if (id === '__all__') {
                wrapper.onclick = (e) => {
                    if (e.target === cb) return;
                    cb.checked = !cb.checked;
                    this.onAllCheckboxChange(cb.checked);
                };
                cb.onchange = () => this.onAllCheckboxChange(cb.checked);
            }

            return wrapper;
        },

        setAllCheckboxes: function(checked) {
            const cbs = this.ui.body.querySelectorAll('input[type="checkbox"]');
            cbs.forEach(cb => { cb.checked = checked; });
        },

        onAllCheckboxChange: function(checked) {
            const cbs = this.ui.body.querySelectorAll('input[type="checkbox"]');
            cbs.forEach(cb => { cb.checked = checked; });
        },

        getSelectedCollectionIds: function() {
            const cbs = this.ui.body.querySelectorAll('input[type="checkbox"]');
            const allChecked = document.querySelector('#zhihu-fav-body input[data-collection-id="__all__"]')?.checked;
            const ids = [];

            if (allChecked) {
                // "全部收藏" 选中时返回所有收藏夹 ID
                cbs.forEach(cb => {
                    const id = cb.dataset.collectionId;
                    if (id && id !== '__all__') ids.push(id);
                });
            } else {
                cbs.forEach(cb => {
                    if (cb.checked) {
                        const id = cb.dataset.collectionId;
                        if (id && id !== '__all__') ids.push(id);
                    }
                });
            }
            return ids;
        },

        // ==================== 主导出流程 ====================
        startExport: async function() {
            this.aborted = false;
            this.stats = { total: 0, success: 0, fail: 0 };

            const orgRb = document.querySelector('input[name="fav-org"]:checked');
            const organizeByFolder = orgRb && orgRb.value === 'folder';
            CONFIG.linkStyle = (document.querySelector('input[name="fav-link"]:checked') || {}).value || 'obsidian';

            const selectedIds = this.getSelectedCollectionIds();
            if (selectedIds.length === 0) {
                alert('请至少选择一个收藏夹！');
                return;
            }

            const selectedCollections = this.collections.filter(c => selectedIds.includes(String(c.id)));
            if (selectedCollections.length === 0) {
                alert('未找到选中的收藏夹数据，请重新加载。');
                return;
            }

            this.lockUI();
            this.setProgress(0, '正在获取收藏内容...', '');

            try {
                // ---- 第一步：获取所有选中收藏夹的内容 ----
                const allItems = []; // { collection, collectionTitle, item }
                let totalEstimated = selectedCollections.reduce((s, c) => s + (c.item_count || 0), 0);

                // 并发获取各收藏夹内容
                const apiQueue = [...selectedCollections];
                let apiDone = 0;
                const apiTotal = apiQueue.length;

                const apiWorkers = [];
                for (let i = 0; i < Math.min(CONFIG.apiConcurrency, apiQueue.length); i++) {
                    apiWorkers.push((async () => {
                        while (apiQueue.length > 0 && !this.aborted) {
                            const collection = apiQueue.shift();
                            const items = await this.fetchCollectionItems(collection.id, (count) => {
                                this.setProgress(
                                    0,
                                    '正在获取收藏内容: ' + (collection.title || '未知'),
                                    '已获取 ' + (allItems.length + count) + ' 项'
                                );
                            });
                            for (const item of items) {
                                allItems.push({ collection, collectionTitle: collection.title || '未命名', item });
                            }
                            apiDone++;
                            const pct = (apiDone / apiTotal) * 5;
                            this.setProgress(Math.min(pct, 5).toFixed(1), '正在获取收藏内容...', apiDone + ' / ' + apiTotal + ' 个收藏夹');
                            await this.sleep(CONFIG.apiDelay);
                        }
                    })());
                }
                await Promise.all(apiWorkers);

                if (this.aborted) { this.setProgress(0, '导出已取消', ''); this.resetUI(2000); return; }

                totalEstimated = allItems.length;
                this.setProgress(5, '正在转换为 Markdown...', '共 ' + totalEstimated + ' 项');

                // ---- 第二步：为每项补充内容（文章可能需要单独获取） ----
                // 先处理已有 content 的项，并行获取缺失内容的项
                const needContent = [];
                for (const entry of allItems) {
                    if (!entry.item.content || entry.item.content.trim().length < 50) {
                        needContent.push(entry);
                    }
                }

                if (needContent.length > 0) {
                    this.setProgress(5, '正在获取文章全文...', '0 / ' + needContent.length);
                    const contentQueue = [...needContent];
                    const contentWorkers = [];
                    let contentFetched = 0;

                    for (let i = 0; i < Math.min(CONFIG.apiConcurrency, contentQueue.length); i++) {
                        contentWorkers.push((async () => {
                            while (contentQueue.length > 0 && !this.aborted) {
                                const entry = contentQueue.shift();
                                try {
                                    await this.fetchItemContent(entry);
                                } catch (e) {
                                    console.warn('获取文章内容失败:', e);
                                }
                                contentFetched++;
                                const pct = 5 + (contentFetched / needContent.length) * 10;
                                this.setProgress(pct.toFixed(1), '正在获取文章全文...', contentFetched + ' / ' + needContent.length);
                                await this.sleep(CONFIG.apiDelay);
                            }
                        })());
                    }
                    await Promise.all(contentWorkers);
                }

                if (this.aborted) { this.setProgress(0, '导出已取消', ''); this.resetUI(2000); return; }

                // ---- 第三步：生成 Markdown 文件并下载 ----
                this.setProgress(16, '正在生成 Markdown 文件...', '0 / ' + totalEstimated);

                const files = [];
                // 按收藏夹分组以处理文件名冲突
                let flatIndex = 0;
                const usedFilenames = new Set();

                for (const entry of allItems) {
                    if (this.aborted) break;
                    const md = this.itemToMarkdown(entry);
                    let filename = this.makeFilename(entry, organizeByFolder, flatIndex, usedFilenames);
                    files.push({ filename, content: md, collectionTitle: entry.collectionTitle });
                    flatIndex++;
                }

                if (this.aborted) { this.setProgress(0, '导出已取消', ''); this.resetUI(2000); return; }

                // ---- 第四步：下载 ----
                const useZip = document.getElementById('fav-use-zip')?.checked;

                if (useZip) {
                    // ZIP 模式：打包成一个文件，秒级完成
                    this.setProgress(18, '正在打包 ZIP ...', '');
                    try {
                        await this.downloadAsZip(files);
                        this.stats.success = files.length;
                        this.setProgress(100, '✅ 导出完成！',
                            'ZIP 包共 ' + files.length + ' 个文件');
                    } catch (e) {
                        console.error('ZIP 打包失败:', e);
                        this.setProgress(0, '❌ ZIP 打包失败: ' + e.message, '');
                    }
                } else {
                    // 独立文件模式：串行快速触发，避免浏览器下载管理器拥堵
                    this.setProgress(18, '正在快速下载...', '0 / ' + files.length);

                    const total = files.length;
                    // 预先创建所有 Blob URL，减少后续延迟
                    const blobs = files.map(f => ({
                        filename: f.filename,
                        url: URL.createObjectURL(new Blob([f.content], { type: 'text/markdown;charset=utf-8' }))
                    }));

                    for (let i = 0; i < blobs.length && !this.aborted; i++) {
                        const { filename, url } = blobs[i];
                        try {
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            this.stats.success++;
                        } catch (e) {
                            console.error('下载失败:', filename, e);
                            this.stats.fail++;
                        }
                        // 极短间隔：仅防浏览器批量丢弃，不影响总耗时
                        if (i % 5 === 4) await this.sleep(100);
                        const pct = 18 + ((i + 1) / total) * 80;
                        this.setProgress(
                            Math.min(pct, 100).toFixed(1),
                            '正在下载...',
                            (i + 1) + ' / ' + total
                        );
                    }
                    // 延迟释放 Blob URL
                    setTimeout(() => blobs.forEach(b => URL.revokeObjectURL(b.url)), 30000);

                    this.setProgress(100, '✅ 导出完成！',
                        '成功: ' + this.stats.success + ' | 失败: ' + this.stats.fail + ' | 共: ' + total + ' 项');
                }

            } catch (err) {
                console.error('导出失败:', err);
                this.setProgress(0, '❌ 导出失败: ' + err.message, '');
            } finally {
                this.resetUI(8000);
            }
        },

        // ==================== 获取收藏夹内容 ====================
        fetchCollectionItems: async function(collectionId, onProgress) {
            const items = [];
            let offset = 0;
            const limit = 20;

            while (true) {
                if (this.aborted) break;

                const params = new URLSearchParams({
                    include: 'data[*].type,content,voteup_count,created_time,updated_time,comment_count,question.title,question.id,title,url,author.name,author.url_token',
                    limit: String(limit),
                    offset: String(offset)
                });
                const resp = await fetch('/api/v4/collections/' + collectionId + '/items?' + params.toString());

                if (!resp.ok) {
                    if (resp.status === 429) {
                        console.warn('限流，等待 3 秒...');
                        await this.sleep(3000);
                        continue;
                    }
                    console.warn('获取收藏内容失败 offset=' + offset + ' status=' + resp.status);
                    break;
                }

                const data = await resp.json();
                if (!data.data || data.data.length === 0) break;

                for (const item of data.data) {
                    items.push(item);
                }
                if (onProgress) onProgress(items.length, data.paging && data.paging.is_end ? items.length : '?');

                if (data.paging && data.paging.is_end) break;
                offset += limit;
                await this.sleep(CONFIG.apiDelay);
            }

            return items;
        },

        // ==================== 补充获取文章内容 ====================
        fetchItemContent: async function(entry) {
            const item = entry.item;
            const type = item.type || '';

            // Answer 可能有截断的内容，尝试从独立 API 获取
            if (type === 'answer' && item.id && item.question && item.question.id) {
                try {
                    const resp = await fetch('/api/v4/questions/' + item.question.id + '/answers/' + item.id + '?include=content');
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.content) item.content = data.content;
                    }
                } catch (e) { /* ignore */ }
                return;
            }

            // 文章/专栏
            if (type === 'article' || type === 'post' || item.url?.startsWith('/p/') || item.url?.includes('zhuanlan')) {
                let articleId = item.id;
                if (!articleId && item.url) {
                    const m = item.url.match(/\/p\/(\d+)/);
                    if (m) articleId = m[1];
                }
                if (articleId) {
                    try {
                        const resp = await fetch('/api/v4/articles/' + articleId + '?include=content');
                        if (resp.ok) {
                            const data = await resp.json();
                            if (data.content) {
                                item.content = data.content;
                                if (!item.title) item.title = data.title || '';
                            }
                        }
                    } catch (e) { /* ignore */ }
                }
                return;
            }

            // 想法
            if (type === 'pin' || type === 'pin_v2') {
                // 想法内容通常在 content 中已有
                return;
            }

            // 通用的 fallback: 如果有 url 则尝试抓取页面
            if ((!item.content || item.content.trim().length < 50) && item.url) {
                try {
                    const url = item.url.startsWith('http') ? item.url : 'https://www.zhihu.com' + item.url;
                    const resp = await fetch(url, { headers: { 'Accept': 'text/html' } });
                    if (resp.ok) {
                        const html = await resp.text();
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        // 尝试提取内容
                        const contentEl = doc.querySelector('.RichText, .Post-RichText, .AnswerCard .RichText, .ContentItem-content');
                        if (contentEl) {
                            item.content = contentEl.innerHTML;
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        },

        // ==================== 生成 Markdown ====================
        itemToMarkdown: function(entry) {
            const item = entry.item;
            const collectionTitle = entry.collectionTitle;
            const type = item.type || 'answer';
            const L = [];
            const now = new Date().toLocaleString('zh-CN');

            // 提取标题
            let title = this.extractTitle(item);
            let authorName = this.extractAuthor(item);
            let sourceUrl = this.extractUrl(item);
            let created = item.created_time || item.created || '';
            let updated = item.updated_time || item.updated || '';
            let votes = item.voteup_count ?? item.vote_count ?? 0;
            let comments = item.comment_count ?? 0;

            if (created) {
                try { created = new Date(created * 1000).toLocaleDateString('zh-CN'); } catch(e) { created = String(created); }
            } else { created = '未知'; }
            if (updated) {
                try { updated = new Date(updated * 1000).toLocaleDateString('zh-CN'); } catch(e) { updated = String(updated); }
            } else { updated = ''; }

            // ---- Frontmatter ----
            if (CONFIG.addFrontmatter) {
                L.push('---');
                L.push('title: "' + this.escapeYaml(title) + '"');
                if (authorName) L.push('author: "' + this.escapeYaml(authorName) + '"');
                L.push('source: "' + sourceUrl + '"');
                L.push('collection: "' + this.escapeYaml(collectionTitle) + '"');
                L.push('export_date: "' + now + '"');
                L.push('created: "' + created + '"');
                if (updated) L.push('updated: "' + updated + '"');
                L.push('votes: ' + votes);
                L.push('comments: ' + comments);
                L.push('tags:');
                L.push('  - 知乎导出');
                L.push('  - ' + collectionTitle);
                L.push('---');
                L.push('');
            }

            // ---- 标题 ----
            L.push('# ' + title);
            L.push('');

            // ---- 元信息 ----
            let meta = '> ';
            if (authorName) meta += '**作者**: ' + authorName + ' · ';
            meta += '📅 ' + created;
            if (updated) meta += '（更新: ' + updated + '）';
            meta += ' · 👍 ' + votes + ' · 💬 ' + comments;
            L.push(meta);
            L.push('> **来源**: [' + (title.length > 50 ? title.substring(0, 50) + '…' : title) + '](' + sourceUrl + ')');
            L.push('> **收藏夹**: ' + collectionTitle);
            L.push('');

            L.push('---');
            L.push('');

            // ---- 正文 ----
            const content = item.content || '';
            if (content.trim()) {
                L.push(this.html2md(content));
            } else {
                L.push('*（内容获取失败或为空）*');
                if (sourceUrl) {
                    L.push('');
                    L.push('请查看原文：[' + title + '](' + sourceUrl + ')');
                }
            }

            L.push('');
            L.push('---');
            L.push('> 本文档由知乎收藏夹导出工具自动生成 · [查看原文](' + sourceUrl + ')');

            return L.join('\n');
        },

        // ==================== 提取信息 ====================
        extractTitle: function(item) {
            if (item.question && item.question.title) return item.question.title;
            if (item.title) return item.title;
            // Fallback from content
            if (item.content) {
                const m = item.content.match(/<h1[^>]*>(.*?)<\/h1>/i);
                if (m) return m[1].replace(/<[^>]*>/g, '').trim();
            }
            return '知乎内容 ' + (item.id || '');
        },

        extractAuthor: function(item) {
            if (item.author) {
                if (typeof item.author === 'object') return item.author.name || '';
                return String(item.author);
            }
            return '';
        },

        extractUrl: function(item) {
            if (item.question && item.question.id && item.id) {
                return 'https://www.zhihu.com/question/' + item.question.id + '/answer/' + item.id;
            }
            if (item.url) {
                return item.url.startsWith('http') ? item.url : 'https://www.zhihu.com' + item.url;
            }
            if (item.id && item.type === 'article') {
                return 'https://zhuanlan.zhihu.com/p/' + item.id;
            }
            return 'https://www.zhihu.com';
        },

        // ==================== 文件名生成 ====================
        makeFilename: function(entry, organizeByFolder, index, usedFilenames) {
            const item = entry.item;
            const title = this.extractTitle(item);
            const collectionTitle = entry.collectionTitle || '未命名收藏夹';

            // 生成安全的文件名
            let slug = title
                .replace(/[\\\/:*?"<>|]/g, '_')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 80);

            if (!slug) slug = 'zhihu_item_' + index;

            let filename;
            if (organizeByFolder) {
                const folder = collectionTitle.replace(/[\\\/:*?"<>|]/g, '_').trim();
                filename = folder + ' - ' + slug + '.md';
            } else {
                filename = slug + '.md';
            }

            // 处理重名
            if (usedFilenames.has(filename)) {
                let counter = 1;
                const base = filename.replace('.md', '');
                while (usedFilenames.has(base + '_' + counter + '.md')) { counter++; }
                filename = base + '_' + counter + '.md';
            }
            usedFilenames.add(filename);
            return filename;
        },

        // ==================== ZIP 打包下载 ====================
        downloadAsZip: async function(files) {
            const JSZip = window.JSZip;
            if (!JSZip) throw new Error('JSZip 库未加载');

            const zip = new JSZip();
            for (const f of files) {
                zip.file(f.filename, f.content);
            }

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '知乎收藏夹导出_' + new Date().toISOString().slice(0, 10) + '.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        },

        // ==================== HTML → Markdown ====================
        html2md: function(html) {
            if (!html) return '';
            const div = document.createElement('div');
            div.innerHTML = html;
            const self = this;

            function kids(node) {
                return Array.from(node.childNodes).map(n => walk(n)).join('');
            }

            function walk(node) {
                if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
                if (node.nodeType !== Node.ELEMENT_NODE) return '';
                const tag = node.tagName.toLowerCase();

                if (tag === 'ol') {
                    return Array.from(node.children)
                        .filter(c => c.tagName && c.tagName.toLowerCase() === 'li')
                        .map((li, idx) => (idx + 1) + '. ' + kids(li).trim())
                        .join('\n') + '\n\n';
                }
                if (tag === 'ul') {
                    return Array.from(node.children)
                        .filter(c => c.tagName && c.tagName.toLowerCase() === 'li')
                        .map(li => '- ' + kids(li).trim())
                        .join('\n') + '\n\n';
                }
                if (tag === 'li') return '- ' + kids(node).trim() + '\n';

                const content = kids(node);

                switch (tag) {
                    case 'p': return content.trim() ? content.trim() + '\n\n' : '';
                    case 'br': return '\n';
                    case 'hr': return '\n---\n\n';
                    case 'img': {
                        const src = node.getAttribute('data-original') || node.getAttribute('data-actualsrc') || node.getAttribute('src') || '';
                        const full = src.startsWith('//') ? 'https:' + src : src;
                        const alt = node.getAttribute('alt') || '图片';
                        return full ? '![' + alt + '](' + full + ')\n\n' : '';
                    }
                    case 'b': case 'strong': return content.trim() ? '**' + content.trim() + '**' : '';
                    case 'i': case 'em': return content.trim() ? '*' + content.trim() + '*' : '';
                    case 'del': case 's': case 'strike': return content.trim() ? '~~' + content.trim() + '~~' : '';
                    case 'sup': return '<sup>' + content + '</sup>';
                    case 'sub': return '<sub>' + content + '</sub>';
                    case 'blockquote': return content.trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
                    case 'a': return '[' + content + '](' + self.cleanLink(node.getAttribute('href') || '') + ')';
                    case 'h1': return '#### ' + content.trim() + '\n\n';
                    case 'h2': return '##### ' + content.trim() + '\n\n';
                    case 'h3': case 'h4': case 'h5': case 'h6': return '###### ' + content.trim() + '\n\n';
                    case 'figure': return kids(node);
                    case 'figcaption': return content.trim() ? '*' + content.trim() + '*\n\n' : '';
                    case 'code':
                        return (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') ? content : '`' + content + '`';
                    case 'pre': {
                        const codeEl = node.querySelector('code');
                        const lang = codeEl ? (codeEl.className.match(/language-(\w+)/) || [])[1] || '' : '';
                        return '```' + lang + '\n' + content.trim() + '\n```\n\n';
                    }
                    case 'table': return self.convertTable(node) + '\n\n';
                    case 'video': {
                        const vs = node.getAttribute('src') || '';
                        return vs ? '[🎬 视频](' + vs + ')\n\n' : '';
                    }
                    case 'noscript': return '';
                    default: return content;
                }
            }

            return walk(div).trim().replace(/\n{3,}/g, '\n\n');
        },

        convertTable: function(tbl) {
            const rows = Array.from(tbl.querySelectorAll('tr'));
            if (!rows.length) return '';
            const result = [];
            rows.forEach((row, ri) => {
                const cells = Array.from(row.querySelectorAll('td, th'));
                const texts = cells.map(c => c.textContent.trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
                result.push('| ' + texts.join(' | ') + ' |');
                if (ri === 0) result.push('| ' + texts.map(() => '---').join(' | ') + ' |');
            });
            return result.join('\n');
        },

        cleanLink: function(href) {
            if (!href) return '';
            try {
                if (href.includes('link.zhihu.com') && href.includes('target=')) {
                    const u = new URL(href);
                    const t = u.searchParams.get('target');
                    if (t) return decodeURIComponent(t);
                }
            } catch (e) {}
            return href;
        },

        // ==================== 工具 ====================
        escapeYaml: function(s) {
            return s ? s.replace(/"/g, '\\"').replace(/\n/g, ' ') : '';
        },

        sleep: function(ms) {
            return new Promise(r => setTimeout(r, ms));
        }
    };

    // ==================== 启动 ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => FavoritesExporter.init());
    } else {
        FavoritesExporter.init();
    }
})();
