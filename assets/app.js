/* =========================================================================
 * Spark Analyzer — UI / rendering / interaction
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- small helpers ---------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (children != null) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function fmtNum(n) { n = Number(n) || 0; return n.toLocaleString('en-US'); }
  function fmtMs(ms) {
    ms = Number(ms) || 0;
    if (ms < 1000) return ms.toFixed(0) + ' ms';
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + ' s';
    const m = Math.floor(s / 60), rs = Math.round(s % 60);
    if (m < 60) return m + 'm ' + rs + 's';
    const h = Math.floor(m / 60), rm = m % 60;
    return h + 'h ' + rm + 'm';
  }
  function fmtUptime(ms) { return fmtMs(ms); }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }

  /* render markdown-ish inline links and code in a small whitelist */
  function richText(s) {
    let h = esc(s);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (m, t, u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g, (m, c) => `<code>${esc(c)}</code>`);
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  /* ---------- entity icons (CDN with offline emoji fallback) ---------- */
  const ENTITY_EMOJI = { zombie:'\uD83E\uDDDF', zombie_villager:'\uD83E\uDDDF', husk:'\uD83E\uDDDF', drowned:'\uD83E\uDDDF',
    skeleton:'\uD83D\uDC80', stray:'\uD83D\uDC80', wither_skeleton:'\uD83D\uDC80', creeper:'\uD83D\uDCA5', spider:'\uD83D\uDD77\uFE0F',
    cave_spider:'\uD83D\uDD77\uFE0F', enderman:'\uD83D\uDFEA', endermite:'\uD83D\uDFEA', villager:'\uD83E\uDDD1\u200D\uD83C\uDF3E',
    wandering_trader:'\uD83E\uDDD1\u200D\uD83C\uDF3E', iron_golem:'\uD83E\uDD16', snow_golem:'\u2603\uFE0F', cow:'\uD83D\uDC04',
    mooshroom:'\uD83D\uDC04', sheep:'\uD83D\uDC11', pig:'\uD83D\uDC16', chicken:'\uD83D\uDC14', horse:'\uD83D\uDC0E',
    donkey:'\uD83D\uDC0E', mule:'\uD83D\uDC0E', wolf:'\uD83D\uDC3A', cat:'\uD83D\uDC08', ocelot:'\uD83D\uDC08', bat:'\uD83E\uDD87',
    slime:'\uD83D\uDFE2', magma_cube:'\uD83D\uDFE0', item:'\uD83D\uDCE6', experience_orb:'\u2728', armor_stand:'\uD83E\uDDCD',
    arrow:'\uD83C\uDFF9', boat:'\uD83D\uDEF6', minecart:'\uD83D\uDED2', squid:'\uD83E\uDD91', glow_squid:'\uD83E\uDD91',
    axolotl:'\uD83E\uDD8E', frog:'\uD83D\uDC38', tadpole:'\uD83D\uDC1B', bee:'\uD83D\uDC1D', fox:'\uD83E\uDD8A', rabbit:'\uD83D\uDC07',
    llama:'\uD83E\uDD99', trader_llama:'\uD83E\uDD99', goat:'\uD83D\uDC10', panda:'\uD83D\uDC3C', polar_bear:'\uD83D\uDC3B\u200D\u2744\uFE0F',
    turtle:'\uD83D\uDC22', dolphin:'\uD83D\uDC2C', cod:'\uD83D\uDC1F', salmon:'\uD83D\uDC1F', pufferfish:'\uD83D\uDC21',
    tropical_fish:'\uD83D\uDC20', allay:'\uD83D\uDD35', warden:'\uD83D\uDFE6', phantom:'\uD83D\uDC7B', blaze:'\uD83D\uDD25',
    ghast:'\uD83D\uDC7B', wither:'\uD83D\uDC80', ender_dragon:'\uD83D\uDC09', piglin:'\uD83D\uDC37', piglin_brute:'\uD83D\uDC37',
    hoglin:'\uD83D\uDC17', zoglin:'\uD83D\uDC17', strider:'\uD83E\uDD11', shulker:'\uD83D\uDFEA', guardian:'\uD83D\uDC1F',
    elder_guardian:'\uD83D\uDC1F', silverfish:'\uD83D\uDC1B', vex:'\uD83D\uDC7F', vindicator:'\uD83E\uDE93', pillager:'\uD83C\uDFF9',
    ravager:'\uD83D\uDC02', evoker:'\uD83E\uDDD9', witch:'\uD83E\uDDD9', illusioner:'\uD83E\uDDD9', tnt:'\uD83E\uDDE8',
    falling_block:'\uD83E\uDDF1', painting:'\uD83D\uDDBC\uFE0F', item_frame:'\uD83D\uDDBC\uFE0F', parrot:'\uD83E\uDD9C' };
  const ICON_BASE = 'https://cdn.jsdelivr.net/gh/Simplexity-Development/Entity-Icons@main/assets/png_files/';
  function entityIcon(rawName) {
    const id = String(rawName || '').replace(/^minecraft:/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const span = el('span', { class: 'mob-ic' });
    const img = document.createElement('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.className = 'mob-ic-img';
    img.onerror = () => { span.innerHTML = ''; span.textContent = ENTITY_EMOJI[id] || '\u2022'; span.classList.add('mob-ic-fb'); };
    img.src = ICON_BASE + id + '.png';
    span.appendChild(img);
    return span;
  }
  function iconBarRow(rawName, value, max) {
    const name = String(rawName).replace(/^minecraft:/, '');
    const row = el('div', { class: 'bar-row' });
    row.appendChild(el('div', { class: 'bar-label' }, [entityIcon(rawName), el('span', { text: name })]));
    const track = el('div', { class: 'bar-track' });
    track.appendChild(el('div', { class: 'bar-fill', style: 'width:' + Math.max(1, (value / max) * 100) + '%' }));
    row.appendChild(track);
    row.appendChild(el('div', { class: 'bar-val', text: fmtNum(value) }));
    return row;
  }

  /* ---------- platform logo badge (official logo if present, else colored badge) ---------- */
  function platformBadge(loader) {
    const ps = SparkKB.platformStyle(loader);
    const span = el('span', { class: 'plat-badge', title: ps.name, style: `background:${ps.color};color:${ps.text}` });
    const exts = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    const img = document.createElement('img');
    img.className = 'plat-logo'; img.alt = ps.name; img.decoding = 'async';
    let i = 0;
    img.onload = () => span.classList.add('has-logo');
    img.onerror = () => { i++; if (i < exts.length) { img.src = 'assets/img/' + loader + '.' + exts[i]; } else { try { img.remove(); } catch (e) {} } };
    img.src = 'assets/img/' + loader + '.' + exts[0];
    span.appendChild(img);
    span.appendChild(el('span', { class: 'plat-mono', text: ps.mono }));
    return span;
  }

  /* ---------- navigation + copy summary ---------- */
  function goHome() {
    const r = $('#result'); if (r) r.style.display = 'none';
    const l = $('#landing'); if (l) l.style.display = 'block';
    history.replaceState(null, '', location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function stripMd(x) { return String(x || '').replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); }
  function summaryText() {
    const a = state.analysis, ctx = a.ctx, L = [];
    L.push('Spark Analyzer summary');
    L.push([ctx.brand || 'Unknown', ctx.mcVersion ? 'MC ' + ctx.mcVersion : ''].filter(Boolean).join(' \u2022 '));
    if (ctx.tps) { const avg = Math.min((Number(ctx.tps.last1m) + Number(ctx.tps.last5m) + Number(ctx.tps.last15m)) / 3, 20); L.push('Avg TPS: ' + avg.toFixed(1)); }
    L.push('Issues: ' + a.counts.critical + ' critical, ' + a.counts.warning + ' warning, ' + a.counts.info + ' info');
    L.push('');
    a.issues.filter(i => i.severity === 'critical' || i.severity === 'warning').slice(0, 14).forEach(i => {
      L.push('- [' + i.severity.toUpperCase() + '] ' + stripMd(i.title));
      if (i.fix) L.push('    Fix: ' + stripMd(i.fix).replace(/\n/g, ' '));
      if (i.mods && i.mods.length) L.push('    Mods: ' + i.mods.map(m => m.name).join(', '));
    });
    L.push('');
    L.push('Generated with Spark Analyzer' + (state.report && state.report.code ? ' \u2022 https://spark.lucko.me/' + state.report.code : ''));
    return L.join('\n');
  }
  function copySummary(e) {
    const btn = e.currentTarget;
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = o, 1500); };
    try { navigator.clipboard.writeText(summaryText()).then(done, done); } catch (err) { done(); }
  }

  /* full machine/AI-readable digest of the report + analysis (markdown) */
  function aiExportText() {
    const a = state.analysis, ctx = a.ctx, sys = ctx.system || {}, ps = ctx.platformStats || {};
    const L = [];
    L.push('# Spark report digest (generated by Spark Analyzer)');
    L.push('');
    L.push('## Server');
    L.push(`- Platform: ${ctx.brand} ${ctx.serverVersion} (MC ${ctx.mcVersion || '?'}), report type: ${state.report.type}${ctx.reportKind !== 'server' ? ', kind: ' + ctx.reportKind : ''}`);
    if (ctx.tps) L.push(`- TPS: 1m ${Number(ctx.tps.last1m).toFixed(1)}, 5m ${Number(ctx.tps.last5m).toFixed(1)}, 15m ${Number(ctx.tps.last15m).toFixed(1)}`);
    if (ctx.mspt && ctx.mspt.last1m) { const m = ctx.mspt.last1m; L.push(`- MSPT (1m): median ${Number(m.median).toFixed(1)}, mean ${Number(m.mean).toFixed(1)}, p95 ${Number(m.percentile95).toFixed(1)}, max ${Number(m.max).toFixed(1)}`); }
    L.push(`- Players: ${ctx.players}` + (ps.uptime ? `, uptime ${fmtUptime(ps.uptime)}` : ''));
    if (sys.cpu) L.push(`- CPU: ${sys.cpu.modelName || '?'} (${sys.cpu.threads} threads visible)`);
    const heap = ps.memory && ps.memory.heap;
    if (heap && heap.max) L.push(`- Heap: ${fmtBytes(heap.used)} / ${fmtBytes(heap.max)}` + (ctx.xmx ? `, -Xmx ${(ctx.xmx / 1024).toFixed(1)}G -Xms ${ctx.xms != null ? (ctx.xms / 1024).toFixed(1) + 'G' : '?'}` : ''));
    if (sys.java) L.push(`- Java: ${sys.java.vendor || ''} ${sys.java.version || ''}`);
    if (sys.gc && Object.keys(sys.gc).length)
      L.push('- GC: ' + Object.entries(sys.gc).map(([n, g]) => `${n}: ${Number(g.total)} collections, avg ${Number(g.avgTime).toFixed(1)}ms, every ${(Number(g.avgFrequency) / 1000).toFixed(1)}s`).join(' | '));
    if (ctx.profile && ctx.profile.durationMs) L.push(`- Profile: ${fmtMs(ctx.profile.durationMs)}, engine ${ctx.profile.engine || '?'}${ctx.ticksOver != null ? ', slow-ticks-only (--only-ticks-over)' : ''}`);
    if (a.breakdown) {
      L.push('');
      L.push('## Main-thread tick breakdown (idle excluded)');
      L.push(`(thread: ${a.breakdown.threadName}; idle/waiting share of profile: ${(a.breakdown.idle / Math.max(1, a.breakdown.total) * 100).toFixed(0)}%)`);
      (a.subsystems || []).forEach(sb => L.push(`- ${stripMd(sb.label)}: ${(sb.pct * 100).toFixed(1)}%`));
    }
    if (a.sources && a.sources.length) {
      L.push('');
      L.push('## Time by source (share of active main-thread time)');
      a.sources.slice(0, 12).forEach(s => L.push(`- ${s.name}: ${(s.pct * 100).toFixed(1)}%`));
    }
    if (a.hotspots && a.hotspots.chunks && a.hotspots.chunks.length) {
      L.push('');
      L.push(`## Entity hotspots (total loaded: ${fmtNum(a.hotspots.totalEntities)})`);
      a.hotspots.chunks.slice(0, 10).forEach(c => {
        const top = Object.entries(c.counts || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => `${n.replace(/^minecraft:/, '')}×${v}`).join(', ');
        L.push(`- ${c.world} block(${c.x * 16}, ${c.z * 16}): ${c.total} entities (${top})`);
      });
    }
    L.push('');
    L.push('## Findings');
    a.issues.forEach(i => {
      L.push(`- [${i.severity.toUpperCase()}] ${stripMd(i.title)}`);
      if (i.detail) L.push(`  - ${stripMd(i.detail).replace(/\n/g, ' ')}`);
      if (i.fix) L.push(`  - Fix: ${stripMd(i.fix).replace(/\n/g, ' ')}`);
    });
    if (ctx.plugins.length) {
      L.push('');
      L.push(`## Installed plugins/mods (${ctx.plugins.length})`);
      L.push(ctx.plugins.map(p => p.name + (p.version ? ' ' + p.version : '')).join(', '));
    }
    L.push('');
    L.push('Generated with Spark Analyzer' + (state.report && state.report.code ? ' from https://spark.lucko.me/' + state.report.code : ''));
    return L.join('\n');
  }
  function copyAI(e) {
    const btn = e.currentTarget;
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = o, 1500); };
    try { navigator.clipboard.writeText(aiExportText()).then(done, done); } catch (err) { done(); }
  }

  /* ---------- state ---------- */
  const state = { report: null, analysis: null };

  /* ---------- entry ---------- */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const form = $('#load-form');
    form.addEventListener('submit', e => { e.preventDefault(); loadFromInput($('#url-input').value); });
    const cmpForm = $('#compare-form');
    if (cmpForm) cmpForm.addEventListener('submit', e => { e.preventDefault(); loadCompare($('#compare-a').value, $('#compare-b').value); });
    $$('.sample-link').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); $('#url-input').value = a.dataset.code; loadFromInput(a.dataset.code);
    }));
    setupDropzone();
    const brand = document.querySelector('.brand');
    if (brand) { brand.classList.add('clickable'); brand.title = 'Back to home'; brand.addEventListener('click', goHome); }
    // deep link via ?report=code or #code
    const params = new URLSearchParams(location.search);
    const deep = params.get('report') || (location.hash && location.hash.slice(1));
    if (deep) { $('#url-input').value = deep; loadFromInput(deep); }
  }

  function setupDropzone() {
    const dz = $('#dropzone');
    const fileInput = $('#file-input');
    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFromFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFromFile(f); });
    // also allow dropping anywhere
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', e => {
      if (e.target.closest('#dropzone')) return;
      e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFromFile(f);
    });
  }

  function setStatus(msg, kind) {
    const s = $('#status');
    s.className = 'status ' + (kind || '');
    s.innerHTML = msg ? richText(msg) : '';
    s.style.display = msg ? 'block' : 'none';
  }
  function setLoading(on, msg) {
    $('#loader').style.display = on ? 'flex' : 'none';
    if (on) $('#loader-msg').textContent = msg || 'Loading…';
  }

  async function loadFromInput(value) {
    if (!value || !value.trim()) { setStatus('Paste a spark link or code first.', 'err'); return; }
    setStatus(''); setLoading(true, 'Fetching report from spark-usercontent…');
    try {
      const report = await SparkData.fetchReport(value);
      const code = report.code;
      if (code) history.replaceState(null, '', '?report=' + encodeURIComponent(code));
      onReport(report);
    } catch (e) {
      setLoading(false);
      setStatus('**Could not load report.** ' + esc(e.message), 'err');
      console.error(e);
    }
  }
  async function loadFromFile(file) {
    setStatus(''); setLoading(true, 'Reading ' + file.name + '…');
    try {
      const buf = await file.arrayBuffer();
      const report = SparkData.decodeFile(buf, file.name);
      onReport(report);
    } catch (e) {
      setLoading(false);
      setStatus('**Could not read file.** ' + esc(e.message), 'err');
      console.error(e);
    }
  }

  /* ---------- compare two reports ---------- */
  async function loadCompare(aVal, bVal) {
    if (!aVal || !bVal || !aVal.trim() || !bVal.trim()) { setStatus('Paste both spark links to compare.', 'err'); return; }
    setStatus(''); setLoading(true, 'Fetching both reports…');
    try {
      const [ra, rb] = await Promise.all([SparkData.fetchReport(aVal), SparkData.fetchReport(bVal)]);
      const aa = SparkRules.analyze(ra), ab = SparkRules.analyze(rb);
      setLoading(false);
      $('#landing').style.display = 'none';
      const root = $('#result');
      root.style.display = 'block';
      root.innerHTML = '';
      root.appendChild(renderCompare({ report: ra, analysis: aa }, { report: rb, analysis: ab }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setLoading(false);
      setStatus('**Could not compare.** ' + esc(e.message), 'err');
      console.error(e);
    }
  }

  function renderCompare(A, B) {
    const wrap = el('div');
    const head = el('div', { class: 'rheader' });
    const main = el('div', { class: 'rheader-main' });
    main.appendChild(el('div', { class: 'rtitle' }, [
      el('span', { text: '⚖️ Report comparison' }),
      el('span', { class: 'badge badge-type', text: 'Before → After' }),
    ]));
    main.appendChild(el('div', { class: 'profile-strip' }, [
      el('span', { class: 'pchip', html: `<span class="pk">Before</span> ${esc(A.analysis.ctx.brand)} MC ${esc(A.analysis.ctx.mcVersion)}${A.report.code ? ' · ' + esc(A.report.code) : ''}` }),
      el('span', { class: 'pchip', html: `<span class="pk">After</span> ${esc(B.analysis.ctx.brand)} MC ${esc(B.analysis.ctx.mcVersion)}${B.report.code ? ' · ' + esc(B.report.code) : ''}` }),
    ]));
    head.appendChild(main);
    const actions = el('div', { class: 'rheader-actions' });
    actions.appendChild(el('button', { class: 'btn ghost', text: 'New report', onclick: goHome }));
    head.appendChild(actions);
    wrap.appendChild(head);

    const num2 = v => v == null ? null : Number(v);
    function row(label, va, vb, fmt, lowerIsBetter) {
      if (va == null && vb == null) return null;
      const f = fmt || (v => v == null ? '—' : v.toFixed(1));
      let deltaTxt = '', cls = '';
      if (va != null && vb != null) {
        const d = vb - va;
        const good = lowerIsBetter ? d < -0.05 : d > 0.05;
        const bad = lowerIsBetter ? d > 0.05 : d < -0.05;
        cls = good ? 'cmp-good' : bad ? 'cmp-bad' : '';
        deltaTxt = (d > 0 ? '+' : '') + f(d).replace('—', '0');
      }
      return el('tr', {}, [td(label), td(f(va)), td(f(vb)), el('td', { class: cls, text: deltaTxt })]);
    }
    const t = el('table', { class: 'tbl' });
    t.appendChild(el('thead', {}, el('tr', {}, [th('Metric'), th('Before'), th('After'), th('Δ')])));
    const tb = el('tbody');
    const addRow = r => { if (r) tb.appendChild(r); };
    const ca = A.analysis.ctx, cb = B.analysis.ctx;
    const m = (c, path) => { let o = c; for (const k of path) { o = o && o[k]; } return o == null ? null : Number(o); };
    addRow(row('TPS (1m)', m(ca, ['tps', 'last1m']), m(cb, ['tps', 'last1m']), null, false));
    addRow(row('MSPT median (1m)', m(ca, ['mspt', 'last1m', 'median']), m(cb, ['mspt', 'last1m', 'median']), v => v == null ? '—' : v.toFixed(1) + 'ms', true));
    addRow(row('MSPT p95 (1m)', m(ca, ['mspt', 'last1m', 'percentile95']), m(cb, ['mspt', 'last1m', 'percentile95']), v => v == null ? '—' : v.toFixed(1) + 'ms', true));
    addRow(row('Players', ca.players, cb.players, v => v == null ? '—' : String(Math.round(v)), false));
    addRow(row('Entities loaded', A.analysis.hotspots && A.analysis.hotspots.totalEntities, B.analysis.hotspots && B.analysis.hotspots.totalEntities, v => v == null ? '—' : fmtNum(Math.round(v)), true));
    const heapPct = c => { const h = c.platformStats && c.platformStats.memory && c.platformStats.memory.heap; return h && h.max ? Number(h.used) / Number(h.max) * 100 : null; };
    addRow(row('Heap used %', heapPct(ca), heapPct(cb), v => v == null ? '—' : v.toFixed(0) + '%', true));
    t.appendChild(tb);
    const sec1 = el('div', { class: 'section' });
    sec1.appendChild(el('h3', { text: 'Key metrics' }));
    sec1.appendChild(t);
    wrap.appendChild(sec1);

    // subsystem shares side by side
    const subsA = {}, subsB = {};
    (A.analysis.subsystems || []).forEach(s => subsA[s.id] = s);
    (B.analysis.subsystems || []).forEach(s => subsB[s.id] = s);
    const ids = [...new Set([...Object.keys(subsA), ...Object.keys(subsB)])];
    if (ids.length) {
      const t2 = el('table', { class: 'tbl' });
      t2.appendChild(el('thead', {}, el('tr', {}, [th('Subsystem'), th('Before'), th('After'), th('Δ')])));
      const tb2 = el('tbody');
      ids.map(id => ({ id, a: subsA[id], b: subsB[id], max: Math.max(subsA[id] ? subsA[id].pct : 0, subsB[id] ? subsB[id].pct : 0) }))
        .sort((x, y) => y.max - x.max)
        .forEach(({ id, a, b }) => {
          const pa = a ? a.pct * 100 : 0, pb = b ? b.pct * 100 : 0;
          const d = pb - pa;
          const label = (a || b).label, icon = (a || b).icon;
          tb2.appendChild(el('tr', {}, [
            el('td', { html: `${icon} ${esc(label)}` }), td(pa.toFixed(1) + '%'), td(pb.toFixed(1) + '%'),
            el('td', { class: d < -1 ? 'cmp-good' : d > 1 ? 'cmp-bad' : '', text: (d > 0 ? '+' : '') + d.toFixed(1) + '%' }),
          ]));
        });
      t2.appendChild(tb2);
      const sec2 = el('div', { class: 'section' });
      sec2.appendChild(el('h3', { text: 'Tick breakdown (share of active main-thread time)' }));
      sec2.appendChild(el('div', { class: 'section-note', text: 'Idle time excluded on both sides. Percentages are relative shares, so a subsystem can grow in share while shrinking in absolute cost when total load drops.' }));
      sec2.appendChild(t2);
      wrap.appendChild(sec2);
    }

    // verdict counts
    const sec3 = el('div', { class: 'section' });
    sec3.appendChild(el('h3', { text: 'Findings' }));
    const ka = A.analysis.counts, kb = B.analysis.counts;
    sec3.appendChild(el('div', { class: 'section-note', html:
      `Before: <strong>${ka.critical}</strong> critical / ${ka.warning} warning &nbsp;→&nbsp; After: <strong>${kb.critical}</strong> critical / ${kb.warning} warning. Open each report separately for the full recommendation list.` }));
    wrap.appendChild(sec3);
    return wrap;
  }

  function onReport(report) {
    state.report = report;
    try { state.analysis = SparkRules.analyze(report); }
    catch (e) { console.error('analysis failed', e); state.analysis = { ctx: SparkRules.buildContext(report), issues: [], counts: { critical: 0, warning: 0, info: 0, good: 0 } }; }
    setLoading(false);
    setStatus('');
    $('#landing').style.display = 'none';
    $('#result').style.display = 'block';
    renderResult();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =======================================================================
   * RENDER
   * ===================================================================== */
  function renderResult() {
    const { report, analysis } = state;
    const ctx = analysis.ctx;
    const root = $('#result');
    root.innerHTML = '';

    // header
    root.appendChild(renderHeader(ctx, report));

    // tabs
    const tabs = [];
    tabs.push(['overview', 'Overview']);
    tabs.push(['recs', `Recommendations (${analysis.counts.critical + analysis.counts.warning + analysis.counts.info})`]);
    if (analysis.subsystems && analysis.subsystems.length) tabs.push(['breakdown', 'Tick Breakdown']);
    if (analysis.hotspots && analysis.hotspots.chunks && analysis.hotspots.chunks.length) tabs.push(['hotspots', 'Entity Hotspots']);
    if (analysis.sources && analysis.sources.length) tabs.push(['sources', 'Sources']);
    if (report.type === 'sampler') tabs.push(['flame', 'Flame Graph'], ['tree', 'Call Tree']);
    if (report.type === 'heap') tabs.push(['heap', 'Heap']);
    if (report.type === 'health' || (report.data.timeWindowStatistics && Object.keys(report.data.timeWindowStatistics).length)) tabs.push(['health', 'Timeline']);
    tabs.push(['audit', 'Plugins & Config']);
    tabs.push(['system', 'System']);

    const tabBar = el('div', { class: 'tabbar' });
    const panels = el('div', { class: 'panels' });
    tabs.forEach(([id, label], idx) => {
      const btn = el('button', { class: 'tab' + (idx === 0 ? ' active' : ''), 'data-tab': id, text: label });
      btn.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        $$('.panel').forEach(p => p.style.display = 'none');
        const panel = $('#panel-' + id);
        panel.style.display = 'block';
        panel.classList.remove('anim'); void panel.offsetWidth; panel.classList.add('anim');
        if (id === 'flame' && !panel.dataset.rendered) { renderFlame(panel); panel.dataset.rendered = '1'; }
      });
      tabBar.appendChild(btn);
    });
    root.appendChild(tabBar);
    root.appendChild(panels);

    panels.appendChild(panelWrap('overview', renderOverview(ctx, report, analysis), true));
    panels.appendChild(panelWrap('recs', renderRecs(analysis)));
    if (analysis.subsystems && analysis.subsystems.length) panels.appendChild(panelWrap('breakdown', renderBreakdown(analysis)));
    if (analysis.hotspots && analysis.hotspots.chunks && analysis.hotspots.chunks.length) panels.appendChild(panelWrap('hotspots', renderHotspots(analysis)));
    if (analysis.sources && analysis.sources.length) panels.appendChild(panelWrap('sources', renderSources(analysis)));
    if (report.type === 'sampler') {
      panels.appendChild(panelWrap('flame', el('div', { id: 'flame-host' })));
      panels.appendChild(panelWrap('tree', renderCallTree(report)));
    }
    if (report.type === 'heap') panels.appendChild(panelWrap('heap', renderHeap(report)));
    if (tabs.some(t => t[0] === 'health')) panels.appendChild(panelWrap('health', renderTimeline(report)));
    panels.appendChild(panelWrap('audit', renderAudit(ctx)));
    panels.appendChild(panelWrap('system', renderSystem(ctx)));
  }

  function panelWrap(id, content, visible) {
    const p = el('div', { class: 'panel', id: 'panel-' + id });
    p.style.display = visible ? 'block' : 'none';
    p.appendChild(content);
    return p;
  }

  function renderHeader(ctx, report) {
    const typeLabel = { sampler: 'Profiler', heap: 'Heap Summary', health: 'Health Report' }[report.type] || report.type;
    const ps = SparkKB.platformStyle(ctx.platform.loader);
    const h = el('div', { class: 'rheader' });
    const main = el('div', { class: 'rheader-main' });
    main.appendChild(el('div', { class: 'rtitle' }, [
      platformBadge(ctx.platform.loader),
      el('span', { text: ctx.brand || ctx.platformName || 'Unknown platform' }),
      el('span', { class: 'badge badge-type', text: typeLabel }),
    ]));
    const strip = el('div', { class: 'profile-strip' });
    const chip = (k, v) => { if (v != null && v !== '') strip.appendChild(el('span', { class: 'pchip', html: `<span class="pk">${esc(k)}</span> ${esc(v)}` })); };
    chip('MC', ctx.mcVersion);
    chip('Build', ctx.serverVersion);
    if (ctx.reportKind && ctx.reportKind !== 'server') chip('Report', ctx.reportKind);
    if (ctx.samplerMode === 'ALLOCATION') chip('Mode', 'allocation');
    if (ctx.profile && ctx.profile.engine) chip('Engine', ctx.profile.engine === 'ASYNC' ? 'async' : 'java');
    if (ctx.reportKind === 'server' && ctx.players != null) chip('Players', String(ctx.players));
    if (ctx.profile && ctx.profile.durationMs) chip('Duration', fmtMs(ctx.profile.durationMs));
    else if (ctx.profile && ctx.profile.ticks) chip('Ticks', fmtNum(ctx.profile.ticks));
    main.appendChild(strip);
    h.appendChild(main);
    const actions = el('div', { class: 'rheader-actions' });
    actions.appendChild(el('button', { class: 'btn ghost', text: 'Copy summary', onclick: copySummary }));
    actions.appendChild(el('button', { class: 'btn ghost', text: 'Copy for AI', title: 'Full machine-readable digest of this report and analysis, for pasting into an AI assistant or a help channel', onclick: copyAI }));
    if (report.code) actions.appendChild(el('a', { class: 'btn ghost', href: 'https://spark.lucko.me/' + report.code, target: '_blank', rel: 'noopener', text: 'Open in spark viewer \u2197' }));
    actions.appendChild(el('button', { class: 'btn ghost', text: 'New report', onclick: goHome }));
    h.appendChild(actions);
    return h;
  }

  /* ---------- overview ---------- */
  function statusOf(value, goodIf, warnIf) {
    if (goodIf(value)) return 'good';
    if (warnIf(value)) return 'warn';
    return 'bad';
  }
  function statCard(label, big, sub, status, help) {
    return el('div', { class: 'stat ' + (status || '') }, [
      el('div', { class: 'stat-label' }, [el('span', { text: label }), help ? el('span', { class: 'help', title: help, text: '?' }) : null]),
      el('div', { class: 'stat-big', html: big }),
      sub ? el('div', { class: 'stat-sub', html: sub }) : null,
    ]);
  }

  function renderOverview(ctx, report, analysis) {
    const wrap = el('div');
    const ps = ctx.platformStats || {};
    const sys = ctx.system || {};

    // summary banner
    const c = analysis.counts;
    const banner = el('div', { class: 'summary-banner' });
    const totalProblems = c.critical + c.warning;
    let verdict, vclass;
    if (c.critical > 0) { verdict = `${c.critical} critical issue${c.critical > 1 ? 's' : ''} found`; vclass = 'bad'; }
    else if (c.warning > 0) { verdict = `${c.warning} thing${c.warning > 1 ? 's' : ''} to improve`; vclass = 'warn'; }
    else { verdict = 'No major issues detected'; vclass = 'good'; }
    banner.classList.add(vclass);
    banner.appendChild(el('div', { class: 'sb-verdict', text: verdict }));
    banner.appendChild(el('div', { class: 'sb-counts', html:
      `<span class="pill crit">${c.critical} critical</span> <span class="pill warn">${c.warning} warning</span> <span class="pill info">${c.info} info</span>` }));
    wrap.appendChild(banner);

    // key stat cards
    const cards = el('div', { class: 'stat-grid' });

    if (ps.tps) {
      const avg = Math.min((Number(ps.tps.last1m) + Number(ps.tps.last5m) + Number(ps.tps.last15m)) / 3, 20);
      cards.appendChild(statCard('TPS (avg)', avg.toFixed(2),
        `1m ${Number(ps.tps.last1m).toFixed(1)} · 5m ${Number(ps.tps.last5m).toFixed(1)} · 15m ${Number(ps.tps.last15m).toFixed(1)}`,
        statusOf(avg, v => v >= 19.5, v => v >= 18), 'TPS (ticks per second) is the server heartbeat. 20 is perfect; below about 18 players start to feel lag.'));
    }
    if (ps.mspt && ps.mspt.last1m) {
      const m = ps.mspt.last1m;
      cards.appendChild(statCard('MSPT (1m median)', Number(m.median).toFixed(1) + '<span class="unit">ms</span>',
        `max ${Number(m.max).toFixed(1)} · 95% ${Number(m.percentile95).toFixed(1)}`,
        statusOf(Number(m.median), v => v <= 40, v => v <= 50), 'MSPT is how long each tick takes. The budget is 50ms; above that the server cannot hold 20 TPS.'));
    }
    // CPU
    const cpuProc = sys.cpu && sys.cpu.processUsage ? Number(sys.cpu.processUsage.last1m) : null;
    if (cpuProc != null) {
      const p = cpuProc <= 1 ? cpuProc : cpuProc / 100;
      cards.appendChild(statCard('CPU (process, 1m)', (p * 100).toFixed(0) + '<span class="unit">%</span>',
        sys.cpu.systemUsage ? ('system ' + ((Number(sys.cpu.systemUsage.last1m) <= 1 ? Number(sys.cpu.systemUsage.last1m) : Number(sys.cpu.systemUsage.last1m) / 100) * 100).toFixed(0) + '%') : '',
        statusOf(p, v => v < 0.7, v => v < 0.9), 'Process CPU usage. Minecraft runs the world on one core, so this can look low even when that core is maxed out.'));
    }
    // heap memory
    const heap = ps.memory && ps.memory.heap ? ps.memory.heap : null;
    if (heap && heap.max) {
      const ratio = Number(heap.used) / Number(heap.max);
      cards.appendChild(statCard('Heap used', fmtBytes(heap.used),
        'of ' + fmtBytes(heap.max) + ' (' + pct(ratio) + ')',
        statusOf(ratio, v => v < 0.8, v => v < 0.95), 'How much of the allocated RAM (heap) is in use. Sitting near 100% causes garbage-collection lag.'));
    } else if (sys.memory && sys.memory.physical) {
      const ph = sys.memory.physical;
      const ratio = Number(ph.used) / Number(ph.total);
      cards.appendChild(statCard('System RAM', fmtBytes(ph.used), 'of ' + fmtBytes(ph.total), statusOf(ratio, v => v < 0.85, v => v < 0.95)));
    }
    // players
    if (ps.playerCount != null) cards.appendChild(statCard('Players', fmtNum(ps.playerCount), '', ''));
    // CPU threads
    if (sys.cpu && sys.cpu.threads) cards.appendChild(statCard('CPU threads', fmtNum(sys.cpu.threads), esc(sys.cpu.modelName || ''), statusOf(sys.cpu.threads, v => v >= 4, v => v >= 3)));
    // ping (optional)
    if (ps.ping && ps.ping.last15m && Number(ps.ping.last15m.mean)) {
      const pg = Number(ps.ping.last15m.mean);
      cards.appendChild(statCard('Avg ping', pg.toFixed(0) + '<span class="unit">ms</span>',
        ps.ping.last15m.max ? ('max ' + Number(ps.ping.last15m.max).toFixed(0) + 'ms') : '',
        statusOf(pg, v => v < 80, v => v < 150)));
    }
    // uptime
    if (ps.uptime) cards.appendChild(statCard('Uptime', fmtUptime(ps.uptime), '', ''));

    wrap.appendChild(cards);

    // top recommendations preview
    const top = analysis.issues.filter(i => i.severity === 'critical' || i.severity === 'warning').slice(0, 5);
    if (top.length) {
      const sec = el('div', { class: 'section' });
      sec.appendChild(el('h3', { text: 'Top recommendations' }));
      sec.appendChild(el('div', { class: 'rec-list' }, top.map(recCard)));
      const more = el('button', { class: 'btn ghost', text: 'See all recommendations →', onclick: () => $('.tab[data-tab="recs"]').click() });
      sec.appendChild(more);
      wrap.appendChild(sec);
    }

    // world / entities quick info
    if (ps.world) {
      const w = ps.world;
      const sec = el('div', { class: 'section' });
      sec.appendChild(el('h3', { text: 'World' }));
      const grid = el('div', { class: 'kv-grid' });
      grid.appendChild(kv('Total entities', fmtNum(w.totalEntities)));
      if (w.worlds && w.worlds.length) grid.appendChild(kv('Worlds', w.worlds.map(x => x.name).join(', ')));
      sec.appendChild(grid);
      // top entities
      if (w.entityCounts && Object.keys(w.entityCounts).length) {
        const ents = Object.entries(w.entityCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
        const max = ents[0][1];
        const t = el('div', { class: 'bar-list' });
        ents.forEach(([name, n]) => t.appendChild(iconBarRow(name, n, max)));
        sec.appendChild(el('h4', { text: 'Most common entities' }));
        sec.appendChild(t);
      }
      wrap.appendChild(sec);
    }

    return wrap;
  }

  function kv(k, v) { return el('div', { class: 'kv' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', html: v })]); }
  function barRow(label, value, max, valLabel) {
    const row = el('div', { class: 'bar-row' });
    row.appendChild(el('div', { class: 'bar-label', text: label }));
    const track = el('div', { class: 'bar-track' });
    track.appendChild(el('div', { class: 'bar-fill', style: 'width:' + Math.max(1, (value / max) * 100) + '%' }));
    row.appendChild(track);
    row.appendChild(el('div', { class: 'bar-val', text: valLabel }));
    return row;
  }

  /* ---------- recommendations ---------- */
  const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info', good: 'OK' };
  function recCard(issue) {
    const c = el('div', { class: 'rec rec-' + issue.severity });
    c.appendChild(el('div', { class: 'rec-side' }, el('span', { class: 'sev sev-' + issue.severity, text: SEV_LABEL[issue.severity] })));
    const body = el('div', { class: 'rec-body' });
    body.appendChild(el('div', { class: 'rec-title' }, [
      el('span', { text: issue.title }),
      el('span', { class: 'rec-cat', text: issue.category }),
    ]));
    if (issue.detail) body.appendChild(el('div', { class: 'rec-detail', html: richText(issue.detail) }));
    if (issue.fix) body.appendChild(el('div', { class: 'rec-fix', html: '<strong>Fix:</strong> ' + richText(issue.fix) }));
    if (issue.mods && issue.mods.length) {
      const mwrap = el('div', { class: 'rec-mods' });
      mwrap.appendChild(el('span', { class: 'rec-mods-label', text: 'Mods:' }));
      issue.mods.forEach(m => mwrap.appendChild(el('a', { class: 'mod-chip', href: m.url, target: '_blank', rel: 'noopener', title: m.blurb, html: esc(m.name) + ' \u2197' })));
      body.appendChild(mwrap);
    }
    if (issue.link) body.appendChild(el('a', { class: 'rec-link', href: issue.link, target: '_blank', rel: 'noopener', text: 'Learn more ↗' }));
    c.appendChild(body);
    return c;
  }

  function renderRecs(analysis) {
    const wrap = el('div');
    if (!analysis.issues.length) {
      wrap.appendChild(el('div', { class: 'empty', text: 'No recommendations. Nothing stood out, nice.' }));
      return wrap;
    }
    // filters
    const filterBar = el('div', { class: 'filterbar' });
    const sevs = ['critical', 'warning', 'info', 'good'];
    const active = new Set(['critical', 'warning', 'info', 'good']);
    sevs.forEach(s => {
      const n = analysis.counts[s];
      if (!n) return;
      const b = el('button', { class: 'chip chip-' + s + (active.has(s) ? ' on' : ''), text: SEV_LABEL[s] + ' (' + n + ')' });
      b.addEventListener('click', () => { b.classList.toggle('on'); if (active.has(s)) active.delete(s); else active.add(s); draw(); });
      filterBar.appendChild(b);
    });
    wrap.appendChild(filterBar);
    const list = el('div', { class: 'rec-list' });
    wrap.appendChild(list);
    function draw() {
      list.innerHTML = '';
      const items = analysis.issues.filter(i => active.has(i.severity));
      if (!items.length) { list.appendChild(el('div', { class: 'empty', text: 'No items match the current filter.' })); return; }
      items.forEach(i => list.appendChild(recCard(i)));
    }
    draw();
    return wrap;
  }

  /* ---------- audit (plugins & config) ---------- */
  function renderAudit(ctx) {
    const wrap = el('div');
    // plugins
    const sec = el('div', { class: 'section' });
    sec.appendChild(el('h3', { text: `Plugins / mods (${ctx.plugins.length})` }));
    if (ctx.plugins.length) {
      const flagIssues = state.analysis.issues.filter(i => i.category === 'Plugins' || i.category === 'Mods');
      const flagFor = name => flagIssues.find(i => i.title.includes(name));
      const table = el('table', { class: 'tbl' });
      table.appendChild(el('thead', {}, el('tr', {}, [th('Name'), th('Version'), th('Author'), th('Verdict')])));
      const tb = el('tbody');
      ctx.plugins.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
        const fl = flagFor(p.name);
        tb.appendChild(el('tr', { class: fl ? 'flag-' + fl.severity : '' }, [
          td(p.name), td(p.version || '-'), td(p.author || '-'),
          el('td', {}, fl ? el('span', { class: 'sev sev-' + fl.severity, text: SEV_LABEL[fl.severity] }) : el('span', { class: 'ok-dot', text: 'ok' })),
        ]));
      });
      table.appendChild(tb);
      sec.appendChild(table);
    } else sec.appendChild(el('div', { class: 'empty', text: 'No plugin/mod list in this report.' }));
    wrap.appendChild(sec);

    // configs
    const cfgSec = el('div', { class: 'section' });
    cfgSec.appendChild(el('h3', { text: 'Detected configuration files' }));
    const present = Object.entries({
      'server.properties': ctx.configs.serverProperties, 'bukkit.yml': ctx.configs.bukkit,
      'spigot.yml': ctx.configs.spigot, 'paper': ctx.configs.paper, 'purpur.yml': ctx.configs.purpur,
    }).filter(([, v]) => v);
    if (present.length) {
      cfgSec.appendChild(el('div', { class: 'chiprow' }, present.map(([k]) => el('span', { class: 'tag', text: k }))));
      cfgSec.appendChild(el('div', { class: 'section-note', text: 'Any config tweaks worth making show up in the Recommendations tab, tied to whatever is actually using tick time.' }));
    } else cfgSec.appendChild(el('div', { class: 'empty', text: 'No server configuration was captured in this report (common for heap/health reports or proxies).' }));
    wrap.appendChild(cfgSec);
    return wrap;
  }
  function th(t) { return el('th', { text: t }); }
  function td(t) { return el('td', { text: t }); }

  /* ---------- system ---------- */
  function renderSystem(ctx) {
    const sys = ctx.system || {};
    const wrap = el('div');
    const grid = el('div', { class: 'kv-grid wide' });
    const add = (k, v) => { if (v != null && v !== '') grid.appendChild(kv(k, esc(v))); };
    add('Platform', ctx.brand || ctx.platformName);
    add('Server version', ctx.serverVersion);
    add('Minecraft', ctx.mcVersion);
    if (sys.cpu) { add('CPU', sys.cpu.modelName); add('CPU threads', sys.cpu.threads); }
    if (sys.os) add('OS', [sys.os.name, sys.os.version, sys.os.arch].filter(Boolean).join(' '));
    if (sys.java) { add('Java', [sys.java.vendor, sys.java.version].filter(Boolean).join(' ')); add('VM', sys.java.vendorVersion); }
    if (sys.jvm) add('JVM', [sys.jvm.name, sys.jvm.vendor].filter(Boolean).join(' '));
    if (sys.memory && sys.memory.physical) add('Physical RAM', fmtBytes(sys.memory.physical.used) + ' / ' + fmtBytes(sys.memory.physical.total));
    if (sys.memory && sys.memory.swap && Number(sys.memory.swap.total)) add('Swap', fmtBytes(sys.memory.swap.used) + ' / ' + fmtBytes(sys.memory.swap.total));
    if (sys.disk) add('Disk', fmtBytes(sys.disk.used) + ' / ' + fmtBytes(sys.disk.total));
    if (sys.uptime) add('System uptime', fmtUptime(sys.uptime));
    if (ctx.xmx != null) add('Heap allocated (-Xmx)', (ctx.xmx / 1024).toFixed(1) + ' GB');
    wrap.appendChild(grid);

    if (sys.java && sys.java.vmArgs) {
      const sec = el('div', { class: 'section' });
      sec.appendChild(el('h3', { text: 'JVM startup flags' }));
      sec.appendChild(el('pre', { class: 'code-block', text: sys.java.vmArgs.replace(/ -/g, '\n-') }));
      wrap.appendChild(sec);
    }
    // GC
    if (sys.gc && Object.keys(sys.gc).length) {
      const sec = el('div', { class: 'section' });
      sec.appendChild(el('h3', { text: 'Garbage collectors' }));
      const t = el('table', { class: 'tbl' });
      t.appendChild(el('thead', {}, el('tr', {}, [th('Collector'), th('Avg time'), th('Avg frequency'), th('Total')])));
      const tb = el('tbody');
      Object.entries(sys.gc).forEach(([name, g]) => tb.appendChild(el('tr', {}, [
        // avgFrequency is ms between collections (spark GarbageCollectorStatistics)
        td(name), td(Number(g.avgTime).toFixed(1) + ' ms'), td(Number(g.avgFrequency) > 0 ? 'every ' + fmtMs(Number(g.avgFrequency)) : '-'), td(fmtNum(g.total)),
      ])));
      t.appendChild(tb); sec.appendChild(t); wrap.appendChild(sec);
    }
    return wrap;
  }

  /* ---------- heap ---------- */
  function renderHeap(report) {
    const wrap = el('div');
    const entries = (report.data.entries || []).slice();
    if (!entries.length) { wrap.appendChild(el('div', { class: 'empty', text: 'No heap entries.' })); return wrap; }
    entries.sort((a, b) => Number(b.size) - Number(a.size));
    const totalSize = entries.reduce((s, e) => s + Number(e.size), 0);
    wrap.appendChild(el('div', { class: 'section-note', html: `The classes using the most memory right now. Total captured: <strong>${fmtBytes(totalSize)}</strong> across ${fmtNum(entries.length)} types.` }));
    const max = Number(entries[0].size);
    const t = el('table', { class: 'tbl heap-tbl' });
    t.appendChild(el('thead', {}, el('tr', {}, [th('#'), th('Type'), th('Size'), th('Instances'), th('')])));
    const tb = el('tbody');
    entries.slice(0, 250).forEach((e, i) => {
      const row = el('tr', {}, [
        td(String(i + 1)),
        el('td', { class: 'mono', text: e.type }),
        td(fmtBytes(e.size)),
        td(fmtNum(e.instances)),
        el('td', { class: 'bar-cell' }, el('div', { class: 'mini-bar', style: 'width:' + Math.max(2, (Number(e.size) / max) * 100) + '%' })),
      ]);
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }

  /* ---------- timeline (health / windowed) ---------- */
  function renderTimeline(report) {
    const wrap = el('div');
    const tws = report.data.timeWindowStatistics || (report.data.metadata && report.data.metadata.timeWindowStatistics) || {};
    const keys = Object.keys(tws).map(Number).sort((a, b) => a - b);
    if (!keys.length) { wrap.appendChild(el('div', { class: 'empty', text: 'No time-window statistics in this report.' })); return wrap; }
    const rows = keys.map(k => tws[k]);
    const timeAt = i => { const r = rows[i]; if (r && r.startTime) { try { return new Date(Number(r.startTime)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) {} } return 'window ' + (i + 1) + '/' + rows.length; };
    wrap.appendChild(el('div', { class: 'section-note', text: `${keys.length} time windows (about one per minute). Hover any graph to read the exact value at that point.` }));
    const series = [
      { label: 'TPS', key: 'tps', color: '#4ade80', max: 20, fmt: v => v.toFixed(1) },
      { label: 'MSPT (median)', key: 'msptMedian', color: '#f59e0b', fmt: v => v.toFixed(1) + 'ms' },
      { label: 'MSPT (max)', key: 'msptMax', color: '#ef4444', fmt: v => v.toFixed(1) + 'ms' },
      { label: 'CPU (process)', key: 'cpuProcess', color: '#38bdf8', scale: v => (v <= 1 ? v * 100 : v), fmt: v => v.toFixed(0) + '%' },
      { label: 'Players', key: 'players', color: '#a78bfa', fmt: v => String(Math.round(v)) },
      { label: 'Entities', key: 'entities', color: '#fb7185', fmt: v => fmtNum(Math.round(v)) },
      { label: 'Chunks', key: 'chunks', color: '#22d3ee', fmt: v => fmtNum(Math.round(v)) },
    ];
    series.forEach(sv => {
      const data = rows.map(r => { let v = Number(r[sv.key]) || 0; if (sv.scale) v = sv.scale(v); return v; });
      if (data.every(v => v === 0)) return;
      wrap.appendChild(makeChart(sv, data, timeAt));
    });
    return wrap;
  }

  function makeChart(series, data, timeAt) {
    const card = el('div', { class: 'chart-card' });
    const cur = el('span', { class: 'chart-cur' });
    card.appendChild(el('div', { class: 'chart-title' }, [el('span', { text: series.label }), cur]));
    const cwrap = el('div', { class: 'chart-wrap' });
    const cv = el('canvas', { class: 'chart-canvas' });
    const tip = el('div', { class: 'chart-tip' }); tip.style.display = 'none';
    cwrap.appendChild(cv); cwrap.appendChild(tip); card.appendChild(cwrap);
    const nums = data.filter(v => !isNaN(v));
    const mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums), av = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
    card.appendChild(el('div', { class: 'chart-stats', text: `min ${series.fmt(mn)}  \u00b7  avg ${series.fmt(av)}  \u00b7  max ${series.fmt(mx)}` }));
    const draw = hi => drawLineChart(cv, data, series, hi);
    requestAnimationFrame(() => { draw(-1); cur.textContent = series.fmt(data[data.length - 1]); });
    cv.addEventListener('mousemove', ev => {
      const r = cv.getBoundingClientRect(); const n = data.length;
      let i = Math.round((ev.clientX - r.left) / Math.max(1, r.width) * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
      draw(i); cur.textContent = series.fmt(data[i]);
      tip.style.display = 'block';
      tip.innerHTML = `<strong>${esc(series.fmt(data[i]))}</strong><span>${esc(timeAt(i))}</span>`;
      const px = (i / Math.max(1, n - 1)) * r.width;
      tip.style.left = Math.max(2, Math.min(r.width - tip.offsetWidth - 2, px - tip.offsetWidth / 2)) + 'px';
    });
    cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; draw(-1); cur.textContent = series.fmt(data[data.length - 1]); });
    window.addEventListener('resize', () => requestAnimationFrame(() => draw(-1)));
    return card;
  }

  function drawLineChart(canvas, data, opt, hoverIdx) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600, H = 110;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const padL = 6, padR = 6, padT = 12, padB = 12;
    let max = opt.max != null ? opt.max : (Math.max.apply(null, data) * 1.1 || 1); if (max <= 0) max = 1;
    const min = 0, n = data.length;
    const x = i => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
    const y = v => H - padB - ((v - min) / (max - min)) * (H - padT - padB);
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y(max)); ctx.lineTo(W - padR, y(max)); ctx.stroke();
    ctx.fillStyle = 'rgba(148,162,184,.65)'; ctx.font = '10px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.fillText(opt.fmt ? opt.fmt(max) : String(Math.round(max)), padL, 1);
    ctx.beginPath(); data.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.lineTo(x(n - 1), H - padB); ctx.lineTo(x(0), H - padB); ctx.closePath(); ctx.fillStyle = opt.color + '22'; ctx.fill();
    ctx.beginPath(); data.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.strokeStyle = opt.color; ctx.lineWidth = 1.6; ctx.stroke();
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      const hx = x(hoverIdx), hy = y(data[hoverIdx]);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, H - padB); ctx.stroke();
      ctx.fillStyle = opt.color; ctx.beginPath(); ctx.arc(hx, hy, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0d1017'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  /* ---------- call tree (collapsible) ---------- */
  function buildThreadTrees(report) {
    const threads = report.data.threads || [];
    return threads.map(t => {
      const pool = t.children || [];
      const memo = new Map();
      function nodeFromPool(idx) {
        if (memo.has(idx)) return memo.get(idx);
        const stn = pool[idx];
        const o = {
          name: (stn.className ? stn.className + '.' : '') + (stn.methodName || '?'),
          className: stn.className, methodName: stn.methodName,
          line: stn.lineNumber, value: sum(stn.times), _refs: stn.childrenRefs || [], _kids: null,
        };
        memo.set(idx, o);
        return o;
      }
      function expand(o) {
        if (o._kids) return o._kids;
        o._kids = (o._refs || []).map(nodeFromPool).sort((a, b) => b.value - a.value);
        return o._kids;
      }
      const root = {
        name: t.name, value: sum(t.times), _refs: t.childrenRefs || [], _kids: null,
        className: '', methodName: t.name, line: 0,
      };
      root.expand = expand; root.nodeFromPool = nodeFromPool;
      // attach expand to all via closure
      root._expand = expand;
      return { name: t.name, value: root.value, root, expand, pool };
    });
  }
  function sum(arr) { let s = 0; if (arr) for (let i = 0; i < arr.length; i++) s += arr[i]; return s; }

  function renderCallTree(report) {
    const wrap = el('div');
    const trees = buildThreadTrees(report);
    if (!trees.length) { wrap.appendChild(el('div', { class: 'empty', text: 'No thread data.' })); return wrap; }
    trees.sort((a, b) => b.value - a.value);

    const ctrl = el('div', { class: 'flame-ctrl' });
    const sel = el('select', { class: 'select' });
    trees.forEach((t, i) => sel.appendChild(el('option', { value: String(i), text: `${t.name} (${fmtMs(t.value)})` })));
    ctrl.appendChild(el('label', { class: 'ctrl-label', text: 'Thread:' }));
    ctrl.appendChild(sel);
    const search = el('input', { class: 'input search', type: 'text', placeholder: 'Filter methods…' });
    ctrl.appendChild(search);
    wrap.appendChild(ctrl);

    const host = el('div', { class: 'tree-host' });
    wrap.appendChild(host);

    function draw() {
      const tree = trees[Number(sel.value)];
      host.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      host.appendChild(treeNodeEl(tree.root, tree.value, tree.expand, q, 0, true));
    }
    sel.addEventListener('change', draw);
    let to; search.addEventListener('input', () => { clearTimeout(to); to = setTimeout(draw, 180); });
    draw();
    return wrap;
  }

  function treeNodeEl(node, total, expand, query, depth, openByDefault) {
    const kids = expand(node);
    const pct = total ? (node.value / total) * 100 : 0;
    const row = el('div', { class: 'tn' });
    const head = el('div', { class: 'tn-head' });
    const hasKids = kids.length > 0;
    const toggle = el('span', { class: 'tn-toggle', text: hasKids ? '▸' : '' });
    head.appendChild(toggle);
    const barWrap = el('span', { class: 'tn-bar' }, el('span', { class: 'tn-bar-fill', style: 'width:' + Math.min(100, pct) + '%' }));
    head.appendChild(barWrap);
    head.appendChild(el('span', { class: 'tn-pct', text: pct.toFixed(1) + '%' }));
    head.appendChild(el('span', { class: 'tn-time', text: fmtMs(node.value) }));
    const nameEl = el('span', { class: 'tn-name' }, [
      node.className ? el('span', { class: 'tn-cls', text: shortClass(node.className) + '.' }) : null,
      el('span', { class: 'tn-mth', text: node.methodName || node.name }),
    ]);
    head.appendChild(nameEl);
    row.appendChild(head);

    const childHost = el('div', { class: 'tn-children' });
    let expanded = false;
    function doExpand() {
      if (expanded) return; expanded = true;
      const matchKids = query ? kids.filter(k => subtreeMatches(k, expand, query)) : kids;
      matchKids.slice(0, 400).forEach(k => childHost.appendChild(treeNodeEl(k, total, expand, query, depth + 1, false)));
      if (matchKids.length > 400) childHost.appendChild(el('div', { class: 'tn-more', text: `… ${matchKids.length - 400} more` }));
    }
    function collapse() { expanded = false; childHost.innerHTML = ''; toggle.textContent = '▸'; }
    if (hasKids) {
      head.style.cursor = 'pointer';
      head.addEventListener('click', () => {
        if (expanded) collapse(); else { doExpand(); toggle.textContent = '▾'; }
      });
    }
    row.appendChild(childHost);
    // auto-open hot path or query path
    if ((openByDefault || (query && subtreeMatches(node, expand, query))) && hasKids && depth < 30) {
      doExpand(); toggle.textContent = '▾'; expanded = true;
    }
    return row;
  }
  function subtreeMatches(node, expand, query) {
    if ((node.name || '').toLowerCase().includes(query)) return true;
    const kids = expand(node);
    for (const k of kids) if (subtreeMatches(k, expand, query)) return true;
    return false;
  }
  function shortClass(c) { return c; }

  /* ---------- tick breakdown ---------- */
  function renderBreakdown(analysis) {
    const wrap = el('div');
    const b = analysis.breakdown;
    wrap.appendChild(el('div', { class: 'section-note', html:
      `This is where the <strong>${esc(b.threadName)}</strong> spent its time. Idle time (the server waiting for the next tick) is healthy, so it is left out of the percentages below.` }));
    const subs = analysis.subsystems.filter(s => s.ms > 0);
    const max = subs.length ? subs[0].pct : 1;
    const list = el('div', { class: 'bar-list' });
    subs.forEach(sb => {
      const row = el('div', { class: 'bar-row' });
      row.appendChild(el('div', { class: 'bar-label', html: `${sb.icon} ${esc(sb.label)}` }));
      const track = el('div', { class: 'bar-track' });
      const fill = el('div', { class: 'bar-fill', style: 'width:' + Math.max(2, (sb.pct / max) * 100) + '%' });
      if (sb.id === 'idle') fill.style.background = 'var(--line2)';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', { class: 'bar-val', text: (sb.pct * 100).toFixed(1) + '%' }));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    if (analysis.threads && analysis.threads.length) {
      wrap.appendChild(el('h4', { text: 'Other threads' }));
      wrap.appendChild(el('div', { class: 'section-note', text: 'Time on other threads (async chunk work, world saving, plugin/mod tasks). Only the main thread is broken down above.' }));
      const max2 = analysis.threads[0].ms || 1;
      const bl = el('div', { class: 'bar-list' });
      analysis.threads.forEach(t => bl.appendChild(barRow(t.name, t.ms, max2, fmtMs(t.ms))));
      wrap.appendChild(bl);
    }
    return wrap;
  }

  /* ---------- entity hotspots ---------- */
  function renderHotspots(analysis) {
    const wrap = el('div');
    const h = analysis.hotspots;
    wrap.appendChild(el('div', { class: 'section-note', html:
      `<strong>${fmtNum(h.totalEntities)}</strong> entities are loaded across ${h.worldCount || 1} world(s). Click a dimension to see its busiest chunks, then teleport to the "Go to" coordinates and clear or cap them. (Chunk coords \u00d7 16 = block coords.)` }));
    const worlds = (h.worlds && h.worlds.length) ? h.worlds : [{ name: 'world', total: h.totalEntities, chunks: h.chunks, types: h.types }];
    worlds.forEach((w, wi) => {
      const acc = el('div', { class: 'acc' });
      const arrow = el('span', { class: 'acc-arrow', text: '\u25b8' });
      const head = el('button', { class: 'acc-head' }, [
        arrow, el('span', { class: 'acc-title', text: w.name || 'world' }),
        el('span', { class: 'acc-total', html: `<strong>${fmtNum(w.total)}</strong> entities` }),
      ]);
      const body = el('div', { class: 'acc-body' });
      const t = el('table', { class: 'tbl' });
      t.appendChild(el('thead', {}, el('tr', {}, [th('#'), th('Chunk (x, z)'), th('Go to (x, z)'), th('Entities'), th('Top types')])));
      const tb = el('tbody');
      w.chunks.slice(0, 40).forEach((c, i) => {
        const tt = el('td', { class: 'tt-cell' });
        Object.entries(c.counts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([n, v]) => {
          tt.appendChild(entityIcon(n));
          tt.appendChild(el('span', { class: 'tt', text: n.replace(/^minecraft:/, '') + ' \u00d7' + v }));
        });
        tb.appendChild(el('tr', { class: c.total >= 400 ? 'flag-critical' : c.total >= 150 ? 'flag-warning' : '' }, [
          td(String(i + 1)), el('td', { class: 'mono', text: c.x + ', ' + c.z }),
          el('td', { class: 'mono', text: (c.x * 16) + ', ' + (c.z * 16) }), td(fmtNum(c.total)), tt,
        ]));
      });
      t.appendChild(tb); body.appendChild(t);
      if (w.types && w.types.length) {
        body.appendChild(el('h4', { text: 'Most common in ' + (w.name || 'world') }));
        const max = w.types[0][1]; const bl = el('div', { class: 'bar-list' });
        w.types.slice(0, 12).forEach(([n, v]) => bl.appendChild(iconBarRow(n, v, max)));
        body.appendChild(bl);
      }
      const open = wi === 0;
      body.style.display = open ? 'block' : 'none'; arrow.textContent = open ? '\u25be' : '\u25b8';
      head.addEventListener('click', () => { const o = body.style.display !== 'none'; body.style.display = o ? 'none' : 'block'; arrow.textContent = o ? '\u25b8' : '\u25be'; });
      acc.appendChild(head); acc.appendChild(body); wrap.appendChild(acc);
    });
    return wrap;
  }

  /* ---------- source attribution ---------- */
  function renderSources(analysis) {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-note', html:
      'How much of the active server-thread time each plugin or mod is responsible for (Minecraft itself and the JVM are shown too). If one add-on sits near the top, that is usually your biggest win.' }));
    const max = analysis.sources.length ? analysis.sources[0].pct : 1;
    const bl = el('div', { class: 'bar-list' });
    analysis.sources.forEach(srcRow => {
      const row = el('div', { class: 'bar-row' });
      const builtin = /^(Minecraft|JDK|Server software|Spark)/i.test(srcRow.name) || srcRow.name === (analysis.ctx.brand);
      row.appendChild(el('div', { class: 'bar-label', text: srcRow.name }));
      const track = el('div', { class: 'bar-track' });
      const fill = el('div', { class: 'bar-fill', style: 'width:' + Math.max(2, (srcRow.pct / max) * 100) + '%' });
      if (builtin) fill.style.background = 'var(--line2)';
      track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('div', { class: 'bar-val', text: (srcRow.pct * 100).toFixed(1) + '%' }));
      bl.appendChild(row);
    });
    wrap.appendChild(bl);
    return wrap;
  }

  /* ---------- flame graph (canvas) ---------- */
  function renderFlame(panel) {
    const host = panel.querySelector('#flame-host') || panel;
    host.innerHTML = '';
    const report = state.report;
    const trees = buildThreadTrees(report);
    if (!trees.length) { host.appendChild(el('div', { class: 'empty', text: 'No thread data.' })); return; }
    trees.sort((a, b) => b.value - a.value);

    const ctrl = el('div', { class: 'flame-ctrl' });
    const sel = el('select', { class: 'select' });
    trees.forEach((t, i) => sel.appendChild(el('option', { value: String(i), text: `${t.name} (${fmtMs(t.value)})` })));
    ctrl.appendChild(el('label', { class: 'ctrl-label', text: 'Thread:' }));
    ctrl.appendChild(sel);
    const search = el('input', { class: 'input search', type: 'text', placeholder: 'Highlight methods…' });
    ctrl.appendChild(search);
    const resetBtn = el('button', { class: 'btn ghost sm', text: 'Reset zoom' });
    ctrl.appendChild(resetBtn);
    host.appendChild(ctrl);

    const canvasWrap = el('div', { class: 'flame-wrap' });
    const canvas = el('canvas', { class: 'flame-canvas' });
    canvasWrap.appendChild(canvas);
    host.appendChild(canvasWrap);
    const tip = el('div', { class: 'flame-tip' });
    tip.style.display = 'none';
    document.body.appendChild(tip);

    const ROW = 20;
    let frames = [];      // {node, depth, x0, x1}
    let focus = null;     // node currently zoomed to
    let rootNode, rootValue, expandFn;
    let highlight = '';

    function buildFrames() {
      frames = [];
      const tree = trees[Number(sel.value)];
      rootNode = tree.root; rootValue = tree.value; expandFn = tree.expand;
      const base = focus || rootNode;
      const baseValue = base.value;
      // BFS/DFS building layout; lazily expand
      (function layout(node, depth, x0) {
        const w = baseValue ? node.value / baseValue : 0;
        frames.push({ node, depth, x0, x1: x0 + w });
        const kids = expandFn(node);
        let cx = x0;
        for (const k of kids) {
          const kw = baseValue ? k.value / baseValue : 0;
          if (kw * 1 < 0.0002 && depth > 0) { cx += kw; continue; } // skip tiny
          layout(k, depth + 1, cx);
          cx += kw;
        }
      })(base, 0, 0);
    }

    let maxDepth = 0;
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      maxDepth = frames.reduce((m, f) => Math.max(m, f.depth), 0);
      const W = canvasWrap.clientWidth || 800;
      const H = (maxDepth + 1) * ROW + 4;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      canvas.width = W * dpr; canvas.height = H * dpr;
      const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      c.font = '11px ui-monospace, Menlo, Consolas, monospace';
      c.textBaseline = 'middle';
      for (const f of frames) {
        const x = f.x0 * W, w = Math.max(0.5, (f.x1 - f.x0) * W);
        const y = f.depth * ROW;
        const hot = highlight && (f.node.name || '').toLowerCase().includes(highlight);
        c.fillStyle = hot ? '#e879f9' : frameColor(f.node);
        c.fillRect(x, y, Math.max(0.5, w - 1), ROW - 1);
        if (w > 28) {
          c.fillStyle = 'rgba(0,0,0,.82)';
          const label = (f.node.methodName || f.node.name || '');
          c.fillText(fit(c, label, w - 8), x + 4, y + (ROW - 1) / 2 + 0.5);
        }
      }
    }
    function fit(c, text, w) {
      if (c.measureText(text).width <= w) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (c.measureText(text.slice(0, mid) + '…').width <= w) lo = mid + 1; else hi = mid; }
      return text.slice(0, Math.max(0, lo - 1)) + '…';
    }

    function frameAt(px, py) {
      const W = canvasWrap.clientWidth || 800;
      const depth = Math.floor(py / ROW);
      const fx = px / W;
      for (const f of frames) if (f.depth === depth && fx >= f.x0 && fx <= f.x1) return f;
      return null;
    }

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const f = frameAt(e.clientX - r.left, e.clientY - r.top);
      if (!f) { tip.style.display = 'none'; canvas.style.cursor = 'default'; return; }
      canvas.style.cursor = 'pointer';
      const pctRoot = rootValue ? (f.node.value / rootValue) * 100 : 0;
      tip.innerHTML = `<div class="tip-name">${esc((f.node.className ? f.node.className + '.' : '') + (f.node.methodName || f.node.name))}</div>`
        + `<div class="tip-meta">${fmtMs(f.node.value)} · ${pctRoot.toFixed(2)}% of thread${f.node.line > 0 ? ' · line ' + f.node.line : ''}</div>`
        + `<div class="tip-hint">click to zoom</div>`;
      tip.style.display = 'block';
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    });
    canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect();
      const f = frameAt(e.clientX - r.left, e.clientY - r.top);
      if (f) { focus = f.node; buildFrames(); draw(); }
    });
    resetBtn.addEventListener('click', () => { focus = null; buildFrames(); draw(); });
    sel.addEventListener('change', () => { focus = null; buildFrames(); draw(); });
    let to; search.addEventListener('input', () => { clearTimeout(to); to = setTimeout(() => { highlight = search.value.trim().toLowerCase(); draw(); }, 120); });
    window.addEventListener('resize', () => { clearTimeout(window.__flto); window.__flto = setTimeout(draw, 150); });

    buildFrames(); draw();
  }

  const COLORS = ['#f59e0b', '#fbbf24', '#fcd34d', '#fb923c', '#f97316', '#facc15', '#eab308', '#fde047'];
  function frameColor(node) {
    const n = node.className || node.name || '';
    if (/^java\.|^jdk\.|^sun\.|^javax\./.test(n)) return '#9aa4b2';          // jdk = grey
    if (/^net\.minecraft\.|^com\.mojang\./.test(n)) return '#7dd3fc';        // vanilla = blue
    if (/paper|spigot|bukkit/i.test(n)) return '#86efac';                    // server = green
    // plugin / other = warm hash
    let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff;
    return COLORS[h % COLORS.length];
  }

})();
