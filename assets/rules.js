/* =========================================================================
 * Spark Analyzer — recommendation engine (flame-graph driven, platform-aware)
 * Leads with "what is eating your ticks", maps each hot subsystem to a
 * concrete fix + the right optimization mod for the detected platform.
 * Never recommends upgrading the Minecraft version.
 * ========================================================================= */

const SparkRules = (() => {

  /* ---------- helpers ---------- */
  const S = v => (v == null) ? '' : String(v).trim();
  const isTrue = v => v === true || S(v).toLowerCase() === 'true';
  const isFalse = v => v === false || S(v).toLowerCase() === 'false';
  const num = v => { const n = parseFloat(S(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  function get(o, path) { let c = o; for (const k of path) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; }
  function parseJsonMaybe(s) { if (s == null) return undefined; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return undefined; } }
  function paperWorld(p, path) { if (!p) return undefined; let v = get(p, ['world-defaults.yml', ...path]); if (v !== undefined) return v; return get(p, ['world-settings', 'default', ...path]); }
  function parseXmx(flags, prefix) {
    const re = new RegExp('\\' + prefix + '(\\d+)([gGmMkK]?)'); const m = re.exec(flags || '');
    if (!m) return null; let n = parseInt(m[1]); const u = m[2].toLowerCase();
    if (u === 'g') n *= 1024; else if (u === 'k') n = Math.round(n / 1024); else if (u === '') n = Math.round(n / 1048576);
    return n; // MB
  }
  const sum = a => { let s = 0; if (a) for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const fmtMs = ms => ms < 1 ? (ms * 1000).toFixed(0) + 'µs' : ms < 1000 ? ms.toFixed(ms < 10 ? 1 : 0) + 'ms' : (ms / 1000).toFixed(1) + 's';

  /* ---------- context ---------- */
  function buildContext(report) {
    const md = report.data.metadata || {};
    const pm = md.platformMetadata || {};
    const platform = SparkKB.classifyPlatform({ platformName: pm.name, brand: pm.brand, platformType: pm.type });
    const sources = md.sources || {};
    const plugins = Object.values(sources).map(p => ({ name: p.name, version: p.version, author: p.author || '', description: p.description || '' }));
    const rawCfg = md.serverConfigurations || {};
    const configs = {
      serverProperties: parseJsonMaybe(rawCfg['server.properties']),
      bukkit: parseJsonMaybe(rawCfg['bukkit.yml']),
      spigot: parseJsonMaybe(rawCfg['spigot.yml']),
      paper: parseJsonMaybe(rawCfg['paper/']) || parseJsonMaybe(rawCfg['paper.yml']),
      purpur: parseJsonMaybe(rawCfg['purpur.yml']),
    };
    const sys = md.systemStatistics || {};
    const ps = md.platformStatistics || {};
    const flags = (sys.java && sys.java.vmArgs) || '';
    return {
      report, type: report.type, platform,
      brand: pm.brand || pm.name || 'Unknown', mcVersion: pm.minecraftVersion || '', serverVersion: pm.version || '',
      plugins, hasPlugin: n => plugins.some(p => (p.name || '').toLowerCase() === n.toLowerCase()),
      configs, system: sys, platformStats: ps,
      flags, xmx: parseXmx(flags, '-Xmx'), xms: parseXmx(flags, '-Xms'),
      jvmVersion: (sys.java && sys.java.version) || '', threads: get(sys, ['cpu', 'threads']) || 0,
      cpuModel: get(sys, ['cpu', 'modelName']) || '',
      players: num(ps.playerCount) || 0, tps: ps.tps || null, mspt: ps.mspt || null,
      threadsData: report.data.threads || [], classSources: report.data.classSources || {},
      installedNorm: new Set(plugins.map(pl => SparkKB.norm(pl.name))),
      isServerReport: (pm.type === 'SERVER' || pm.type == null),
      reportKind: (pm.type === 'CLIENT' ? 'client' : pm.type === 'PROXY' ? 'proxy' : 'server'),
      samplerMode: md.samplerMode || 'EXECUTION',
      isAllocation: md.samplerMode === 'ALLOCATION',
      profile: { ticks: num(md.numberOfTicks), interval: num(md.interval), engine: md.samplerEngine || '',
        startTime: num(md.startTime), endTime: num(md.endTime),
        durationMs: (num(md.endTime) && num(md.startTime)) ? num(md.endTime) - num(md.startTime) : null },
    };
  }

  function avgTps(tps) { if (!tps) return null; return Math.min((num(tps.last1m) + num(tps.last5m) + num(tps.last15m)) / 3, 20); }

  /* ---------- flame-graph breakdown ----------
   * Nearest-classified-ancestor self-time attribution: partitions 100% of the
   * thread's time across subsystems, and (separately) across plugin/mod sources.
   */
  function pickMainThread(threads) {
    if (!threads.length) return null;
    let server = threads.find(t => /server thread/i.test(t.name)) || threads.find(t => /^main$/i.test(t.name));
    if (server) return server;
    return threads.slice().sort((a, b) => sum(b.times) - sum(a.times))[0];
  }

  function computeBreakdown(thread, classSources, serverBrand, sources) {
    const pool = thread.children || [];
    const bySub = {}, bySource = {};
    let total = sum(thread.times) || 0, idle = 0;

    function srcOf(cn) {
      if (classSources && classSources[cn]) return classSources[cn];
      const o = SparkKB.originOfClass(cn);
      if (o === 'vanilla') return 'Minecraft (vanilla)';
      if (o === 'jdk') return 'JDK / JVM';
      if (o === 'server') return serverBrand || 'Server software';
      const guess = SparkKB.guessSourceFromPackage(cn, sources);
      return guess || 'Unattributed code';
    }

    // iterative DFS to avoid deep recursion limits on big profiles
    const rootKids = (thread.childrenRefs || []).map(i => pool[i]).filter(Boolean);
    const stack = rootKids.map(n => ({ n, sub: null }));
    while (stack.length) {
      const { n, sub } = stack.pop();
      const val = sum(n.times);
      const kidsRefs = n.childrenRefs || [];
      let kidSum = 0;
      for (const i of kidsRefs) { const c = pool[i]; if (c) kidSum += sum(c.times); }
      const self = Math.max(0, val - kidSum);
      const cls = n.className, mth = n.methodName;
      const cid = SparkKB.classifyFrame(cls, mth);
      const cur = cid || sub; // nearest classified ancestor
      if (cid && SparkKB.subsystemMeta(cid).idle) { idle += self; }
      else if (cur) { bySub[cur] = (bySub[cur] || 0) + self; }
      else { bySub['other'] = (bySub['other'] || 0) + self; }
      // source attribution (skip idle)
      if (!(cid && SparkKB.subsystemMeta(cid).idle)) {
        const sname = srcOf(cls);
        bySource[sname] = (bySource[sname] || 0) + self;
      }
      for (const i of kidsRefs) { const c = pool[i]; if (c) stack.push({ n: c, sub: cur }); }
    }
    const active = Math.max(1, total - idle);
    return { total, idle, active, bySub, bySource, threadName: thread.name };
  }

  /* ---------- per-subsystem advice ---------- */
  const ADVICE = {
    entities: { what: 'Most of the server time goes into ticking entities like mobs and dropped items. Usually that just means too many of them are loaded.',
      generic: ['Open the **Entity Hotspots** tab to find the exact chunks, then clear them out or cap them.'],
      bukkit: ['Lower mob caps (`spawn-limits` in bukkit.yml).', 'Tighten `entity-activation-range` (spigot.yml).', 'On Purpur/Pufferfish enable **DAB** to throttle far-away entity AI.'] },
    mobai: { what: 'Mob AI and pathfinding is heavy. That happens when lots of mobs are actively thinking and finding their way around (dense farms, villagers, piglins and so on).',
      generic: ['Reduce the number of loaded mobs.'],
      bukkit: ['Turn on **DAB** (Purpur or Pufferfish). It is the single biggest win for mob AI cost.', 'Lower `entity-activation-range` (spigot.yml).'] },
    spawning: { what: 'Natural mob spawning is using a lot of time. Your spawn caps are letting too many mobs spawn each tick.',
      generic: ['Lower the mob cap.'],
      bukkit: ['Reduce `spawn-limits` (bukkit.yml).', 'Enable `per-player-mob-spawns: true` (paper).'] },
    villagers: { what: 'Villager AI / POI processing is heavy.',
      generic: ['Reduce the number of villagers, or split large trading halls.'],
      bukkit: ['Enable **DAB** and lower villager `brain-ticks` (Purpur).'] },
    blockentities: { what: 'Block entities (chests, furnaces, barrels and so on) are heavy. This usually means very large storage systems.',
      generic: ['Reduce the number of loaded tile entities.'], bukkit: [] },
    hoppers: { what: 'Hoppers are a big cost. Every hopper checks for items above it every tick, even when it is empty.',
      generic: ['Use water streams and droppers instead of long hopper lines, and keep the number of hoppers down.', 'If it keeps running with nobody nearby, check your spawn chunks and any force-loaded chunks.'],
      bukkit: ['Set `hopper.disable-move-event: true` (paper).', 'Raise `ticks-per.hopper-transfer` / `hopper-check` 8 → 16 (spigot.yml).'] },
    blockticks: { what: 'Random block ticks (crops growing, fire spreading, fluids, ice and snow) are heavy. Usually this means very large farms.',
      generic: ['Shrink oversized farms; lower the `randomTickSpeed` gamerule if appropriate.', 'If it keeps running with nobody nearby, check your spawn chunks and any force-loaded chunks.'], bukkit: [] },
    chunks: { what: 'Loading, saving and managing chunks is heavy. This is normally caused by players exploring quickly, or by too many chunk loaders.',
      generic: ['Pre-generate the world with [Chunky](https://modrinth.com/plugin/chunky) so chunks are not built live while players explore.', 'Lower `view-distance` a notch.', 'Find any chunk loaders or always-loaded areas and remove them.'], bukkit: [] },
    worldgen: { what: 'The server is building new world on the fly, which is expensive. It happens when players explore into land that has not been generated yet.',
      generic: ['Pre-generate the world ahead of players with [Chunky](https://modrinth.com/plugin/chunky).', 'Lower `view-distance`.'], bukkit: [] },
    lighting: { what: 'The lighting engine is using a lot of time.',
      generic: [], bukkit: ['Modern Paper already includes the faster Starlight engine, so this is unusual. Check whether a plugin is doing light updates.'] },
    redstone: { what: 'Redstone is using a lot of time. Usually big contraptions, clocks, or observer loops are behind it.',
      generic: ['Reduce redstone clocks / observer loops.', 'If it keeps running with nobody nearby, check your spawn chunks and any force-loaded chunks.'],
      bukkit: ['Set `redstone-implementation: ALTERNATE_CURRENT` (paper-world-defaults.yml).'] },
    fluids: { what: 'Flowing water and lava are using a lot of time. Large areas of moving liquid are usually the cause.',
      generic: ['Reduce large areas of flowing water/lava.'], bukkit: [] },
    network: { what: 'Networking and entity tracking is heavy. This normally means a lot of players, or a lot of visible entities to keep in sync.',
      generic: ['Lower `view-distance` to cut what must be sent.', 'Reduce the number of entities (see the Entity Hotspots tab).'], bukkit: [] },
    datapack: { what: 'Datapack command functions are using a lot of time.',
      generic: ['Use `/perf` in-game to find the costly functions, then optimize or disable them.'], bukkit: [] },
    storage: { what: 'Saving the world to disk is heavy. Often this is a slow disk, or very large auto-saves.',
      generic: ['Use NVMe/SSD storage; avoid HDD-backed hosts.', 'Lower how often the world auto-saves (the max-auto-save-chunks-per-tick setting on Paper).'], bukkit: [] },
    other: { what: 'A big share of time is in code that does not match a known area. Usually that is a specific plugin or mod (check the Sources tab), or a custom system.',
      generic: ['Check the **Sources** tab to see which plugin or mod is responsible for this time.'], bukkit: [] },
  };

  function mk(sev, cat, title, detail, fix, mods, link, impact) {
    return { severity: sev, category: cat, title, detail: detail || '', fix: fix || '', mods: mods || [], link: link || '', impact: impact || 0 };
  }

  function subsystemFinding(subId, ms, pct, ctx, lagging) {
    const meta = SparkKB.subsystemMeta(subId) || { label: subId, icon: '•' };
    const adv = ADVICE[subId] || ADVICE.other;
    let sev;
    if (lagging) sev = pct >= 0.25 ? 'critical' : pct >= 0.12 ? 'warning' : 'info';
    else sev = 'info'; // when TPS is healthy, the breakdown is informational, not a problem
    const fixes = [adv.what, ...(adv.generic || [])];
    if (ctx.platform.isBukkit && adv.bukkit && adv.bukkit.length) fixes.push(...adv.bukkit);
    let mods = [];
    if (subId !== 'other' && subId !== 'lighting') {
      mods = SparkKB.modsFor(ctx.platform.loader, subId).filter(m => !SparkKB.isModInstalled(m.id, ctx.installedNorm)).slice(0, 3).map(m => ({ name: m.name, url: m.url, blurb: m.blurb }));
    }
    const unit = ctx.isAllocation ? 'of allocations' : 'of the tick';
    let detail = adv.what;
    if (!lagging && !ctx.isAllocation) detail += ' (Your TPS is fine, so this is just where the current, light workload is going.)';
    return mk(sev, ctx.isAllocation ? 'Allocations' : 'Tick time', `${meta.icon} ${meta.label}: ${(pct * 100).toFixed(0)}% ${unit}`,
      detail,
      (adv.generic || []).concat(ctx.platform.isBukkit ? (adv.bukkit || []) : []).join('\n'),
      mods, '', pct);
  }

  /* ---------- entity hotspots ---------- */
  function entityHotspots(ctx) {
    const world = get(ctx.platformStats, ['world']);
    if (!world) return null;
    const allChunks = [];
    const worlds = (world.worlds || []).map(w => {
      const chunks = [], types = {};
      (w.regions || []).forEach(r => (r.chunks || []).forEach(c => {
        if ((c.totalEntities || 0) > 0) {
          const obj = { world: w.name, x: c.x, z: c.z, total: c.totalEntities, counts: c.entityCounts || {} };
          chunks.push(obj); allChunks.push(obj);
          Object.entries(c.entityCounts || {}).forEach(([k, v]) => { types[k] = (types[k] || 0) + v; });
        }
      }));
      chunks.sort((a, b) => b.total - a.total);
      return { name: w.name, total: w.totalEntities || chunks.reduce((s, c) => s + c.total, 0),
        chunks, types: Object.entries(types).sort((a, b) => b[1] - a[1]) };
    }).filter(w => w.chunks.length).sort((a, b) => b.total - a.total);
    allChunks.sort((a, b) => b.total - a.total);
    const totalEntities = world.totalEntities || allChunks.reduce((s, c) => s + c.total, 0);
    const types = Object.entries(world.entityCounts || {}).sort((a, b) => b[1] - a[1]);
    return { chunks: allChunks.slice(0, 25), worlds, totalEntities, types, worldCount: worlds.length };
  }

  /* ---------- memory / GC ---------- */
  function memoryAnalysis(ctx) {
    const ps = ctx.platformStats, sys = ctx.system;
    const heap = get(ps, ['memory', 'heap']);
    const gc = sys.gc || {};
    const out = { heap: null, gc: [], findings: [] };
    if (heap && num(heap.max)) {
      const used = num(heap.used), max = num(heap.max);
      out.heap = { used, max, ratio: used / max };
    }
    Object.entries(gc).forEach(([name, g]) => out.gc.push({ name, avgTime: num(g.avgTime), avgFreq: num(g.avgFrequency), total: num(g.total) }));
    return out;
  }

  /* ---------- blog-derived hardware / RAM / bottleneck intelligence ---------- */
  function estimateRamGb(ctx) {
    const players = ctx.players || 0;
    const count = ctx.plugins.length;
    let base, perAddon, floor;
    if (ctx.platform.isModded) { base = 3; perAddon = 0.025; floor = 6; }
    else if (ctx.platform.isBukkit) { base = 2.5; perAddon = 0.02; floor = 4; }
    else { base = 2; perAddon = 0.01; floor = 3; }
    const est = base + players * 0.2 + count * perAddon;
    const min = Math.max(floor, Math.round(est));
    return { min, max: min + (ctx.platform.isModded ? 4 : 2), est, count };
  }

  function hardwareFindings(ctx, subsystems, memory, lagging, issues) {
    const ps = ctx.platformStats, sys = ctx.system;
    const heap = get(ps, ['memory', 'heap']);
    const heapRatio = heap && num(heap.max) ? num(heap.used) / num(heap.max) : null;
    const oldGc = (memory.gc || []).find(g => /old/i.test(g.name));
    const longGc = oldGc && oldGc.avgTime > 150;
    const frequentGc = oldGc && oldGc.avgFreq != null && oldGc.avgFreq > 0 && oldGc.avgFreq < 20; // a full GC more often than every ~20s
    const memBound = longGc || frequentGc || (heapRatio != null && heapRatio >= 0.95 && !!oldGc);

    // ---- bottleneck verdict (top recommendation) ----
    const cpuProc = get(sys, ['cpu', 'processUsage', 'last1m']);
    const cpuPct = cpuProc != null ? (num(cpuProc) <= 1 ? num(cpuProc) * 100 : num(cpuProc)) : null;
    if (lagging && !ctx.isAllocation) {
      if (memBound) {
        issues.push(mk('critical', 'Diagnosis', '🧭 Main limit: RAM (memory)',
          `The server is lagging and memory is under pressure${heapRatio != null ? ` (heap ${(heapRatio * 100).toFixed(0)}%` : ''}${longGc ? `, ${oldGc.name} pauses about ${oldGc.avgTime.toFixed(0)}ms` : ''}${heapRatio != null ? ')' : ''}. In this case, adding RAM (and memory mods) really does help.`,
          'Raise the heap toward the recommended range below, use Aikar’s flags, and if you are modded, add the memory mods listed.',
          ctx.platform.isModded ? SparkKB.MODS.filter(m => (m.scenarios || []).includes('memory') && m.platforms.includes(ctx.platform.loader)).slice(0, 2).map(m => ({ name: m.name, url: m.url, blurb: m.blurb })) : [], '', 99));
      } else {
        issues.push(mk('critical', 'Diagnosis', '🧭 Main limit: CPU, not RAM',
          `The server is lagging but memory looks fine${heapRatio != null ? ` (heap is only ${(heapRatio * 100).toFixed(0)}%)` : ''}, so the real problem is how much work each tick has to do, not RAM. Heads up: the overall CPU number${cpuPct != null ? ` (${cpuPct.toFixed(0)}%)` : ''} can look low here, because Minecraft does almost all of its work on a single CPU core. That one core can be maxed out even while total CPU usage looks quiet.`,
          'Adding RAM will not help here. Cut down the work each tick using the Tick Breakdown (start with the biggest item), or move to a host with a faster single core.', [], '', 99));
      }
    }

    // ---- memory pressure detail (skip if it is already the memory-bound verdict) ----
    if (!(lagging && memBound) && !ctx.isAllocation && (longGc || frequentGc || (heapRatio != null && heapRatio >= 0.92))) {
      const bits = [];
      if (heapRatio != null) bits.push(`heap at ${(heapRatio * 100).toFixed(0)}%`);
      if (longGc) bits.push(`${oldGc.name} pauses ~${oldGc.avgTime.toFixed(0)}ms`);
      else if (frequentGc) bits.push('frequent full GCs');
      const mm = ctx.platform.isModded ? SparkKB.MODS.filter(m => (m.scenarios || []).includes('memory') && m.platforms.includes(ctx.platform.loader)).slice(0, 2).map(m => ({ name: m.name, url: m.url, blurb: m.blurb })) : [];
      issues.push(mk('warning', 'Memory', '🧠 Memory pressure',
        `Signs of memory pressure (${bits.join(', ')}). That leads to GC pauses, which show up as stutter.`,
        ctx.platform.isModded ? 'Give the server a little more RAM, use good GC flags, and add the memory mods below.' : 'Give the server a little more RAM and use Aikar\'s flags.', mm, '', 0.34));
    }

    // ---- RAM right-sizing + over-allocation ----
    if (ctx.isServerReport && ctx.xmx != null) {
      const xmxGb = ctx.xmx / 1024;
      const band = estimateRamGb(ctx);
      const phys = get(sys, ['memory', 'physical']);
      const physGb = phys && num(phys.total) ? num(phys.total) / 1073741824 : null;
      const addonWord = ctx.platform.isModded ? 'mods' : 'plugins';
      if (xmxGb < band.min - 0.5) {
        issues.push(mk('warning', 'Memory', '💾 Likely under-allocated RAM',
          `Right now about ${xmxGb.toFixed(1)} GB is set aside for the server. A ${ctx.platform.label} server with ${band.count} ${addonWord} and around ${ctx.players} players usually wants about **${band.min}-${band.max} GB**.`,
          `Raise \`-Xmx\` to around ${band.min}-${band.max} GB, and set \`-Xms\` to the same value.`,
          ctx.platform.isModded ? SparkKB.MODS.filter(m => (m.scenarios || []).includes('memory') && m.platforms.includes(ctx.platform.loader)).slice(0, 2).map(m => ({ name: m.name, url: m.url, blurb: m.blurb })) : [], '', 0.35));
      } else if (physGb && xmxGb > physGb * 0.85) {
        issues.push(mk('warning', 'Memory', '💾 Too much RAM allocated to the heap',
          `About ${xmxGb.toFixed(1)} GB of the machine’s ${physGb.toFixed(0)} GB is handed to the server, which leaves very little for the operating system. Giving Java too much can also make its cleanup pauses longer. A good target is about 60-70% of the machine’s RAM.`,
          'Leave 2-4 GB free for the operating system, and lower `-Xmx` if the server never actually uses it all.', [], '', 0.2));
      }
    }

    // ---- CPU threads + model quality ----
    if (ctx.threads && ctx.threads <= 2)
      issues.push(mk('warning', 'Hardware', `🧮 Only ${ctx.threads} CPU thread(s)`,
        'Minecraft is largely single-threaded but still needs cores for GC, chunk work and async tasks. Two or fewer will bottleneck a busy server.',
        'Move to a host with faster single-thread performance and ≥4 cores.', [], '', 0.1));
    const cq = SparkKB.cpuQuality(ctx.cpuModel);
    if (cq.tier === 'weak')
      issues.push(mk(lagging ? 'warning' : 'info', 'Hardware', '🧮 Weak CPU for Minecraft',
        `Your CPU (\`${ctx.cpuModel}\`) is ${cq.note}`,
        'Minecraft is limited by single-core speed. A modern, high-clock CPU (AMD Ryzen, ideally an X3D model) will raise your TPS ceiling far more than extra cores or extra RAM.', [], '', 0.15));

    // ---- Java runtime ----
    const recJ = SparkKB.recommendedJava(ctx.mcVersion), curJ = SparkKB.javaMajor(ctx.jvmVersion);
    if (curJ && recJ && curJ < recJ)
      issues.push(mk(curJ <= 8 ? 'warning' : 'info', 'JVM', `☕ Update Java runtime to ${recJ}`,
        `The server is using Java ${curJ}. Minecraft ${ctx.mcVersion} runs best on Java ${recJ}, which is faster and handles memory better.`,
        `Switch the server’s Java version to ${recJ}. (This means the Java runtime, not your Minecraft version.)`, [], '', 0.1));

    // ---- large-heap ZGC option ----
    if (ctx.flags && ctx.xmx != null && ctx.xmx >= 12288 && !/UseZGC|UseShenandoah/.test(ctx.flags))
      issues.push(mk('info', 'JVM', '⚙️ Big heap: ZGC is an option',
        `With about ${(ctx.xmx / 1024).toFixed(0)} GB of heap, the ZGC garbage collector can smooth out GC stutter. It wants plenty of RAM and a decent CPU, so on an older or small machine stick with Aikar's G1 flags.`,
        'On Java 21 or newer you can try `-XX:+UseZGC -XX:+ZGenerational` instead of the G1 flags.', [], '', 0.05));

    // ---- Folia caveat ----
    if (/folia/i.test(ctx.brand) && ctx.plugins.length > 0)
      issues.push(mk('info', 'Platform', '🧵 Folia breaks many plugins',
        'Folia splits worlds across threads for very large servers, but plugins must be explicitly Folia-aware or they break.',
        'Confirm every plugin supports Folia; if any don’t, Paper or Purpur is the safer choice.', [], '', 0));

    // ---- plugin/mod count context ----
    const n = ctx.plugins.length;
    if (ctx.platform.isModded && n >= 200)
      issues.push(mk('info', 'Plugins', `🧩 Large modpack (~${n} mods)`,
        'Big packs are inherently heavy on RAM and CPU.',
        'Make sure RAM matches the pack size and lean on optimization mods; the Sources tab shows which mods cost the most.', [], '', 0));
    else if (ctx.platform.isBukkit && n >= 45)
      issues.push(mk('info', 'Plugins', `🧩 ${n} plugins installed`,
        'Lots of plugins add up, especially when they overlap (for example two economy plugins, or two chat plugins).',
        'Audit for unused/overlapping plugins; the Sources tab shows which ones actually cost tick time.', [], '', 0));
  }

  /* ---------- source attribution ---------- */
  function sourceFindingsAndPanel(breakdown, ctx, lagging) {
    const entries = Object.entries(breakdown.bySource).map(([name, ms]) => ({ name, ms, pct: ms / breakdown.active }))
      .sort((a, b) => b.ms - a.ms);
    const builtins = /^(Minecraft|JDK|Server software|Spark|spark)/i;
    const findings = [];
    const topAddon = entries.find(e => !builtins.test(e.name) && e.name !== ctx.brand && e.name !== 'Unattributed code');
    if (topAddon && topAddon.pct >= 0.15) {
      findings.push(mk(lagging ? 'critical' : 'warning', 'Source', `🧩 ${topAddon.name} is using ${(topAddon.pct * 100).toFixed(0)}% of the server thread`,
        `Code from ${topAddon.name} accounts for ${fmtMs(topAddon.ms)} of work. When a single plugin or mod uses this much, it is usually the biggest one thing you can fix.`,
        'Update it, check its config, or test the server with it removed to confirm. See the Sources tab for the full breakdown.', [], '', topAddon.pct));
    }
    return { panel: entries.slice(0, 15), findings };
  }

  /* ---------- safety / sanity ---------- */
  function safetyFindings(ctx, lagging, issues) {
    // server-software fork suggestion
    const fork = SparkKB.forkSuggestion(ctx.platform);
    if (fork) issues.push(mk(fork.sev, 'Platform', '🛠️ Server software', fork.text, '', [], fork.url, 0));

    // online-mode security (only if no proxy)
    const sp = ctx.configs.serverProperties, spg = ctx.configs.spigot, pap = ctx.configs.paper;
    if (sp) {
      const bungee = isTrue(get(spg, ['settings', 'bungeecord']));
      const velocity = isTrue(get(pap, ['settings', 'velocity-support', 'enabled'])) || isTrue(get(pap, ['global.yml', 'proxies', 'velocity', 'enabled']));
      if (isFalse(sp['online-mode']) && !bungee && !velocity)
        issues.push(mk('warning', 'Security', '🔓 online-mode is off',
          'This server has `online-mode=false` and we did not detect a proxy in front of it. If the server is directly reachable, anyone could log in as any username (including operators).',
          'If the server is standalone, set `online-mode=true`. If it actually sits behind a BungeeCord or Velocity proxy, you can ignore this.', [], '', 0));
    }

    // anti-lag / known-bad plugins
    const BAD = {
      clearlag: 'Anti-lag plugins like this usually cause *more* lag. They constantly scan and delete entities, and can break game mechanics. Remove it and fix the real cause instead.',
      nomoblag: 'Anti-lag plugins cause more lag than they save. Remove it.',
      antilag: 'Anti-lag plugins cause more lag than they save. Remove it.',
      serverbooster: 'Anti-lag plugins cause more lag than they save. Remove it.',
      lagassist: 'Use it for stats only, and turn off its active "anti-lag" features.',
    };
    ctx.plugins.forEach(p => { const k = (p.name || '').toLowerCase(); if (BAD[k]) issues.push(mk('warning', 'Plugins', `🧹 ${p.name}`, BAD[k], '', [], '', 0)); });

    // JVM flags — only the high-impact checks, concise
    const f = ctx.flags;
    if (f) {
      const aikar = f.includes('-Daikars.new.flags=true');
      const zgc = f.includes('-XX:+UseZGC') || f.includes('-XX:+UseShenandoahGC');
      if (!aikar && !zgc)
        issues.push(mk('warning', 'JVM', '⚙️ Not using Aikar’s flags',
          'Aikar’s flags tune the G1 garbage collector for Minecraft and noticeably reduce GC-related lag spikes.',
          'Use Aikar’s flags in your startup command.', [], 'https://docs.papermc.io/paper/aikars-flags', 0));
      else if (aikar && ctx.xms != null && ctx.xmx != null && ctx.xms !== ctx.xmx)
        issues.push(mk('info', 'JVM', '⚙️ Xms should equal Xmx', 'With Aikar’s flags, min and max heap should be identical.', 'Set `-Xms` equal to `-Xmx`.', [], '', 0));
    }

  }

  /* ---------- mod audit (MC-Optimization-Guide) ---------- */
  function modFindings(ctx, lagging, issues) {
    const minor = parseInt((ctx.mcVersion || '').split('.')[1]) || 0;

    // BleedingPipe: old Forge remote-code-execution hole
    if (ctx.platform.loader === 'forge' && minor >= 7 && minor <= 20)
      issues.push(mk('warning', 'Security', '🔓 Old Forge security hole (BleedingPipe)',
        'Forge versions around 1.7 to 1.20.1 have a known remote-code-execution bug (called BleedingPipe) in how some mods send data over the network.',
        'Add the SerializationIsBad mod (or move to a patched build) to close the hole.',
        [{ name: 'SerializationIsBad', url: 'https://modrinth.com/mod/serializationisbad', blurb: 'Patches the BleedingPipe / ObjectInputStream security hole in older Forge.' }], '', 0.3));

    if (!ctx.platform.isModded) return;
    const names = ctx.plugins.map(p => p.name);
    if (!names.length) return;
    const audit = SparkKB.modAudit(names, ctx.platform.loader, ctx.mcVersion);

    // junk / harmful: firm, one finding each (capped)
    audit.remove.slice(0, 8).forEach(r => {
      issues.push(mk('warning', 'Mods', `🗑️ Remove ${r.name}`, `${r.name} ${r.reason}`, 'Take it out of your mods folder.', [], '', 0.25));
    });
    if (audit.remove.length > 8)
      issues.push(mk('info', 'Mods', `🗑️ ${audit.remove.length - 8} more mods worth removing`, 'A few more flagged mods were left off this list to keep it short.', '', [], '', 0.05));

    // redundant: gentle, combined
    if (audit.redundant.length) {
      const lines = audit.redundant.map(r => `• ${r.name} ${r.reason}${r.alt ? ` (you already have, or should use, ${r.alt})` : ''}`).join('\n');
      issues.push(mk('info', 'Mods', `🧹 ${audit.redundant.length} mod${audit.redundant.length > 1 ? 's' : ''} you can probably drop`,
        'These overlap with something you already run, so removing them keeps the pack lighter. They are not harmful, so this is optional:\n' + lines,
        'Optional cleanup, no rush.', [], '', 0.05));
    }

    // missing core mods
    if (audit.missingCore.length)
      issues.push(mk(lagging ? 'warning' : 'info', 'Mods', '🧩 Missing core optimization mods',
        `For ${ctx.platform.label} ${ctx.mcVersion}, these server-side mods give the biggest and safest performance wins, and they are not installed yet.`,
        'Add the ones below. They do not change how the game plays.',
        audit.missingCore.map(m => ({ name: m.name, url: m.url, blurb: m.blurb })), '', lagging ? 0.5 : 0.18));

    // client-only mods sitting on a dedicated server (cleanup, low priority)
    if (ctx.isServerReport) {
      const audited = new Set([...audit.remove, ...audit.redundant].map(x => SparkKB.norm(x.name)));
      const client = SparkKB.detectClientMods(names).filter(n => !audited.has(SparkKB.norm(n)));
      if (client.length) {
        const shown = client.slice(0, 40);
        const list = shown.join(', ') + (client.length > shown.length ? `, and ${client.length - shown.length} more` : '');
        issues.push(mk('info', 'Mods', `🖥️ ${client.length} client-only mod${client.length > 1 ? 's' : ''} on the server`,
          "These only change a player's own game (rendering, HUD, sound, input, item viewers and so on), so they do nothing on a dedicated server. They are not causing lag, but you can remove them from the server to save a little RAM and startup time (keep them in your own client if you use them): " + list + ".",
          'Remove these from the server only, not from your client.', [], '', 0.04));
      }
    }
  }

  /* ---------- main ---------- */
  function analyze(report) {
    const ctx = buildContext(report);
    const issues = [];
    let threadsPanel = [];
    const avg = avgTps(ctx.tps);
    const msptMed = ctx.mspt && ctx.mspt.last1m ? num(ctx.mspt.last1m.median) : null;
    const lagging = (avg != null && avg < 19) || (msptMed != null && msptMed > 45);

    // profile context notes
    if (ctx.isAllocation)
      issues.push(mk('info', 'Profile', '📦 This is an allocation profile',
        'This report was made with `/spark profiler --alloc`, so the percentages below show where memory is being **allocated**, not where CPU time goes. Use it to track down GC pressure and memory churn, not TPS.', '', [], '', 97));
    if (ctx.reportKind === 'proxy')
      issues.push(mk('info', 'Profile', '🔀 Proxy report',
        'This is a proxy (BungeeCord/Velocity) profile. Proxies do not tick a world, so world, entity and TPS checks do not apply. The breakdown and Sources still show where the proxy spends its time.', '', [], '', 96));
    else if (ctx.reportKind === 'client')
      issues.push(mk('info', 'Profile', '🎮 Client report',
        'This is a client / singleplayer profile, not a dedicated server, so server-only advice is skipped.', '', [], '', 96));

    // (TPS and MSPT are shown as red/green status cards in the Overview, so they are not
    //  repeated as findings here. The "Main limit" verdict below explains the *why*.)

    // flame-graph breakdown
    let breakdown = null, subsystems = [], sources = { panel: [], findings: [] };
    if (ctx.type === 'sampler' && ctx.threadsData.length) {
      const main = pickMainThread(ctx.threadsData);
      if (main) {
        breakdown = computeBreakdown(main, ctx.classSources, ctx.brand, ctx.plugins);
        subsystems = Object.entries(breakdown.bySub).map(([id, ms]) => ({ id, ms, pct: ms / breakdown.active,
          label: (SparkKB.subsystemMeta(id) || {}).label || (id === 'other' ? 'Other / uncategorised' : id),
          icon: (SparkKB.subsystemMeta(id) || {}).icon || '•' }))
          .sort((a, b) => b.ms - a.ms);
        // findings for significant subsystems
        subsystems.forEach(sb => {
          if (sb.id === 'other') { if (sb.pct >= 0.35) issues.push(subsystemFinding(sb.id, sb.ms, sb.pct, ctx, lagging)); return; }
          if (sb.pct >= 0.08) issues.push(subsystemFinding(sb.id, sb.ms, sb.pct, ctx, lagging));
        });
        sources = sourceFindingsAndPanel(breakdown, ctx, lagging);
        sources.findings.forEach(f => issues.push(f));

        // busy non-main threads (often async chunk gen / world save / plugin tasks)
        const SKIP_THREAD = /^(Reference Handler|Finalizer|Signal Dispatcher|Notification Thread|Common-Cleaner|process reaper|DestroyJavaVM|Attach Listener|spark-|JNA Cleaner|C[12] Compiler)/i;
        threadsPanel = ctx.threadsData
          .filter(t => t.name !== breakdown.threadName && !SKIP_THREAD.test(t.name || ''))
          .map(t => ({ name: t.name, ms: sum(t.times) }))
          .filter(t => t.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 10);
        const hot = threadsPanel[0];
        if (hot && breakdown.total && hot.ms >= breakdown.total * 0.5)
          issues.push(mk(lagging ? 'warning' : 'info', 'Threads', `🧵 Another busy thread: ${hot.name}`,
            `The thread \u201c${hot.name}\u201d used ${fmtMs(hot.ms)}, which is a lot next to the main thread. This is often async chunk generation, world saving, or a plugin/mod background task.`,
            'Open this thread in the spark viewer to see what it is doing. We only break down the main server thread above.', [], '', 0.45));
      }
    }

    // entity hotspots
    const hotspots = entityHotspots(ctx);
    if (hotspots && hotspots.chunks.length) {
      const top = hotspots.chunks[0];
      const big = lagging ? 150 : 600; // only nag a healthy server about truly extreme piles
      if (top.total >= big) {
        const sev = (lagging && top.total >= 400) ? 'critical' : lagging ? 'warning' : 'info';
        const tail = lagging ? 'That many packed into one spot is a very common cause of entity lag.'
                             : 'Your TPS looks fine, but a pile this big is worth keeping an eye on.';
        issues.push(mk(sev, 'Entities',
          `🐄 ${top.total} entities in one chunk (${top.x * 16}, ${top.z * 16})`,
          `A single chunk in ${top.world || 'a world'} is holding ${top.total} entities. ${tail}`,
          `Teleport to around (${top.x * 16}, ${top.z * 16}) and clear it out or cap it. See the Entity Hotspots tab for the full list.`, [], '', lagging ? 0.5 : 0.1));
      }
    }

    // memory / gc (the detail finding lives in hardwareFindings to avoid duplication)
    const memory = memoryAnalysis(ctx);

    // blog-derived hardware/RAM/bottleneck intelligence
    hardwareFindings(ctx, subsystems, memory, lagging, issues);

    // mod audit (flag bad/redundant mods, suggest missing core mods)
    modFindings(ctx, lagging, issues);

    // safety / sanity / platform
    safetyFindings(ctx, lagging, issues);

    // de-dupe + sort
    const seen = new Set();
    const dedup = issues.filter(i => { const k = i.title; if (seen.has(k)) return false; seen.add(k); return true; });
    const order = { critical: 0, warning: 1, info: 2, good: 3 };
    dedup.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.impact - a.impact));
    const counts = { critical: 0, warning: 0, info: 0, good: 0 };
    dedup.forEach(i => counts[i.severity]++);

    return { ctx, platform: ctx.platform, issues: dedup, counts, breakdown, subsystems, hotspots, sources: sources.panel, threads: threadsPanel, memory, lagging };
  }

  return { analyze, buildContext, _internal: { computeBreakdown, pickMainThread } };
})();
