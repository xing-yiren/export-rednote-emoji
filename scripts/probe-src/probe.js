/* P0 探针：在页面主框架 isolated world 中运行。
   1) 定位评论容器并输出 DOM 结构摘要
   2) 列出评论正文中的图片节点（排除头像），抓取 candidate URL
   3) 对候选 URL 执行 fetch，检查状态、Content-Type、字节签名、尺寸、动画
   4) 汇总输出到页面底部面板，并可通过 downloads API 保存 JSON */
(async () => {
  if (window.__rednoteProbeDone) return;
  window.__rednoteProbeDone = true;

  const report = { url: location.href, title: document.title, startedAt: new Date().toISOString(), containers: [], media: [], fetchResults: [], notes: [] };

  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes: [...el.classList].slice(0, 8),
    attrs: [...el.attributes].filter(a => !/^src(set)?$|^style$/.test(a.name)).slice(0, 12).map(a => [a.name, a.value.slice(0, 160)]),
    childCount: el.children.length,
  });

  // ---- 1. 猜测评论容器：包含多个头像/评论结构且面积较大 ----
  const allImgs = [...document.images];
  const avatarLike = (img) => {
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.width <= 48 && r.height <= 48;
  };
  const score = new Map();
  for (const img of allImgs.filter(avatarLike)) {
    let p = img.parentElement;
    for (let i = 0; i < 12 && p && p !== document.body; i++, p = p.parentElement) {
      const s = (score.get(p) || 0) + 1;
      score.set(p, s);
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [el, s] of ranked) {
    const r = el.getBoundingClientRect();
    if (r.width < 200) continue;
    report.containers.push({
      score: s,
      area: Math.round(r.width) + 'x' + Math.round(r.height),
      path: pathOf(el),
      info: describe(el),
      ancestors: ancestorsOf(el, 4),
      childrenSample: [...el.children].slice(0, 4).map(c => ({ info: describe(c), signals: listSignals(c, 0) })),
    });
  }
  function pathOf(el) {
    const parts = [];
    while (el && el !== document.body && parts.length < 6) {
      parts.unshift(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map(c => '.' + c).join(''));
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function ancestorsOf(el, n) {
    const out = [];
    while (el && el !== document.body && out.length < n) { out.push(describe(el)); el = el.parentElement; }
    return out;
  }
  function listSignals(el, depth) {
    if (depth > 2) return [];
    const out = [];
    for (const c of [...el.children].slice(0, 8)) {
      out.push({ ...describe(c), kids: listSignals(c, depth + 1) });
    }
    return out;
  }

  // ---- 2. 收集全部图片元素，带位置与上下文 ----
  for (const img of allImgs) {
    const r = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    report.media.push({
      type: 'img',
      src: abs(src),
      rawSrcAttr: img.getAttribute('src')?.slice(0, 300),
      srcset: img.getAttribute('srcset')?.slice(0, 500) || undefined,
      dataAttrs: [...img.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value.slice(0, 300)]),
      naturalSize: [img.naturalWidth, img.naturalHeight],
      layoutSize: [Math.round(r.width), Math.round(r.height)],
      visible: r.width > 0 && r.height > 0,
      path: pathOf(img),
      contextText: (img.closest('[class]')?.parentElement?.innerText || '').slice(0, 120),
      parentLinks: [...(img.parentElement?.querySelectorAll('a[href]') || [])].slice(0, 3).map(a => a.getAttribute('href')),
    });
  }
  for (const v of document.querySelectorAll('video')) {
    report.media.push({ type: 'video', src: abs(v.currentSrc || v.src || ''), poster: v.poster || undefined, path: pathOf(v) });
  }
  for (const b of document.querySelectorAll('[style*="background-image"], [style*="background:"]')) {
    const bi = getComputedStyle(b).backgroundImage;
    if (bi && bi.includes('url(')) report.media.push({ type: 'background', bg: bi.slice(0, 400), path: pathOf(b) });
  }
  // 查看是否使用 canvas 渲染评论图片
  report.notes.push({ canvases: document.querySelectorAll('canvas').length, shadowRoots: document.querySelectorAll('*').length });

  // ---- 3. 对可 fetch 的图片 URL 探测字节 ----
  const urls = [...new Set(report.media.filter(m => m.type === 'img' && /^https?:/.test(m.src || '')).map(m => m.src))].slice(0, 40);
  for (const url of urls) {
    const res = { url, host: new URL(url).host };
    try {
      const t0 = performance.now();
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      res.status = resp.status;
      res.ok = resp.ok;
      res.contentType = resp.headers.get('content-type') || null;
      res.contentLength = resp.headers.get('content-length');
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      res.ms = Math.round(performance.now() - t0);
      res.byteLength = bytes.length;
      Object.assign(res, sniffFormat(bytes));
      if (res.format === 'png' || res.format === 'jpeg' || res.format === 'gif' || res.format === 'webp' || res.format === 'avif') {
        try {
          const blob = new Blob([bytes], { type: res.contentType || '' });
          const bmp = await createImageBitmap(blob);
          res.decodedSize = [bmp.width, bmp.height];
          bmp.close?.();
        } catch (e) { res.decodeError = String(e); }
      }
      res.head = [...bytes.slice(0, 24)].map(b => b.toString(16).padStart(2, '0')).join(' ');
    } catch (e) {
      res.error = String(e);
    }
    report.fetchResults.push(res);
  }
  report.finishedAt = new Date().toISOString();

  // ---- 动画嗅探：GIF NETSCAPE / WebP ANIM 已在 sniffFormat 中标记 ----
  function sniffFormat(b) {
    const ascii = (o, n) => String.fromCharCode(...b.slice(o, o + n));
    if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
      const apng = findAscii(b, 'acTL', 0, 4096);
      return { format: 'png', animated: apng ? true : false, animatedEvidence: apng ? 'acTL chunk' : 'no acTL in first 4KiB' };
    }
    if (b[0] === 0xFF && b[1] === 0xD8) return { format: 'jpeg', animated: false };
    if (ascii(0, 3) === 'GIF') {
      let frames = 0;
      for (let i = 0; i < b.length - 3 && frames < 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9) frames++;
      return { format: 'gif', animated: frames > 1, animatedEvidence: frames + ' graphic control ext' };
    }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      // 严格按 RIFF chunk 遍历，避免在二进制载荷中误匹配 'ANIM' 字样
      const u32 = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
      let pos = 12, hasAnim = false, hasVP8X = false, hasALPH = false;
      while (pos + 8 <= b.length) {
        const cc = ascii(pos, 4), size = u32(pos + 4) >>> 0;
        if (cc === 'ANIM') hasAnim = true;
        if (cc === 'VP8X') hasVP8X = true;
        if (cc === 'ALPH') hasALPH = true;
        pos += 8 + size + (size & 1);
        if (size > b.length) break;
      }
      return { format: 'webp', animated: hasAnim, animatedEvidence: hasAnim ? 'ANIM chunk' : 'no ANIM chunk', chunks: { VP8X: hasVP8X, ALPH: hasALPH } };
    }
    if (ascii(4, 4) === 'ftyp' && /avi[fs]/.test(ascii(8, 4))) return { format: 'avif', animated: null };
    const head = ascii(0, 120);
    if (head.startsWith('<svg') || head.startsWith('<?xml')) return { format: 'svg', animated: null };
    if (head.trimStart().startsWith('<')) return { format: 'html', animated: false, note: 'received HTML (likely login/error page)' };
    return { format: 'unknown', animated: null };
  }
  function findAscii(b, s, from, to) {
    const needle = [...s].map(c => c.charCodeAt(0));
    for (let i = from; i < Math.min(b.length, to) - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  // ---- 4. 输出 ----
  const json = JSON.stringify(report, null, 2);
  window.__rednoteProbeReport = json;
  showPanel(report, json);
  try {
    await navigator.clipboard.writeText(json);
  } catch { /* clipboard may require focus */ }

  function showPanel(r, text) {
    document.getElementById('__probe_panel')?.remove();
    const box = document.createElement('div');
    box.id = '__probe_panel';
    Object.assign(box.style, { position: 'fixed', right: '16px', bottom: '16px', width: '420px', maxHeight: '60vh', overflow: 'auto', background: '#111', color: '#eee', font: '12px/1.4 monospace', zIndex: 2147483647, padding: '10px', borderRadius: '8px', boxShadow: '0 4px 24px rgba(0,0,0,.5)' });
    const okCount = r.fetchResults.filter(x => x.ok).length;
    const fmtCounts = {};
    for (const x of r.fetchResults) fmtCounts[x.format || x.error ? (x.format || 'error') : 'none'] = (fmtCounts[x.format || (x.error ? 'error' : 'none')] || 0) + 1;
    box.innerHTML = `<b>Rednote Emoji Probe</b><div>容器候选: ${r.containers.length} · 图片节点: ${r.media.filter(m => m.type === 'img').length} · fetch 成功: ${okCount}/${r.fetchResults.length}</div><div>格式: ${JSON.stringify(fmtCounts)}</div><div style="margin-top:6px;white-space:pre-wrap">${r.fetchResults.slice(0, 12).map(x => `${x.status ?? 'ERR'} ${x.format ?? ''}${x.animated === true ? ' (anim)' : ''} ${x.decodedSize ? x.decodedSize.join('x') : ''} ${x.byteLength ?? ''}B ${x.host}`).join('\n')}</div>`;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap';
    const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'padding:4px 8px;cursor:pointer;background:#333;color:#eee;border:1px solid #666;border-radius:4px'; b.onclick = fn; return b; };
    bar.append(
      mk('复制 JSON', () => navigator.clipboard.writeText(text)),
      mk('下载 JSON', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = 'rednote-probe-' + Date.now() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }),
      mk('下载可选图片', async () => {
        const idx = prompt('输入要下载的 fetchResults 序号，逗号分隔:', '0');
        if (!idx) return;
        for (const i of idx.split(',').map(s => +s.trim())) {
          const x = r.fetchResults[i]; if (!x?.ok) continue;
          const a = document.createElement('a'); a.href = x.url; a.download = `probe-${i}.${x.format || 'bin'}`;
          try { const resp = await fetch(x.url); a.href = URL.createObjectURL(await resp.blob()); } catch {}
          a.click();
        }
      }),
      mk('关闭', () => box.remove()),
    );
    box.append(bar);
    document.documentElement.append(box);
  }

  console.log('[probe] done', report);
})();
