// ==UserScript==
// @name         知乎内容导出工具（一体化）
// @namespace    https://github.com/heritager/zhihu-exporter
// @version      4.0.0
// @description  一体化导出工具：答主内容/问题回答/收藏夹批量导出，支持Obsidian友好Markdown
// @author       ZhihuExporter
// @license      MIT
// @match        https://www.zhihu.com/people/*
// @match        https://www.zhihu.com/question/*
// @icon         https://static.zhihu.com/heifetz/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ===================================================================
    //  配置
    // ===================================================================
    const CONFIG = {
        apiDelay: 350,
        apiConcurrency: 3,
        addFrontmatter: true,
        useCallout: true,
    };

    // ===================================================================
    //  工具函数（全局共享）
    // ===================================================================
    const Util = {
        sleep: ms => new Promise(r => setTimeout(r, ms)),

        escapeYaml: s => s ? s.replace(/"/g, '\\"').replace(/\n/g, ' ') : '',

        /** 安全文件名 */
        safeFilename: (s, max = 80) => {
            let r = s.replace(/[\\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
            if (!r) r = 'untitled';
            return r.substring(0, max);
        },

        /** 提取 url_token */
        getUrlToken: () => (location.pathname.match(/\/people\/([^\/]+)/) || [])[1],

        /** 提取 questionId */
        getQuestionId: () => (location.pathname.match(/\/question\/(\d+)/) || [])[1],

        /** 日期格式化 */
        fmtDate: ts => {
            if (!ts) return '未知';
            try { return new Date(ts * 1000).toLocaleDateString('zh-CN'); } catch { return String(ts); }
        },

        /** 清理知乎跳转链接 */
        cleanLink: href => {
            if (!href) return '';
            try {
                if (href.includes('link.zhihu.com') && href.includes('target=')) {
                    const t = new URL(href).searchParams.get('target');
                    if (t) return decodeURIComponent(t);
                }
            } catch {}
            return href;
        },

        /** 将内容统一为字符串（处理数组型 content，如想法中的多段内容） */
        contentString: content => {
            if (!content) return '';
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return content.map(b => {
                    if (b.type === 'text') return b.content || b.own_text || '';
                    if (b.type === 'image') return '<img src="' + (b.url || b.original_url || '') + '">';
                    if (b.type === 'video') return '[视频]';
                    if (b.type === 'link') return '<a href="' + (b.url || '') + '">' + (b.title || '链接') + '</a>';
                    return '';
                }).join('\n\n');
            }
            return String(content);
        },

        // ========== HTML → Markdown ==========
        html2md: function(html) {
            if (!html) return '';
            const div = document.createElement('div');
            div.innerHTML = html;

            const kids = node => Array.from(node.childNodes).map(n => walk(n)).join('');

            const walk = node => {
                if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
                if (node.nodeType !== Node.ELEMENT_NODE) return '';
                const tag = node.tagName.toLowerCase();

                if (tag === 'ol') return Array.from(node.children).filter(c => c.tagName === 'LI').map((li, i) => `${i+1}. ${kids(li).trim()}`).join('\n') + '\n\n';
                if (tag === 'ul') return Array.from(node.children).filter(c => c.tagName === 'LI').map(li => `- ${kids(li).trim()}`).join('\n') + '\n\n';
                if (tag === 'li') return `- ${kids(node).trim()}\n`;

                const content = kids(node);

                switch (tag) {
                    case 'p': return content.trim() ? content.trim() + '\n\n' : '';
                    case 'br': return '\n';
                    case 'hr': return '\n---\n\n';
                    case 'img': {
                        const src = node.getAttribute('data-original') || node.getAttribute('data-actualsrc') || node.getAttribute('src') || '';
                        const full = src.startsWith('//') ? 'https:' + src : src;
                        return full ? `![${node.getAttribute('alt') || '图片'}](${full})\n\n` : '';
                    }
                    case 'b': case 'strong': return content.trim() ? `**${content.trim()}**` : '';
                    case 'i': case 'em': return content.trim() ? `*${content.trim()}*` : '';
                    case 'del': case 's': case 'strike': return content.trim() ? `~~${content.trim()}~~` : '';
                    case 'sup': return `<sup>${content}</sup>`;
                    case 'sub': return `<sub>${content}</sub>`;
                    case 'blockquote': return content.trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
                    case 'a': return `[${content}](${Util.cleanLink(node.getAttribute('href') || '')})`;
                    case 'h1': return `#### ${content.trim()}\n\n`;
                    case 'h2': return `##### ${content.trim()}\n\n`;
                    case 'h3': case 'h4': case 'h5': case 'h6': return `###### ${content.trim()}\n\n`;
                    case 'figure': return kids(node);
                    case 'figcaption': return content.trim() ? `*${content.trim()}*\n\n` : '';
                    case 'code': return node.parentElement?.tagName === 'PRE' ? content : '`' + content + '`';
                    case 'pre': {
                        const code = node.querySelector('code');
                        const lang = code ? (code.className.match(/language-(\w+)/) || [])[1] || '' : '';
                        return '```' + lang + '\n' + content.trim() + '\n```\n\n';
                    }
                    case 'table': return Util.convertTable(node) + '\n\n';
                    case 'video': {
                        const vs = node.getAttribute('src') || '';
                        return vs ? `[🎬 视频](${vs})\n\n` : '';
                    }
                    case 'noscript': return '';
                    default: return content;
                }
            };

            return walk(div).trim().replace(/\n{3,}/g, '\n\n');
        },

        convertTable: tbl => {
            const rows = tbl.querySelectorAll('tr');
            if (!rows.length) return '';
            const out = [];
            rows.forEach((row, ri) => {
                const cells = [...row.querySelectorAll('td, th')].map(c => c.textContent.trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
                out.push('| ' + cells.join(' | ') + ' |');
                if (ri === 0) out.push('| ' + cells.map(() => '---').join(' | ') + ' |');
            });
            return out.join('\n');
        },

        slug: text => text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),

        /** Obsidian/标准目录链接 */
        tocLink: (num, display, heading) => {
            const style = document.querySelector('input[name="exp-link"]:checked')?.value || 'obsidian';
            if (style === 'obsidian') return `${num}. [[#${heading}|${display}]]`;
            return `${num}. [${display}](#${Util.slug(heading)})`;
        },
    };

    // ===================================================================
    //  主应用
    // ===================================================================
    const App = {
        pageType: null,   // 'person' | 'question'
        urlToken: null,
        questionId: null,
        collections: [],
        aborted: false,
        stats: { answers: 0, articles: 0, pins: 0 },
        U: {},            // ui refs

        // ==================== 初始化 ====================
        init() {
            this.urlToken = Util.getUrlToken();
            this.questionId = Util.getQuestionId();
            this.pageType = this.urlToken ? 'person' : this.questionId ? 'question' : null;
            if (!this.pageType) return;
            this.buildUI();
        },

        // ==================== UI ====================
        buildUI() {
            const panel = document.createElement('div');
            panel.id = 'zh-exporter';
            Object.assign(panel.style, {
                position: 'fixed', top: '70px', right: '20px', zIndex: 10000,
                width: '380px', maxHeight: '90vh', overflowY: 'auto',
                background: '#fff', borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                border: '1px solid #e8e8e8', fontSize: '14px', color: '#333',
            });

            // ---- 头部 ----
            const header = panel.appendChild(document.createElement('div'));
            const isQ = this.pageType === 'question';
            const grad = isQ ? 'linear-gradient(135deg,#7B2FF7,#9B59B6)' : 'linear-gradient(135deg,#0066FF,#1a8cff)';
            Object.assign(header.style, { background: grad, padding: '16px 20px', color: '#fff', position: 'relative' });
            header.innerHTML = '<div style="font-weight:600;font-size:15px;">' + (isQ ? '📋 问题回答导出' : '📦 知乎内容导出工具') + '</div>'
                + '<div style="font-size:12px;opacity:.8;margin-top:2px;">' + (isQ ? '导出该问题下所有回答' : '答主内容 / 收藏夹批量导出') + '</div>';

            const closeBtn = header.appendChild(document.createElement('button'));
            closeBtn.textContent = '×';
            Object.assign(closeBtn.style, {
                position: 'absolute', top: '10px', right: '12px', background: 'rgba(255,255,255,.25)',
                border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer',
                width: '24px', height: '24px', borderRadius: '50%', lineHeight: '22px', padding: '0',
            });

            // ---- Tab 栏（仅 person 页面） ----
            let tabBar, tabContents = {};
            if (this.pageType === 'person') {
                tabBar = panel.appendChild(document.createElement('div'));
                Object.assign(tabBar.style, {
                    display: 'flex', borderBottom: '2px solid #f0f0f0',
                });

                const tabs = [
                    { id: 'person', label: '答主内容' },
                    { id: 'fav', label: '收藏夹' },
                ];

                tabs.forEach((t, i) => {
                    const btn = tabBar.appendChild(document.createElement('button'));
                    btn.dataset.tab = t.id;
                    btn.textContent = t.label;
                    Object.assign(btn.style, {
                        flex: '1', padding: '10px', border: 'none', background: 'transparent',
                        fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        color: i === 0 ? '#0066FF' : '#999',
                        borderBottom: i === 0 ? '2px solid #0066FF' : '2px solid transparent',
                        marginBottom: '-2px', transition: 'all .15s',
                    });
                    btn.onclick = () => this.switchTab(t.id);
                });

                // tab content containers
                tabs.forEach(t => {
                    const div = panel.appendChild(document.createElement('div'));
                    div.id = 'tab-' + t.id;
                    div.style.display = t.id === 'person' ? 'block' : 'none';
                    tabContents[t.id] = div;
                });

                // 填充 tab 内容
                this.buildPersonTab(tabContents.person);
                // 收藏夹 tab 异步加载
                this.buildFavTab(tabContents.fav);
            }

            // ---- 问题页面：直接渲染 ----
            if (this.pageType === 'question') {
                const body = panel.appendChild(document.createElement('div'));
                this.buildQuestionUI(body);
            }

            // ---- 链接风格（所有模式共享） ----
            if (this.pageType === 'person') {
                // 放在每个 tab 内部
            } else {
                this.appendLinkStyle(panel);
            }

            // ---- 进度条（共享） ----
            const prog = panel.appendChild(document.createElement('div'));
            prog.id = 'zh-prog';
            prog.style.display = 'none';
            Object.assign(prog.style, { padding: '10px 20px 14px' });
            const barBg = prog.appendChild(document.createElement('div'));
            Object.assign(barBg.style, { width: '100%', height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' });
            const bar = barBg.appendChild(document.createElement('div'));
            bar.id = 'zh-prog-bar';
            Object.assign(bar.style, { width: '0%', height: '100%', background: isQ ? 'linear-gradient(90deg,#7B2FF7,#9B59B6)' : 'linear-gradient(90deg,#0066FF,#1a8cff)', borderRadius: '3px', transition: 'width .3s' });
            const pText = prog.appendChild(document.createElement('div'));
            pText.id = 'zh-prog-text';
            Object.assign(pText.style, { fontSize: '12px', color: '#666', marginTop: '6px', textAlign: 'center' });
            const pStage = prog.appendChild(document.createElement('div'));
            pStage.id = 'zh-prog-stage';
            Object.assign(pStage.style, { fontSize: '11px', color: '#999', marginTop: '2px', textAlign: 'center' });

            // ---- 折叠按钮 ----
            const toggle = document.body.appendChild(document.createElement('button'));
            toggle.id = 'zh-toggle';
            toggle.textContent = isQ ? '📋' : '📦';
            Object.assign(toggle.style, {
                position: 'fixed', top: '70px', right: '20px', zIndex: 10001,
                width: '40px', height: '40px', borderRadius: '50%',
                background: grad, color: '#fff', border: 'none',
                fontSize: '18px', cursor: 'pointer', display: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,.3)',
            });
            toggle.onclick = () => { panel.style.display = 'block'; toggle.style.display = 'none'; };
            closeBtn.onclick = () => { panel.style.display = 'none'; toggle.style.display = 'block'; };

            document.body.appendChild(panel);
            this.U = { panel, prog, bar, pText, pStage, toggle, tabContents, tabBar };

            // 问题页直接触发加载
            if (this.pageType === 'question') {
                const btn = document.getElementById('zh-q-btn');
                if (btn) btn.onclick = () => this.startQuestionExport();
            }
        },

        // ==================== Tab 切换 ====================
        switchTab(id) {
            if (!this.U.tabBar) return;
            const btns = this.U.tabBar.querySelectorAll('button');
            btns.forEach(b => {
                const active = b.dataset.tab === id;
                Object.assign(b.style, {
                    color: active ? '#0066FF' : '#999',
                    borderBottom: active ? '2px solid #0066FF' : '2px solid transparent',
                });
            });
            Object.entries(this.U.tabContents).forEach(([k, v]) => {
                v.style.display = k === id ? 'block' : 'none';
            });
        },

        // ==================== 答主内容 Tab ====================
        buildPersonTab(container) {
            const types = [
                { id: 'exp-answers', label: '📝 导出回答', checked: true },
                { id: 'exp-articles', label: '📄 导出文章', checked: true },
                { id: 'exp-pins', label: '💬 导出想法', checked: true },
            ];
            const opts = container.appendChild(document.createElement('div'));
            Object.assign(opts.style, { padding: '14px 20px 10px' });

            types.forEach(t => {
                const label = opts.appendChild(document.createElement('label'));
                Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', cursor: 'pointer', fontSize: '13px' });
                const cb = label.appendChild(document.createElement('input'));
                cb.type = 'checkbox'; cb.id = t.id; cb.checked = t.checked;
                Object.assign(cb.style, { width: '15px', height: '15px', accentColor: '#0066FF' });
                label.appendChild(document.createTextNode(t.label));
            });

            this.appendLinkStyle(container);

            const btnDiv = container.appendChild(document.createElement('div'));
            Object.assign(btnDiv.style, { padding: '6px 20px 14px' });
            const btn = btnDiv.appendChild(document.createElement('button'));
            btn.textContent = '🚀 开始导出';
            Object.assign(btn.style, {
                width: '100%', padding: '10px', background: 'linear-gradient(135deg,#0066FF,#1a8cff)',
                color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                cursor: 'pointer',
            });
            btn.onclick = () => this.startPersonExport();
        },

        // ==================== 收藏夹 Tab ====================
        async buildFavTab(container) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px;">正在加载收藏夹列表...</div>';

            // 探测 API
            const apiBase = await this.probeFavApi();
            if (!apiBase) {
                container.innerHTML = '<div style="padding:30px 20px;text-align:center;color:#999;font-size:13px;">❌ 无法获取收藏夹列表（API 不可用）</div>';
                return;
            }

            try {
                const collections = [];
                let offset = 0;
                while (true) {
                    const params = new URLSearchParams({
                        include: 'data[*].id,title,description,updated_time,item_count,followers_count,is_public',
                        limit: '20', offset: String(offset),
                    });
                    const resp = await fetch(apiBase + '?' + params.toString());
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const data = await resp.json();
                    if (!data.data || !data.data.length) break;
                    collections.push(...data.data);
                    if (data.paging?.is_end) break;
                    offset += 20;
                    await Util.sleep(CONFIG.apiDelay);
                }
                this.collections = collections;
                this.renderFavTab(container, collections);
            } catch (err) {
                container.innerHTML = '<div style="padding:30px 20px;text-align:center;color:#999;font-size:13px;">❌ 获取收藏夹失败: ' + err.message + '</div>';
            }
        },

        probeFavApi: async function () {
            const token = this.urlToken;
            const candidates = [
                '/api/v4/people/' + token + '/collections',
                '/api/v4/members/' + token + '/collections',
            ];
            for (const url of candidates) {
                try {
                    const r = await fetch(url + '?limit=1&offset=0');
                    if (r.ok || r.status === 403) return url;
                } catch {}
            }
            return null;
        },

        renderFavTab(container, collections) {
            container.innerHTML = '';

            // 选项
            const opts = container.appendChild(document.createElement('div'));
            Object.assign(opts.style, { padding: '12px 20px', borderBottom: '1px solid #f0f0f0' });

            // 组织方式
            const orgLabel = opts.appendChild(document.createElement('div'));
            orgLabel.textContent = '文件组织方式';
            Object.assign(orgLabel.style, { fontSize: '12px', color: '#666', marginBottom: '6px' });

            const makeRadio = (name, val, label, checked) => {
                const w = opts.appendChild(document.createElement('label'));
                Object.assign(w.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '14px', cursor: 'pointer', fontSize: '12px', color: '#333' });
                const rb = w.appendChild(document.createElement('input'));
                rb.type = 'radio'; rb.name = name; rb.value = val; rb.checked = !!checked;
                Object.assign(rb.style, { accentColor: '#0066FF' });
                w.appendChild(document.createTextNode(label));
                return w;
            };
            makeRadio('fav-org', 'flat', '不分类', true);
            makeRadio('fav-org', 'folder', '按收藏夹分类');

            // ZIP 打包
            const zipDiv = opts.appendChild(document.createElement('div'));
            Object.assign(zipDiv.style, { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #f0f0f0' });
            const zipLabel = zipDiv.appendChild(document.createElement('label'));
            Object.assign(zipLabel.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#333' });
            const zipCb = zipLabel.appendChild(document.createElement('input'));
            zipCb.type = 'checkbox'; zipCb.id = 'fav-zip'; zipCb.checked = true;
            Object.assign(zipCb.style, { width: '14px', height: '14px', accentColor: '#0066FF' });
            zipLabel.appendChild(document.createTextNode('打包为 ZIP（更快）'));
            const zipHint = zipDiv.appendChild(document.createElement('div'));
            zipHint.textContent = '所有文件打包成一个 ZIP，大幅提升下载速度';
            Object.assign(zipHint.style, { fontSize: '11px', color: '#bbb', marginTop: '2px', marginLeft: '20px' });

            this.appendLinkStyle(container);

            // 收藏夹列表标题
            const listHeader = container.appendChild(document.createElement('div'));
            Object.assign(listHeader.style, {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 20px 6px', fontSize: '13px', fontWeight: 600,
            });
            listHeader.innerHTML = '<span>选择收藏夹</span>';

            const btnGrp = listHeader.appendChild(document.createElement('div'));
            ['全选', '取消全选'].forEach((txt, i) => {
                const a = btnGrp.appendChild(document.createElement('a'));
                a.textContent = txt;
                Object.assign(a.style, { fontSize: '12px', color: i === 0 ? '#0066FF' : '#999', cursor: 'pointer', marginLeft: '12px' });
                a.onclick = () => {
                    container.querySelectorAll('input[data-fav]').forEach(cb => cb.checked = i === 0);
                };
            });

            // 列表
            const listDiv = container.appendChild(document.createElement('div'));
            Object.assign(listDiv.style, { padding: '0 20px 8px', maxHeight: '240px', overflowY: 'auto' });

            const total = collections.reduce((s, c) => s + (c.item_count || 0), 0);

            // "全部收藏" 特殊项
            const allW = this.favItem('__all__', '📦 全部收藏', '所有收藏夹内容合集', total, true, container);
            listDiv.appendChild(allW);

            const sep = listDiv.appendChild(document.createElement('div'));
            Object.assign(sep.style, { height: '1px', background: '#f0f0f0', margin: '4px 0' });

            collections.forEach(c => {
                listDiv.appendChild(this.favItem(c.id, '📁 ' + (c.title || '未命名'), c.description || '', c.item_count || 0, false, container));
            });

            // 同步全部收藏状态
            const allCb = container.querySelector('input[data-fav="__all__"]');
            if (allCb?.checked) {
                container.querySelectorAll('input[data-fav]').forEach(cb => cb.checked = true);
            }

            // 导出按钮
            const btnDiv = container.appendChild(document.createElement('div'));
            Object.assign(btnDiv.style, { padding: '6px 20px 14px' });
            const btn = btnDiv.appendChild(document.createElement('button'));
            btn.textContent = '🚀 开始导出';
            Object.assign(btn.style, {
                width: '100%', padding: '10px', background: 'linear-gradient(135deg,#0066FF,#1a8cff)',
                color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            });
            btn.onclick = () => this.startFavExport();
        },

        favItem(id, title, desc, count, checked, container) {
            const w = document.createElement('label');
            Object.assign(w.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', cursor: 'pointer', fontSize: '12px', color: '#333' });
            const cb = w.appendChild(document.createElement('input'));
            cb.type = 'checkbox'; cb.dataset.fav = id; cb.checked = checked;
            Object.assign(cb.style, { width: '14px', height: '14px', accentColor: '#0066FF', flexShrink: 0 });

            const txt = w.appendChild(document.createElement('div'));
            txt.style.flex = '1';
            const titleEl = txt.appendChild(document.createElement('div'));
            titleEl.textContent = title;
            if (id === '__all__') titleEl.style.fontWeight = 600;
            titleEl.style.fontSize = '12px';
            if (desc) {
                const d = txt.appendChild(document.createElement('div'));
                d.textContent = desc.length > 50 ? desc.substring(0, 50) + '…' : desc;
                Object.assign(d.style, { fontSize: '11px', color: '#999', marginTop: '1px' });
            }
            const cnt = w.appendChild(document.createElement('span'));
            cnt.textContent = count + ' 项';
            Object.assign(cnt.style, { fontSize: '11px', color: '#bbb', flexShrink: 0 });

            if (id === '__all__') {
                cb.onchange = () => {
                    container.querySelectorAll('input[data-fav]').forEach(c => c.checked = cb.checked);
                };
            }
            return w;
        },

        // ==================== 问题页 UI ====================
        buildQuestionUI(container) {
            const opts = container.appendChild(document.createElement('div'));
            Object.assign(opts.style, { padding: '14px 20px 10px' });

            const sortLabel = opts.appendChild(document.createElement('div'));
            sortLabel.textContent = '回答排序方式';
            Object.assign(sortLabel.style, { fontSize: '12px', color: '#666', marginBottom: '8px' });

            const makeRadio = (name, val, label, checked) => {
                const w = opts.appendChild(document.createElement('label'));
                Object.assign(w.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '14px', cursor: 'pointer', fontSize: '13px', color: '#333' });
                const rb = w.appendChild(document.createElement('input'));
                rb.type = 'radio'; rb.name = name; rb.value = val; rb.checked = !!checked;
                Object.assign(rb.style, { accentColor: '#7B2FF7' });
                w.appendChild(document.createTextNode(label));
            };
            makeRadio('q-sort', 'default', '🔥 按热度', true);
            makeRadio('q-sort', 'created', '🕐 按时间');

            const detailW = opts.appendChild(document.createElement('label'));
            Object.assign(detailW.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0 2px', cursor: 'pointer', fontSize: '13px', color: '#333', borderTop: '1px solid #f0f0f0', marginTop: '8px' });
            const detailCb = detailW.appendChild(document.createElement('input'));
            detailCb.type = 'checkbox'; detailCb.id = 'exp-q-detail'; detailCb.checked = true;
            Object.assign(detailCb.style, { width: '15px', height: '15px', accentColor: '#7B2FF7' });
            detailW.appendChild(document.createTextNode('📃 包含问题描述'));

            this.appendLinkStyle(container);

            const btnDiv = container.appendChild(document.createElement('div'));
            Object.assign(btnDiv.style, { padding: '6px 20px 14px' });
            const btn = btnDiv.appendChild(document.createElement('button'));
            btn.id = 'zh-q-btn';
            btn.textContent = '🚀 开始导出';
            Object.assign(btn.style, {
                width: '100%', padding: '10px', background: 'linear-gradient(135deg,#7B2FF7,#9B59B6)',
                color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            });
            // onclick set in buildUI after element exists
        },

        // ==================== 共享 UI 组件 ====================
        appendLinkStyle(parent) {
            const div = parent.appendChild(document.createElement('div'));
            Object.assign(div.style, { padding: '8px 20px 4px', borderTop: '1px solid #f0f0f0' });
            const label = div.appendChild(document.createElement('div'));
            label.textContent = '链接风格';
            Object.assign(label.style, { fontSize: '12px', color: '#666', marginBottom: '4px' });

            const makeRadio = (val, lbl, checked) => {
                const w = div.appendChild(document.createElement('label'));
                Object.assign(w.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '14px', cursor: 'pointer', fontSize: '12px', color: '#333' });
                const rb = w.appendChild(document.createElement('input'));
                rb.type = 'radio'; rb.name = 'exp-link'; rb.value = val; rb.checked = !!checked;
                Object.assign(rb.style, { accentColor: '#0066FF' });
                w.appendChild(document.createTextNode(lbl));
            };
            makeRadio('obsidian', 'Obsidian', true);
            makeRadio('standard', '通用 Markdown');
        },

        setProg(pct, text, stage) {
            const bar = document.getElementById('zh-prog-bar');
            const pText = document.getElementById('zh-prog-text');
            const pStage = document.getElementById('zh-prog-stage');
            if (bar) bar.style.width = pct + '%';
            if (pText && text) pText.textContent = text;
            if (pStage && stage !== undefined) pStage.textContent = stage;
        },

        showProg(show) {
            const prog = document.getElementById('zh-prog');
            if (prog) prog.style.display = show ? 'block' : 'none';
        },

        // ===================================================================
        //  导出：答主内容
        // ===================================================================
        async startPersonExport() {
            this.aborted = false;
            this.stats = { answers: 0, articles: 0, pins: 0 };

            const types = ['answers', 'articles', 'pins'];
            const checked = {};
            types.forEach(t => { checked[t] = document.getElementById('exp-' + t)?.checked || false; });
            if (!Object.values(checked).some(Boolean)) { alert('请至少选择一种内容类型！'); return; }

            this.showProg(true);
            this.setProg(0, '正在获取用户信息...', '');

            try {
                const resp = await fetch('/api/v4/members/' + this.urlToken + '?include=' + encodeURIComponent('answer_count,articles_count,pins_count,name,headline,description,follower_count'));
                if (!resp.ok) throw new Error('获取用户信息失败: ' + resp.status);
                const user = await resp.json();
                const author = user.name || this.urlToken;

                const totalTasks = (checked.answers ? (user.answer_count || 0) : 0) + (checked.articles ? (user.articles_count || 0) : 0) + (checked.pins ? (user.pins_count || 0) : 0);
                let processed = 0;
                const allAnswers = [], allArticles = [], allPins = [];

                if (checked.answers) {
                    this.setProg(0, '正在导出回答...', '0 / ' + (user.answer_count || '?'));
                    const items = await this.fetchPaged('/api/v4/members/' + this.urlToken + '/answers', { include: 'data[*].content,voteup_count,created_time,updated_time,comment_count,question.title', limit: 20, sort_by: 'created' }, c => {
                        processed++;
                        this.setProg(Math.min(processed / totalTasks * 100, 100).toFixed(1), '正在导出回答...', c + ' / ' + (user.answer_count || '?'));
                    });
                    allAnswers.push(...items);
                    this.stats.answers = allAnswers.length;
                }
                if (checked.articles) {
                    this.setProg((processed / totalTasks * 100).toFixed(1), '正在导出文章...', '0 / ' + (user.articles_count || '?'));
                    const items = await this.fetchPaged('/api/v4/members/' + this.urlToken + '/articles', { include: 'data[*].content,voteup_count,created,updated,comment_count,title', limit: 20, sort_by: 'created' }, c => {
                        processed++;
                        this.setProg(Math.min(processed / totalTasks * 100, 100).toFixed(1), '正在导出文章...', c + ' / ' + (user.articles_count || '?'));
                    });
                    allArticles.push(...items);
                    this.stats.articles = allArticles.length;
                }
                if (checked.pins) {
                    this.setProg((processed / totalTasks * 100).toFixed(1), '正在导出想法...', '0 / ' + (user.pins_count || '?'));
                    const items = await this.fetchPaged('/api/v4/members/' + this.urlToken + '/pins', { limit: 20 }, c => {
                        processed++;
                        this.setProg(Math.min(processed / totalTasks * 100, 100).toFixed(1), '正在导出想法...', c + ' / ' + (user.pins_count || '?'));
                    });
                    allPins.push(...items);
                    this.stats.pins = allPins.length;
                }

                if (this.aborted) { this.setProg(0, '已取消'); this.showProg(false); return; }

                this.setProg(98, '正在生成 Markdown...', '');
                const md = this.genPersonMD(author, user, allAnswers, allArticles, allPins);
                const name = Util.safeFilename(author) + '_知乎内容合集.md';
                this.downloadSingle(md, name);

                this.setProg(100, '✅ 完成！', '回答:' + this.stats.answers + ' 文章:' + this.stats.articles + ' 想法:' + this.stats.pins);
            } catch (err) {
                console.error(err);
                this.setProg(0, '❌ 失败: ' + err.message, '');
            }
            setTimeout(() => this.showProg(false), 5000);
        },

        genPersonMD(author, user, answers, articles, pins) {
            const L = [], now = new Date().toLocaleString('zh-CN');
            if (CONFIG.addFrontmatter) {
                L.push('---', 'title: "' + Util.escapeYaml(author) + ' - 知乎内容合集"', 'author: "' + Util.escapeYaml(author) + '"', 'source: https://www.zhihu.com/people/' + this.urlToken, 'export_date: "' + now + '"', 'total_answers: ' + this.stats.answers, 'total_articles: ' + this.stats.articles, 'total_pins: ' + this.stats.pins, 'tags:', '  - 知乎导出', '  - ' + author, '---', '');
            }
            L.push('# ' + author + ' · 知乎内容合集', '');
            const callout = CONFIG.useCallout ? '> [!info] 导出信息\n> **作者主页**：[' + author + '](https://www.zhihu.com/people/' + this.urlToken + ')' + (user.headline ? '\n> **个人简介**：' + user.headline : '') + '\n> **导出时间**：' + now + '\n> **统计**：回答 ' + this.stats.answers + ' · 文章 ' + this.stats.articles + ' · 想法 ' + this.stats.pins : '> **作者**：[' + author + '](https://www.zhihu.com/people/' + this.urlToken + ')' + (user.headline ? ' · ' + user.headline : '') + '\n> **导出**：' + now + ' | 回答 ' + this.stats.answers + ' · 文章 ' + this.stats.articles + ' · 想法 ' + this.stats.pins;
            L.push(callout, '', '---', '');

            // 目录
            L.push('## 📑 目录', '');
            const sections = [
                { items: answers, label: '回答', key: 'answer' },
                { items: articles, label: '文章', key: 'article' },
                { items: pins, label: '想法', key: 'pin' },
            ];
            sections.forEach(({ items, label, key }) => {
                if (!items.length) return;
                L.push('### ' + label + '（' + items.length + '）', '');
                items.forEach((a, i) => {
                    const t = key === 'answer' ? (a.question?.title || '无标题') : key === 'article' ? (a.title || '无标题') : '想法 ' + (i + 1);
                    const h = key + '-' + i;
                    L.push(Util.tocLink(i + 1, t, h));
                });
                L.push('');
            });
            L.push('---', '');

            // 内容
            sections.forEach(({ items, label, key }) => {
                if (!items.length) return;
                L.push('## ' + (key === 'answer' ? '📝' : key === 'article' ? '📄' : '💬') + ' ' + label, '');
                items.forEach((a, i) => {
                    const t = key === 'answer' ? (a.question?.title || '无标题') : key === 'article' ? (a.title || '无标题') : '想法 ' + (i + 1);
                    L.push('### ' + key + '-' + i + '：' + t, '');
                    if (key === 'pin') {
                        L.push(this.pinBlock(a));
                    } else {
                        const ts = key === 'article' ? a.created : a.created_time;
                        const tu = key === 'article' ? a.updated : a.updated_time;
                        const url = key === 'answer' ? (a.question?.id && a.id ? 'https://www.zhihu.com/question/' + a.question.id + '/answer/' + a.id : '') : (a.id ? 'https://zhuanlan.zhihu.com/p/' + a.id : '');
                        const callout = CONFIG.useCallout ? '> [!note]- 元信息\n> 📅 ' + Util.fmtDate(ts) + (tu ? ' · 更新：' + Util.fmtDate(tu) : '') + '\n> 👍 ' + (a.voteup_count ?? '-') + ' · 💬 ' + (a.comment_count ?? '-') + (url ? '\n> 🔗 [查看原文](' + url + ')' : '') : '> 📅 ' + Util.fmtDate(ts) + (tu ? '（更新: ' + Util.fmtDate(tu) + '）' : '') + ' | 👍 ' + (a.voteup_count ?? '-') + ' | 💬 ' + (a.comment_count ?? '-') + (url ? ' | [原文](' + url + ')' : '');
                        L.push(callout, '', Util.html2md(a.content || '*（内容为空）*'), '', '---', '');
                    }
                });
            });
            L.push('', '> 由知乎内容导出工具自动生成');
            return L.join('\n');
        },

        pinBlock(pin) {
            const parts = [];
            try {
                if (Array.isArray(pin.content)) {
                    pin.content.forEach(b => {
                        if (b.type === 'text') parts.push(Util.html2md(b.content || b.own_text || ''));
                        else if (b.type === 'image') { const u = (b.url || b.original_url || '').replace(/^\/\//, 'https:'); if (u) parts.push('![](' + u + ')'); }
                        else if (b.type === 'video') parts.push('[🎬 视频](' + (b.url || '') + ')');
                        else if (b.type === 'link') parts.push('[🔗 ' + (b.title || '链接') + '](' + (b.url || '') + ')');
                    });
                } else if (typeof pin.content === 'string') parts.push(Util.html2md(pin.content));
                if (pin.origin_pin) {
                    const oa = pin.origin_pin.author?.name || '未知';
                    parts.push('', '> **转发自** ' + oa + '：\n> ' + this.pinBlock(pin.origin_pin).replace(/\n/g, '\n> '));
                }
            } catch { parts.push('*（解析失败）*'); }
            const d = pin.created ? Util.fmtDate(pin.created) : '未知';
            return '> 📅 ' + d + ' | ❤️ ' + (pin.like_count || pin.reaction_count || 0) + ' | 💬 ' + (pin.comment_count || 0) + '\n\n' + parts.join('\n\n');
        },

        // ===================================================================
        //  导出：问题回答
        // ===================================================================
        async startQuestionExport() {
            this.aborted = false;
            const sortEl = document.querySelector('input[name="q-sort"]:checked');
            const sortBy = sortEl?.value || 'default';
            const includeDetail = document.getElementById('exp-q-detail')?.checked !== false;

            this.showProg(true);
            this.setProg(0, '正在获取问题信息...', '');

            try {
                const qResp = await fetch('/api/v4/questions/' + this.questionId + '?include=' + encodeURIComponent('detail,answer_count,comment_count,follower_count,title,created,updated_time'));
                if (!qResp.ok) throw new Error('获取问题失败: ' + qResp.status);
                const q = await qResp.json();
                const qTitle = q.title || '未知问题';

                this.setProg(5, '正在导出回答...', '0 / ' + (q.answer_count || 0));

                const answers = await this.fetchPaged('/api/v4/questions/' + this.questionId + '/answers', {
                    include: 'data[*].content,voteup_count,created_time,updated_time,comment_count,author.name,author.headline,author.url_token',
                    limit: 20, sort_by: sortBy,
                }, count => {
                    const pct = q.answer_count > 0 ? 5 + (count / q.answer_count) * 90 : 50;
                    this.setProg(pct.toFixed(1), '正在导出回答...', count + ' / ' + q.answer_count);
                });

                if (this.aborted) { this.setProg(0, '已取消'); this.showProg(false); return; }

                this.setProg(96, '正在生成 Markdown...', '');
                const md = this.genQuestionMD(q, answers, includeDetail, sortBy);
                const name = Util.safeFilename(qTitle) + '_' + answers.length + '个回答.md';
                this.downloadSingle(md, name);

                this.setProg(100, '✅ 完成！', '共 ' + answers.length + ' 个回答');
            } catch (err) {
                console.error(err);
                this.setProg(0, '❌ 失败: ' + err.message, '');
            }
            setTimeout(() => this.showProg(false), 5000);
        },

        genQuestionMD(q, answers, includeDetail, sortBy) {
            const L = [], now = new Date().toLocaleString('zh-CN');
            const qUrl = 'https://www.zhihu.com/question/' + this.questionId;
            if (CONFIG.addFrontmatter) {
                L.push('---', 'title: "' + Util.escapeYaml(q.title || '') + '"', 'source: ' + qUrl, 'export_date: "' + now + '"', 'answer_count: ' + answers.length, 'sort_by: ' + sortBy, 'tags:', '  - 知乎导出', '  - 知乎问题', '---', '');
            }
            L.push('# ' + (q.title || '未知问题'), '');
            L.push('> **问题**：[' + (q.title || '') + '](' + qUrl + ')\n> **回答**：' + answers.length + ' | **排序**：' + (sortBy === 'created' ? '按时间' : '按热度') + ' | **导出**：' + now + (q.follower_count ? ' | **关注**：' + q.follower_count : ''), '', '---', '');
            if (includeDetail && q.detail) L.push('## 📃 问题描述', '', Util.html2md(q.detail), '', '---', '');
            L.push('## 📑 目录（' + answers.length + ' 个回答）', '');
            answers.forEach((a, i) => {
                const name = a.author?.name || '匿名';
                const h = '回答-' + i;
                L.push(Util.tocLink(i + 1, name + '（👍' + (a.voteup_count ?? 0) + '）', h));
            });
            L.push('', '---', '', '## 📝 全部回答', '');
            answers.forEach((a, i) => {
                const name = a.author?.name || '匿名';
                const token = a.author?.url_token || '';
                const headline = a.author?.headline || '';
                const url = a.id ? 'https://www.zhihu.com/question/' + this.questionId + '/answer/' + a.id : '';
                L.push('### 回答-' + i + '：' + name, '');
                L.push('> **[' + name + '](https://www.zhihu.com/people/' + token + ')**' + (headline ? ' · ' + headline : '') + '\n> 📅 ' + Util.fmtDate(a.created_time) + (a.updated_time ? '（更新: ' + Util.fmtDate(a.updated_time) + '）' : '') + ' | 👍 ' + (a.voteup_count ?? '-') + ' | 💬 ' + (a.comment_count ?? '-') + (url ? ' | [原文](' + url + ')' : ''), '', Util.html2md(a.content || '*（内容为空）*'), '', '---', '');
            });
            L.push('', '> 由知乎内容导出工具自动生成');
            return L.join('\n');
        },

        // ===================================================================
        //  导出：收藏夹
        // ===================================================================
        startFavExport() {
            this.aborted = false;

            const orgRb = document.querySelector('input[name="fav-org"]:checked');
            const byFolder = orgRb?.value === 'folder';

            // 获取选中的收藏夹 ID
            const cbs = document.querySelectorAll('#tab-fav input[data-fav]');
            const allCb = document.querySelector('#tab-fav input[data-fav="__all__"]');
            let selectedIds = [];
            if (allCb?.checked) {
                cbs.forEach(cb => { const id = cb.dataset.fav; if (id && id !== '__all__') selectedIds.push(id); });
            } else {
                cbs.forEach(cb => { if (cb.checked) { const id = cb.dataset.fav; if (id && id !== '__all__') selectedIds.push(id); } });
            }
            if (!selectedIds.length) { alert('请至少选择一个收藏夹！'); return; }

            const cols = this.collections.filter(c => selectedIds.includes(String(c.id)));
            if (!cols.length) { alert('未找到选中的收藏夹'); return; }

            this.showProg(true);
            this.setProg(0, '正在获取收藏内容...', '');
            this.startFavExportInner(cols, byFolder);
        },

        async startFavExportInner(collections, byFolder) {
            try {
                // ---- 第一步：并发获取内容 ----
                const allItems = [];
                const queue = [...collections];
                let apiDone = 0;

                const workers = [];
                for (let i = 0; i < Math.min(CONFIG.apiConcurrency, queue.length); i++) {
                    workers.push((async () => {
                        while (queue.length > 0 && !this.aborted) {
                            const col = queue.shift();
                            const items = await this.fetchFavItems(col.id);
                            items.forEach(item => allItems.push({ collection: col, collectionTitle: col.title || '未命名', item }));
                            apiDone++;
                            this.setProg((apiDone / collections.length * 5).toFixed(1), '正在获取收藏内容...', apiDone + ' / ' + collections.length + ' 个收藏夹');
                            await Util.sleep(CONFIG.apiDelay);
                        }
                    })());
                }
                await Promise.all(workers);
                if (this.aborted) { this.setProg(0, '已取消'); this.showProg(false); return; }

                // ---- 调试：打印第一个条目的原始结构（看 API 实际返回什么） ----
                if (allItems.length > 0) {
                    console.log('[zhihu-exporter] 收藏夹 API 返回的首个条目结构（用于调试）:',
                        JSON.stringify(allItems[0].item, (k, v) => k === 'content' ? '(content length=' + (typeof v === 'string' ? v.length : typeof v) + ')' : v, 2));
                    // 如果 content 为空/非字符串，额外提示
                    const c = allItems[0].item.content;
                    if (!c || typeof c !== 'string' || c.trim().length < 50) {
                        console.warn('[zhihu-exporter] ⚠️ content 字段缺失或过短，将尝试从独立 API 补全');
                    }
                }

                const total = allItems.length;
                this.setProg(5, '正在补全文章内容...', '');

                // ---- 第二步：补全缺少内容的项 ----
                const needContent = allItems.filter(e => !e.item.content || (typeof e.item.content === 'string' && e.item.content.trim().length < 50));
                if (needContent.length) {
                    const cq = [...needContent];
                    let cfetched = 0;
                    const cWorkers = [];
                    for (let i = 0; i < Math.min(CONFIG.apiConcurrency, cq.length); i++) {
                        cWorkers.push((async () => {
                            while (cq.length > 0 && !this.aborted) {
                                const entry = cq.shift();
                                await this.fetchItemFullContent(entry);
                                cfetched++;
                                this.setProg((5 + (cfetched / needContent.length) * 10).toFixed(1), '正在补全内容...', cfetched + ' / ' + needContent.length);
                                await Util.sleep(CONFIG.apiDelay);
                            }
                        })());
                    }
                    await Promise.all(cWorkers);
                }
                if (this.aborted) { this.setProg(0, '已取消'); this.showProg(false); return; }

                // ---- 第三步：生成文件 ----
                this.setProg(16, '正在生成 Markdown...', '0 / ' + total);
                const files = [];
                const usedNames = new Set();
                allItems.forEach((entry, idx) => {
                    if (this.aborted) return;
                    const md = this.favItemToMD(entry);
                    const slug = Util.safeFilename(this.favTitle(entry.item));
                    const prefix = byFolder ? Util.safeFilename(entry.collectionTitle) + ' - ' : '';
                    let fn = prefix + slug + '.md';
                    if (!fn.replace('.md', '').trim()) fn = 'zhihu_' + idx + '.md';
                    if (usedNames.has(fn)) { let c = 1; while (usedNames.has(fn.replace('.md', '_' + c + '.md'))) c++; fn = fn.replace('.md', '_' + c + '.md'); }
                    usedNames.add(fn);
                    files.push({ filename: fn, content: md });
                });
                if (this.aborted) { this.setProg(0, '已取消'); this.showProg(false); return; }

                // ---- 第四步：下载 ----
                const useZip = document.getElementById('fav-zip')?.checked;
                if (useZip) {
                    this.setProg(18, '正在打包 ZIP...', '');
                    await this.downloadZip(files);
                    this.setProg(100, '✅ 完成！', 'ZIP 包共 ' + files.length + ' 个文件');
                } else {
                    this.setProg(18, '正在下载...', '0 / ' + files.length);
                    const blobs = files.map(f => ({ filename: f.filename, url: URL.createObjectURL(new Blob([f.content], { type: 'text/markdown;charset=utf-8' })) }));
                    for (let i = 0; i < blobs.length && !this.aborted; i++) {
                        const a = document.createElement('a');
                        a.href = blobs[i].url; a.download = blobs[i].filename;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        if (i % 5 === 4) await Util.sleep(100);
                        this.setProg((18 + ((i + 1) / blobs.length) * 80).toFixed(1), '正在下载...', (i + 1) + ' / ' + blobs.length);
                    }
                    setTimeout(() => blobs.forEach(b => URL.revokeObjectURL(b.url)), 30000);
                    this.setProg(100, '✅ 完成！', '共 ' + files.length + ' 个文件');
                }
            } catch (err) {
                console.error(err);
                this.setProg(0, '❌ 失败: ' + err.message, '');
            }
            setTimeout(() => this.showProg(false), 8000);
        },

        async fetchFavItems(collectionId) {
            const items = [];
            let offset = 0;
            while (true) {
                if (this.aborted) break;
                // 收藏夹 API 本身不返回完整 content，只取元数据用于后续独立获取
                const params = new URLSearchParams({
                    include: 'data[*].type,question.id,question.title,title,url,author.name,author.url_token,id,voteup_count,created_time,updated_time,comment_count',
                    limit: '20', offset: String(offset),
                });
                const resp = await fetch('/api/v4/collections/' + collectionId + '/items?' + params.toString());
                if (!resp.ok) {
                    if (resp.status === 429) { await Util.sleep(3000); continue; }
                    break;
                }
                const data = await resp.json();
                if (!data.data?.length) break;
                items.push(...data.data);
                if (data.paging?.is_end) break;
                offset += 20;
                await Util.sleep(CONFIG.apiDelay);
            }
            return items;
        },

        /** 从 URL 中提取回答或文章 ID（比依赖 API 字段更可靠） */
        extractIdsFromUrl(item) {
            const result = { qid: null, aid: null, articleId: null };
            if (!item.url) return result;
            const url = item.url.startsWith('http') ? item.url : 'https://www.zhihu.com' + item.url;
            // /question/{qid}/answer/{aid}
            const am = url.match(/\/question\/(\d+)\/answer\/(\d+)/);
            if (am) { result.qid = am[1]; result.aid = am[2]; return result; }
            // /p/{articleId} (专栏文章)
            const pm = url.match(/\/p\/(\d+)/);
            if (pm) { result.articleId = pm[1]; return result; }
            return result;
        },

        async fetchItemFullContent(entry) {
            const item = entry.item;
            if (!item) return;

            // ---- 优先从 URL 提取 ID（最可靠） ----
            const { qid, aid, articleId } = this.extractIdsFromUrl(item);

            // ---- 回答：用导出回答的同款 API ----
            const realQid = qid || item.question?.id;
            const realAid = aid || item.id;
            if (realQid && realAid) {
                try {
                    const r = await fetch(`/api/v4/questions/${realQid}/answers/${realAid}?include=content`);
                    if (r.ok) {
                        const d = await r.json();
                        if (d && typeof d.content === 'string' && d.content.length > 200) {
                            item.content = d.content;
                            return;
                        }
                    }
                } catch { /* 静默 */ }
                await Util.sleep(200);
            }

            // ---- 专栏文章 ----
            if (articleId || item.id) {
                const id = articleId || item.id;
                try {
                    const r = await fetch(`/api/v4/articles/${id}?include=content`);
                    if (r.ok) {
                        const d = await r.json();
                        if (d && typeof d.content === 'string' && d.content.length > 200) {
                            item.content = d.content;
                            if (!item.title && d.title) item.title = d.title;
                            return;
                        }
                    }
                } catch { /* 静默 */ }
                await Util.sleep(200);
            }

            // ---- 最后手段：直接抓取页面 ----
            if (item.url) {
                try {
                    const url = item.url.startsWith('http') ? item.url : 'https://www.zhihu.com' + item.url;
                    const r = await fetch(url, { headers: { 'Accept': 'text/html' } });
                    if (r.ok) {
                        const html = await r.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const el = doc.querySelector('.RichText, .Post-RichText, .AnswerCard .RichText, .ContentItem-content');
                        if (el && el.innerHTML.trim().length > 200) {
                            item.content = el.innerHTML;
                        }
                    }
                } catch { /* 静默 */ }
            }
        },

        favTitle(item) {
            if (item.question?.title) return item.question.title;
            if (item.title) return item.title;
            // 尝试从 content 中提取 h1
            if (item.content) {
                const str = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
                const m = str.match(/<h1[^>]*>(.*?)<\/h1>/i);
                if (m) return m[1].replace(/<[^>]*>/g, '').trim();
                // 尝试从 content 取前 40 字作为标题
                const text = str.replace(/<[^>]*>/g, '').trim();
                if (text.length > 10) return text.substring(0, 40) + (text.length > 40 ? '…' : '');
            }
            return '知乎内容_' + (item.id || item.content_id || Date.now());
        },

        favItemToMD(entry) {
            const item = entry.item;
            const L = [], now = new Date().toLocaleString('zh-CN');
            const title = this.favTitle(item);
            const author = item.author?.name || '';
            const url = item.question?.id && item.id ? 'https://www.zhihu.com/question/' + item.question.id + '/answer/' + item.id : (item.url ? (item.url.startsWith('http') ? item.url : 'https://www.zhihu.com' + item.url) : (item.id && item.type === 'article' ? 'https://zhuanlan.zhihu.com/p/' + item.id : 'https://www.zhihu.com'));
            const created = Util.fmtDate(item.created_time || item.created);
            const votes = item.voteup_count ?? item.vote_count ?? 0;
            const comments = item.comment_count ?? 0;

            if (CONFIG.addFrontmatter) {
                L.push('---', 'title: "' + Util.escapeYaml(title) + '"', 'author: "' + Util.escapeYaml(author) + '"', 'source: "' + url + '"', 'collection: "' + Util.escapeYaml(entry.collectionTitle) + '"', 'export_date: "' + now + '"', 'created: "' + created + '"', 'votes: ' + votes, 'comments: ' + comments, 'tags:', '  - 知乎导出', '  - ' + entry.collectionTitle, '---', '');
            }
            L.push('# ' + title, '');
            let meta = '> ';
            if (author) meta += '**作者**: ' + author + ' · ';
            meta += '📅 ' + created + ' · 👍 ' + votes + ' · 💬 ' + comments;
            L.push(meta, '> **来源**: [' + (title.length > 50 ? title.substring(0, 50) + '…' : title) + '](' + url + ')', '> **收藏夹**: ' + entry.collectionTitle, '', '---', '', Util.html2md(Util.contentString(item.content) || '*（内容为空）*'), '', '---', '> 由知乎收藏夹导出工具生成 · [查看原文](' + url + ')');
            return L.join('\n');
        },

        downloadZip(files) {
            return new Promise((resolve, reject) => {
                const JSZip = window.JSZip;
                if (!JSZip) { this.downloadZipFallback(files); resolve(); return; }
                const zip = new JSZip();
                files.forEach(f => zip.file(f.filename, f.content));
                zip.generateAsync({ type: 'blob' }).then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = '知乎收藏夹_' + new Date().toISOString().slice(0, 10) + '.zip';
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                    resolve();
                }).catch(reject);
            });
        },

        downloadZipFallback(files) {
            // JSZip 未加载时的降级：下载第一个文件
            if (!files.length) return;
            const f = files[0];
            const blob = new Blob([f.content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = f.filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        },

        downloadSingle(content, filename) {
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        },

        // ===================================================================
        //  通用：分页请求
        // ===================================================================
        async fetchPaged(baseUrl, params, onItem) {
            const all = [];
            let offset = 0, limit = params.limit || 20, count = 0;
            while (true) {
                if (this.aborted) break;
                const p = new URLSearchParams({ ...params, offset: String(offset), limit: String(limit) });
                const resp = await fetch(baseUrl + '?' + p.toString());
                if (!resp.ok) {
                    if (resp.status === 429) { await Util.sleep(3000); continue; }
                    break;
                }
                const data = await resp.json();
                if (!data.data?.length) break;
                data.data.forEach(item => { all.push(item); count++; if (onItem) onItem(count); });
                if (data.paging?.is_end) break;
                offset += limit;
                await Util.sleep(CONFIG.apiDelay);
            }
            return all;
        },
    };

    // ===================================================================
    //  启动
    // ===================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }
})();
