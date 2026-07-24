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
  const fmtGb = b => (b / 1073741824).toFixed(1) + ' GB';

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
    // resolved tuning values from the captured configs, so advice can check
    // what the server has ALREADY done instead of handing out canned steps
    const sp = configs.serverProperties || {};
    const spigotW = p => get(configs.spigot, ['world-settings', 'default', ...p]);
    const tune = {
      view: num(sp['view-distance']) != null ? num(sp['view-distance']) : num(spigotW(['view-distance'])),
      sim: num(sp['simulation-distance']) != null ? num(sp['simulation-distance']) : num(spigotW(['simulation-distance'])),
      monsterCap: num(get(configs.bukkit, ['spawn-limits', 'monsters'])),
      earMonsters: num(spigotW(['entity-activation-range', 'monsters'])),
      earAnimals: num(spigotW(['entity-activation-range', 'animals'])),
      tickInactiveVillagers: spigotW(['entity-activation-range', 'tick-inactive-villagers']),
      perPlayerMobSpawns: paperWorld(configs.paper, ['entities', 'spawning', 'per-player-mob-spawns']),
      hopperTransfer: num(spigotW(['ticks-per', 'hopper-transfer'])),
      hopperMoveEvent: paperWorld(configs.paper, ['hopper', 'disable-move-event']),
      redstoneImpl: paperWorld(configs.paper, ['misc', 'redstone-implementation']),
    };
    return {
      report, type: report.type, platform,
      brand: pm.brand || pm.name || 'Unknown', mcVersion: pm.minecraftVersion || '', serverVersion: pm.version || '',
      plugins, hasPlugin: n => plugins.some(p => (p.name || '').toLowerCase() === n.toLowerCase()),
      hasPluginLike: re => plugins.some(p => re.test(p.name || '')),
      configs, tune, system: sys, platformStats: ps,
      flags, xmx: parseXmx(flags, '-Xmx'), xms: parseXmx(flags, '-Xms'),
      jvmVersion: (sys.java && sys.java.version) || '', threads: get(sys, ['cpu', 'threads']) || 0,
      cpuModel: get(sys, ['cpu', 'modelName']) || '',
      players: num(ps.playerCount) || 0, tps: ps.tps || null, mspt: ps.mspt || null,
      threadsData: report.data.threads || [], classSources: report.data.classSources || {},
      installedNorm: new Set(plugins.map(pl => SparkKB.norm(pl.name))),
      isServerReport: (pm.type === 'SERVER' || pm.type == null),
      reportKind: (pm.type === 'CLIENT' ? 'client' : pm.type === 'PROXY' ? 'proxy' : 'server'),
      mcEra: SparkKB.mcEra(pm.minecraftVersion),
      samplerMode: md.samplerMode || 'EXECUTION',
      isAllocation: md.samplerMode === 'ALLOCATION',
      // TICKED aggregator = profile made with --only-ticks-over (slow ticks only)
      ticksOver: get(md, ['dataAggregator', 'type']) === 'TICKED' ? (num(get(md, ['dataAggregator', 'tickLengthThreshold'])) || 0) : null,
      includedTicks: num(get(md, ['dataAggregator', 'numberOfIncludedTicks'])),
      osName: get(sys, ['os', 'name']) || '',
      serverUptime: num(ps.uptime),
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

    // iterative DFS to avoid deep recursion limits on big profiles.
    // Idle rules (sub === IDLE marks an inherited idle context):
    //  - a wait/sleep frame at top level, or anything inside an idle context,
    //    is idle (the server waiting for the next tick — healthy, not lag);
    //  - a wait/sleep frame nested inside a REAL subsystem is that subsystem's
    //    time (e.g. the main thread blocking on a sync chunk load IS chunk lag);
    //  - a classified work frame inside an idle context (tasks run while
    //    waiting) counts as its own subsystem.
    const IDLE = '__idle__';
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
      const cidIdle = !!(cid && SparkKB.subsystemMeta(cid).idle);
      let cur; // subsystem context passed to children
      if (cidIdle) cur = (sub && sub !== IDLE) ? sub : IDLE;         // wait inside work -> work; else idle
      else if (cid) cur = cid;                                        // classified work frame
      else cur = sub;                                                 // inherit (incl. idle contexts)
      if (cur === IDLE) { idle += self; }
      else if (cur) { bySub[cur] = (bySub[cur] || 0) + self; }
      else { bySub['other'] = (bySub['other'] || 0) + self; }
      // source attribution (skip idle time)
      if (cur !== IDLE) {
        const sname = srcOf(cls);
        bySource[sname] = (bySource[sname] || 0) + self;
      }
      for (const i of kidsRefs) { const c = pool[i]; if (c) stack.push({ n: c, sub: cur }); }
    }
    const active = Math.max(1, total - idle);
    return { total, idle, active, bySub, bySource, threadName: thread.name };
  }

  /* ---------- per-subsystem advice ----------
   * Lines can be plain strings or functions of ctx returning a string or null.
   * Functions check the server's ACTUAL captured config so we never recommend
   * something that is already done, already installed, or does not exist on
   * the server's version.
   */
  const chunkyLine = c => c.hasPlugin('Chunky')
    ? 'You already have **Chunky** — run a pre-generation pass (`/chunky start`) so chunks are not built live while players explore.'
    : 'Pre-generate the world with [Chunky](https://modrinth.com/plugin/chunky) so chunks are not built live while players explore.';
  const viewLine = c => (c.tune.view == null || c.tune.view > 6)
    ? ('Lower `view-distance` a notch' + (c.tune.view != null ? ` (currently ${c.tune.view})` : '') + '.') : null;
  const earLine = c => (c.tune.earMonsters == null || c.tune.earMonsters > 24 || (c.tune.earAnimals != null && c.tune.earAnimals > 16))
    ? 'Tighten `entity-activation-range` (spigot.yml).' : null;
  const capLine = c => (c.tune.monsterCap == null || c.tune.monsterCap > 20)
    ? ('Lower mob caps (`spawn-limits` in bukkit.yml' + (c.tune.monsterCap != null ? `, currently ${c.tune.monsterCap} monsters` : '') + ').') : null;
  const tivLine = c => isFalse(c.tune.tickInactiveVillagers) ? null : 'Set `tick-inactive-villagers: false` (spigot.yml).';
  // Pufferfish (source of DAB) has no builds for the 2026 year-versions.
  const dabLine = c => {
    if (c.mcEra >= 100) return null;
    if (/pufferfish/i.test(c.brand)) return 'Enable **DAB** (`dab.enabled` in pufferfish.yml) to throttle far-away mob AI.';
    return 'The **Pufferfish** fork adds DAB, which throttles far-away mob AI.';
  };

  const ADVICE = {
    entities: { what: 'Most of the server time goes into ticking entities like mobs and dropped items. Usually that just means too many of them are loaded.',
      generic: ['Open the **Entity Hotspots** tab to find the exact chunks, then clear them out or cap them.'],
      bukkit: [capLine, earLine, dabLine] },
    mobai: { what: 'Mob AI and pathfinding is heavy. That happens when lots of mobs are actively thinking and finding their way around (dense farms, villagers, piglins and so on).',
      generic: ['Reduce the number of loaded mobs.'],
      bukkit: [earLine, tivLine, dabLine] },
    spawning: { what: 'Natural mob spawning is using a lot of time. Your spawn caps are letting too many mobs spawn each tick.',
      generic: ['Lower the mob cap.'],
      bukkit: [capLine, c => isFalse(c.tune.perPlayerMobSpawns) ? 'Re-enable `per-player-mob-spawns: true` (paper-world-defaults.yml) so the mob cap scales per player.' : null] },
    villagers: { what: 'Villager AI / POI processing is heavy.',
      generic: ['Reduce the number of villagers, or split large trading halls.'],
      bukkit: [
        c => c.hasPluginLike(/lobotomi|lobotimi/i)
          ? 'You already run a villager-lobotomizer plugin — check its config actually covers the hot farms.'
          : 'A villager-lobotomizing plugin (search "Villager Lobotomizer" on SpigotMC/Hangar), or Purpur\'s `mobs.villager.lobotomize.enabled` (purpur.yml), disables AI for boxed-in villagers. Note: this changes trading-hall behavior (trades still work, pathfinding does not).',
        tivLine] },
    blockentities: { what: 'Block entities (chests, furnaces, barrels and so on) are heavy. This usually means very large storage systems.',
      generic: ['Reduce the number of loaded tile entities.'], bukkit: [] },
    hoppers: { what: 'Hoppers are a big cost. Every hopper checks for items above it every tick, even when it is empty.',
      generic: ['Use water streams and droppers instead of long hopper lines, and keep the number of hoppers down.', 'If it keeps running with nobody nearby, check your spawn chunks and any force-loaded chunks.'],
      bukkit: [
        c => isTrue(c.tune.hopperMoveEvent) ? null : 'Set `hopper.disable-move-event: true` (paper-world-defaults.yml). Caveat: breaks plugins that listen for hopper item moves (some protection/logging plugins).',
        c => (c.tune.hopperTransfer != null && c.tune.hopperTransfer >= 16) ? null : 'Raise `ticks-per.hopper-transfer` / `hopper-check` 8 → 16 (spigot.yml). Caveat: slows item transfer and breaks hopper-clock timing.'] },
    blockticks: { what: 'Random block ticks (crops growing, fire spreading, fluids, ice and snow) are heavy. Usually this means very large farms.',
      generic: ['Shrink oversized farms; lower the `randomTickSpeed` gamerule if appropriate.', 'If it keeps running with nobody nearby, check your spawn chunks and any force-loaded chunks.'], bukkit: [] },
    chunks: { what: 'Loading, saving and managing chunks is heavy. This is normally caused by players exploring quickly, or by too many chunk loaders.',
      generic: [chunkyLine, viewLine, 'Find any chunk loaders or always-loaded areas and remove them.'], bukkit: [] },
    worldgen: { what: 'The server is building new world on the fly, which is expensive. It happens when players explore into land that has not been generated yet.',
      generic: [chunkyLine, viewLine], bukkit: [] },
    lighting: { what: 'The lighting engine is using a lot of time.',
      generic: [], bukkit: ['Modern Paper already includes the faster Starlight engine, so this is unusual. Check whether a plugin is doing light updates.'] },
    redstone: { what: 'Redstone is using a lot of time. Usually big contraptions, clocks, or observer loops are behind it.',
      generic: ['Reduce redstone clocks / observer loops.', 'If it keeps running with nobody nearby, check your spawn chunks and any force-loaded chunks.'],
      bukkit: [c => String(c.tune.redstoneImpl || '').toUpperCase() === 'ALTERNATE_CURRENT' ? null
        : 'Set `redstone-implementation: ALTERNATE_CURRENT` (paper-world-defaults.yml). Behaves like vanilla in almost all cases; test big contraptions after switching.'] },
    fluids: { what: 'Flowing water and lava are using a lot of time. Large areas of moving liquid are usually the cause.',
      generic: ['Reduce large areas of flowing water/lava.'], bukkit: [] },
    network: { what: 'Networking and entity tracking is heavy. This normally means a lot of players, or a lot of visible entities to keep in sync.',
      generic: [viewLine, 'Reduce the number of entities (see the Entity Hotspots tab).'], bukkit: [] },
    datapack: { what: 'Datapack command functions are using a lot of time. Function-based datapacks re-run their commands every tick, and spark cannot tell you WHICH pack is responsible.',
      generic: [
        c => c.mcEra >= 17 ? 'Run vanilla `/perf start` … `/perf stop`, then upload the generated zip to the misode.github.io Report Inspector — it attributes time per datapack.' : 'Disable datapacks one at a time to find the heavy one.',
        'Prefer real mods/plugins over function-heavy datapacks — the same feature as a mod is usually far cheaper.'], bukkit: [] },
    storage: { what: 'Saving the world to disk is heavy. Often this is a slow disk, or very large auto-saves.',
      generic: ['Use NVMe/SSD storage; avoid HDD-backed hosts.', 'Lower how often the world auto-saves (the max-auto-save-chunks-per-tick setting on Paper).'], bukkit: [] },
    other: { what: 'A big share of time is in code that does not match a known area. Usually that is a specific plugin or mod (check the Sources tab), or a custom system.',
      generic: ['Check the **Sources** tab to see which plugin or mod is responsible for this time.'], bukkit: [] },
  };

  function mk(sev, cat, title, detail, fix, mods, link, impact) {
    return { severity: sev, category: cat, title, detail: detail || '', fix: fix || '', mods: mods || [], link: link || '', impact: impact || 0 };
  }

  function adviceLines(list, ctx) {
    return (list || []).map(x => typeof x === 'function' ? x(ctx) : x).filter(Boolean);
  }

  function subsystemFinding(subId, ms, pct, ctx, lagging) {
    const meta = SparkKB.subsystemMeta(subId) || { label: subId, icon: '•' };
    const adv = ADVICE[subId] || ADVICE.other;
    let sev;
    if (lagging) sev = pct >= 0.25 ? 'critical' : pct >= 0.12 ? 'warning' : 'info';
    else sev = 'info'; // when TPS is healthy, the breakdown is informational, not a problem
    let mods = [];
    if (subId !== 'other' && subId !== 'lighting') {
      mods = SparkKB.modsFor(ctx.platform.loader, subId, ctx.mcEra).filter(m => !SparkKB.isModInstalled(m.id, ctx.installedNorm)).slice(0, 3).map(m => ({ name: m.name, url: m.url, blurb: m.blurb }));
    }
    const unit = ctx.isAllocation ? 'of allocations' : 'of the tick';
    let detail = adv.what;
    if (!lagging && !ctx.isAllocation) detail += ' (Your TPS is fine, so this is just where the current, light workload is going.)';
    return mk(sev, ctx.isAllocation ? 'Allocations' : 'Tick time', `${meta.icon} ${meta.label}: ${(pct * 100).toFixed(0)}% ${unit}`,
      detail,
      adviceLines(adv.generic, ctx).concat(ctx.platform.isBukkit ? adviceLines(adv.bukkit, ctx) : []).join('\n'),
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
    // capped: beyond ~16GB extra heap stops helping and can lengthen G1 pauses
    const min = Math.min(16, Math.max(floor, Math.round(est)));
    return { min, max: Math.min(20, min + (ctx.platform.isModded ? 4 : 2)), est, count };
  }

  function memoryMods(ctx) {
    return ctx.platform.isModded
      ? SparkKB.modsFor(ctx.platform.loader, 'memory', ctx.mcEra).filter(m => !SparkKB.isModInstalled(m.id, ctx.installedNorm)).slice(0, 2).map(m => ({ name: m.name, url: m.url, blurb: m.blurb }))
      : [];
  }

  function hardwareFindings(ctx, subsystems, memory, lag, issues) {
    const lagging = lag.lagging;
    const ps = ctx.platformStats, sys = ctx.system;
    const heap = get(ps, ['memory', 'heap']);
    const heapRatio = heap && num(heap.max) ? num(heap.used) / num(heap.max) : null;
    const oldGc = (memory.gc || []).find(g => /old/i.test(g.name));
    const longGc = oldGc && oldGc.avgTime > 150;
    // avgFrequency is the average time BETWEEN collections in MILLISECONDS
    // (spark GarbageCollectorStatistics) — an old-gen GC more often than every
    // ~20 seconds means the heap can't keep up.
    const frequentGc = oldGc && oldGc.avgFreq != null && oldGc.avgFreq > 0 && oldGc.avgFreq < 20000;
    // Memory-bound needs GC EVIDENCE. A heap snapshot near max is NOT evidence:
    // the JVM fills the heap with garbage between collections by design.
    const memBound = longGc || frequentGc;

    // ---- bottleneck verdict (top recommendation) ----
    const cpuProc = get(sys, ['cpu', 'processUsage', 'last1m']);
    const cpuPct = cpuProc != null ? (num(cpuProc) <= 1 ? num(cpuProc) * 100 : num(cpuProc)) : null;
    const cpuSys = get(sys, ['cpu', 'systemUsage', 'last1m']);
    const cpuSysPct = cpuSys != null ? (num(cpuSys) <= 1 ? num(cpuSys) * 100 : num(cpuSys)) : null;
    if (!ctx.isAllocation) {
      if (lag.hostSuspect) {
        const oversold = cpuSysPct != null && cpuPct != null && cpuSysPct >= 85 && cpuSysPct - cpuPct >= 30;
        issues.push(mk('critical', 'Diagnosis', '🧭 Main limit: the host machine, not your server',
          `TPS is below 20 (${lag.avg != null ? lag.avg.toFixed(1) : '?'}) but the tick itself is fast (median MSPT ${lag.msptMed != null ? lag.msptMed.toFixed(1) : '?'}ms, well inside the 50ms budget). Your server code is keeping up — something OUTSIDE it is stealing time. On shared hosting this is usually an oversold node (another customer's server hogging the CPU).${oversold ? ` Supporting evidence: the whole machine is at ${cpuSysPct.toFixed(0)}% CPU while your server only uses ${cpuPct.toFixed(0)}%.` : ''}`,
          'Config tweaks will not fix this. Ask your host about CPU steal / node load, try a different node, or move to a better host. (On Folia this pattern can also mean one region thread is saturated.)', [], '', 99));
      } else if (lagging && memBound) {
        issues.push(mk('critical', 'Diagnosis', '🧭 Main limit: RAM (memory)',
          `The server is lagging and the garbage collector shows real pressure (${longGc ? `${oldGc.name} pauses about ${oldGc.avgTime.toFixed(0)}ms` : `${oldGc.name} runs every ${(oldGc.avgFreq / 1000).toFixed(0)}s`}${heapRatio != null ? `, heap ${(heapRatio * 100).toFixed(0)}%` : ''}). In this case, adding RAM (and memory mods) really does help.`,
          'Raise the heap (`-Xmx`, or your host panel’s RAM setting)' + (ctx.platform.isModded ? ' and add the memory mods listed.' : '.'),
          memoryMods(ctx), '', 99));
      } else if (lagging) {
        issues.push(mk('critical', 'Diagnosis', '🧭 Main limit: CPU, not RAM',
          `The server is lagging but memory looks fine${heapRatio != null ? ` (heap is only ${(heapRatio * 100).toFixed(0)}%)` : ''}, so the real problem is how much work each tick has to do, not RAM. Heads up: the overall CPU number${cpuPct != null ? ` (${cpuPct.toFixed(0)}%)` : ''} can look low here, because Minecraft does almost all of its work on a single CPU core. That one core can be maxed out even while total CPU usage looks quiet.`,
          'Adding RAM will not help here. Cut down the work each tick using the Tick Breakdown (start with the biggest item), or move to a host with a faster single core.', [], '', 99));
      }
    }

    // ---- memory pressure detail (skip if it is already the memory-bound verdict) ----
    if (!(lagging && memBound) && !ctx.isAllocation && (longGc || frequentGc)) {
      const bits = [];
      if (longGc) bits.push(`${oldGc.name} pauses ~${oldGc.avgTime.toFixed(0)}ms`);
      if (frequentGc) bits.push(`${oldGc.name} runs every ${(oldGc.avgFreq / 1000).toFixed(0)}s`);
      if (heapRatio != null) bits.push(`heap at ${(heapRatio * 100).toFixed(0)}%`);
      issues.push(mk('warning', 'Memory', '🧠 Memory pressure',
        `Signs of memory pressure (${bits.join(', ')}). That leads to GC pauses, which show up as stutter.`,
        ctx.platform.isModded ? 'Give the server a little more RAM and add the memory mods below.'
                              : 'Give the server a little more RAM.', memoryMods(ctx), '', 0.34));
    }
    // ---- reassurance: high heap % alone is NOT a leak or a problem ----
    else if (!ctx.isAllocation && heapRatio != null && heapRatio >= 0.9 && !longGc && !frequentGc) {
      issues.push(mk('info', 'Memory', '🧠 Heap looks full — that is normal',
        `The heap is at ${(heapRatio * 100).toFixed(0)}%, but the garbage collector is healthy${oldGc && !oldGc.total ? ' (old-gen collections: 0)' : ''}. Java fills the heap with garbage between collections by design, so a high number here on its own is not memory pressure and not a leak. The same goes for your host panel's RAM graph.`,
        'Nothing to do. Only worry if GC pauses grow or the server gets OutOfMemoryError crashes.', [], '', 0.02));
    }

    // ---- RAM right-sizing (only with GC evidence — canned GB-per-player
    //      formulas are exactly what expert helpers criticize) ----
    if (ctx.isServerReport && ctx.xmx != null) {
      const xmxGb = ctx.xmx / 1024;
      const band = estimateRamGb(ctx);
      const phys = get(sys, ['memory', 'physical']);
      const physGb = phys && num(phys.total) ? num(phys.total) / 1073741824 : null;
      if ((longGc || frequentGc) && xmxGb < band.min - 0.5) {
        issues.push(mk('warning', 'Memory', '💾 Likely under-allocated RAM',
          `The GC is under pressure and only about ${xmxGb.toFixed(1)} GB is set aside for the server. A ${ctx.platform.label} server like this usually wants about **${band.min}-${band.max} GB**.`,
          `Give the server about ${band.min}-${band.max} GB of RAM (\`-Xmx\`; on most hosts a plan or panel setting), and set \`-Xms\` to the same value.`,
          memoryMods(ctx), '', 0.35));
      } else if (physGb && xmxGb > physGb * 0.85) {
        issues.push(mk('warning', 'Memory', '💾 Too much RAM allocated to the heap',
          `About ${xmxGb.toFixed(1)} GB of the machine’s ${physGb.toFixed(0)} GB is handed to the server, which leaves very little for the operating system. Giving Java too much can also make its cleanup pauses longer. A good target is about 60-70% of the machine’s RAM.`,
          'Leave 2-4 GB free for the operating system, and lower `-Xmx` (the server\'s allocated RAM) if it never actually uses it all.', [], '', 0.2));
      } else if (xmxGb > 24) {
        issues.push(mk('info', 'Memory', '💾 Very large heap',
          `${xmxGb.toFixed(0)} GB of heap is more than almost any Minecraft server benefits from — extra RAM does not raise TPS, and oversized heaps can make G1 GC pauses longer.`,
          'Unless you have measured a reason for it, 8-16 GB covers most servers (a bit more for huge modpacks).', [], '', 0.02));
      }
    }

    // ---- swap in use (universal expert red flag) ----
    const swap = get(sys, ['memory', 'swap']);
    if (swap && num(swap.used) > 268435456) // > 256 MB
      issues.push(mk('warning', 'Memory', '💾 Swap is in use',
        `The machine has ${fmtGb(num(swap.used))} of swap in use. Swap is disk pretending to be RAM — when the JVM lands in it, everything stutters. Swap is not free memory.`,
        'Lower `-Xmx` so the whole JVM fits in physical RAM with room to spare. On a dedicated box, consider disabling swap or lowering swappiness.', [], '', 0.4));

    // ---- disk nearly full ----
    const disk = sys.disk;
    if (disk && num(disk.total) > 0 && num(disk.used) / num(disk.total) >= 0.9)
      issues.push(mk('warning', 'Hardware', `🖴 Disk ${(num(disk.used) / num(disk.total) * 100).toFixed(0)}% full`,
        'Nearly-full SSDs lose a lot of their write performance, and world saves + backups need headroom. This commonly shows up as autosave lag spikes.',
        'Free up disk space (old backups, logs, unused worlds) or move to a bigger disk.', [], '', 0.3));

    // ---- Serial GC forced (some budget hosts do this) ----
    if ((memory.gc || []).some(g => /MarkSweepCompact|^Copy$/i.test(g.name)))
      issues.push(mk('warning', 'JVM', '⚙️ Serial garbage collector in use',
        'The JVM is running the Serial GC, which pauses ALL threads for every collection — the worst possible choice for a game server. Some hosts force this in their default start command.',
        'Use G1 (`-XX:+UseG1GC`, ideally Aikar\'s flags). If your host does not let you change flags, that is a reason to change hosts.', [], 'https://docs.papermc.io/paper/aikars-flags', 0.4));

    // ---- netty thread count (only visible when those threads were profiled) ----
    const nettyCount = ctx.threadsData.filter(t => /netty/i.test(t.name || '')).length;
    if (nettyCount > 0 && nettyCount < 4 && ctx.players > 20)
      issues.push(mk('warning', 'Network', `🌐 Only ${nettyCount} Netty IO thread${nettyCount > 1 ? 's' : ''}`,
        `Network IO is handled by ${nettyCount} thread${nettyCount > 1 ? 's' : ''} for ${ctx.players} players. Too few Netty threads bottleneck packet handling regardless of TPS (4-8 is the healthy range).`,
        'Check your start command / host template for a netty thread override (`-Dio.netty.eventLoopThreads`) and remove or raise it.', [], '', 0.3));

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
    // Non-LTS Javas go end-of-life six months after release and stop getting
    // fixes; 22/23/24 in particular are known-problematic with spark/async-profiler.
    else if (curJ && recJ >= 17 && curJ >= 16 && ![17, 21, 25].includes(curJ))
      issues.push(mk('warning', 'JVM', `☕ Java ${curJ} is a non-LTS release`,
        `Java ${curJ} stopped receiving updates shortly after release (22/23/24 are also known to break spark's profiler). Servers should run an LTS release from a mainstream vendor like Temurin.`,
        `Switch to Java ${Math.max(recJ, 21)}.`, [], '', 0.15));

    // ---- large-heap generational-ZGC option ----
    // Suggested ONLY when the GC stats show pauses actually costing something.
    // A server whose GC is healthy gains nothing from switching collectors —
    // recommending it anyway is exactly the canned-advice noise experts dislike.
    // On Java 21 generational ZGC needs -XX:+ZGenerational; on Java 23+ it is
    // the default and the flag is obsolete. MC 26.1+ (Java 25) defaults to ZGC.
    const youngGc = (memory.gc || []).find(g => /young|minor/i.test(g.name));
    const gcHurts = (youngGc && youngGc.avgTime >= 40) || (oldGc && oldGc.total > 0 && (longGc || frequentGc));
    if (gcHurts && ctx.flags && ctx.xmx != null && ctx.xmx >= 12288 && ctx.threads >= 4 && curJ >= 21
        && !/UseZGC|UseShenandoah/.test(ctx.flags))
      issues.push(mk('info', 'JVM', '⚙️ GC pauses + big heap: generational ZGC is an option',
        `Your GC pauses are long enough to notice (${youngGc && youngGc.avgTime >= 40 ? `young-gen collections average ${youngGc.avgTime.toFixed(0)}ms` : `${oldGc.name} averages ${oldGc.avgTime.toFixed(0)}ms`}), and with ${(ctx.xmx / 1024).toFixed(0)} GB of heap and ${ctx.threads} CPU threads generational ZGC can shrink them to sub-millisecond. It costs some extra CPU and RAM, so on a small or shared machine G1 (Aikar's flags) is still the safer default.`,
        curJ >= 23 ? 'You can try `-XX:+UseZGC` instead of the G1 flags (generational ZGC is the default on Java 23+).'
                   : 'On Java 21 you can try `-XX:+UseZGC -XX:+ZGenerational` instead of the G1 flags.', [], '', 0.05));

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
    const fork = SparkKB.forkSuggestion(ctx.platform, ctx.brand);
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

    // anti-lag / known-bad plugins (keys are normalized: lowercase, alphanumeric only)
    const ANTILAG = 'Anti-lag plugins cause more lag than they save. Remove it.';
    const BAD = {
      clearlag: 'Anti-lag plugins like this usually cause *more* lag. They constantly scan and delete entities, and can break game mechanics. Remove it and fix the real cause instead (Paper\'s `alt-item-despawn-rate` handles item floods without a plugin).',
      clearlagg: 'Anti-lag plugins like this usually cause *more* lag. They constantly scan and delete entities, and can break game mechanics. Remove it and fix the real cause instead (Paper\'s `alt-item-despawn-rate` handles item floods without a plugin).',
      nomoblag: ANTILAG,
      antilag: ANTILAG,
      serverbooster: ANTILAG,
      lagassist: 'Use it for stats only, and turn off its active "anti-lag" features.',
    };
    ctx.plugins.forEach(p => { const k = SparkKB.norm(p.name); if (BAD[k]) issues.push(mk('warning', 'Plugins', `🧹 ${p.name}`, BAD[k], '', [], '', 0)); });

    // JVM flags — only the high-impact checks, concise
    const f = ctx.flags;
    if (f) {
      // Detect Aikar's flags by their G1 signature too — many hosts strip the -D marker flags.
      const aikar = f.includes('-Daikars.new.flags=true') || f.includes('using.aikars.flags') || /G1NewSizePercent/.test(f);
      const zgc = f.includes('-XX:+UseZGC') || f.includes('-XX:+UseShenandoahGC');
      const curJava = SparkKB.javaMajor(ctx.jvmVersion);
      // On Java 25+ / MC 26.1+, ZGC is the vanilla default and Aikar's G1 set is
      // no longer the blanket recommendation — don't push it there.
      const aikarApplies = !(curJava >= 25 || ctx.mcEra >= 100);
      if (!aikar && !zgc && aikarApplies)
        issues.push(mk(lagging ? 'warning' : 'info', 'JVM', '⚙️ Not using Aikar’s flags',
          'Aikar’s flags tune the G1 garbage collector for Minecraft and noticeably reduce GC-related lag spikes. (If your host panel manages flags for you, check whether it has an "optimized flags" option.)',
          'Use Aikar’s flags in your startup command.', [], 'https://docs.papermc.io/paper/aikars-flags', 0));
      else if (aikar && ctx.xms != null && ctx.xmx != null && ctx.xms !== ctx.xmx)
        issues.push(mk('info', 'JVM', '⚙️ Xms should equal Xmx', 'With Aikar’s flags, min and max heap should be identical.', 'Set `-Xms` equal to `-Xmx`.', [], '', 0));
      // conflicting host templates: fixed -Xmx AND percentage-based sizing together
      if (/MaxRAMPercentage|InitialRAMPercentage/.test(f) && ctx.xmx != null)
        issues.push(mk('info', 'JVM', '⚙️ Conflicting heap flags',
          'The start command sets both a fixed `-Xmx` and `-XX:MaxRAMPercentage`. When `-Xmx` is present the percentage flag is ignored — this is usually leftover host-template cruft.',
          'Keep the fixed `-Xmx`/`-Xms` pair and remove the RAMPercentage flags to avoid confusion.', [], '', 0));
    }

  }

  /* ---------- mod audit (MC-Optimization-Guide) ---------- */
  function modFindings(ctx, lagging, issues) {
    const era = ctx.mcEra;

    // BleedingPipe: RCE in how SOME mods (de)serialize network data on older
    // Forge. It is a mod-level bug, most relevant to the 1.7.10-1.16 ecosystem,
    // not a hole in every Forge server — so this is informational.
    if (ctx.platform.loader === 'forge' && era >= 7 && era < 17)
      issues.push(mk('info', 'Security', '🔓 BleedingPipe check (older Forge ecosystems)',
        'Some mods on Forge 1.7-1.16 use Java serialization over the network, which is exploitable (the "BleedingPipe" bug). Whether you are affected depends on the mods installed, not on Forge itself.',
        'Adding the SerializationIsBad mod closes the hole regardless of which mods you run. Cheap insurance for public servers on these versions.',
        [{ name: 'SerializationIsBad', url: 'https://modrinth.com/mod/serializationisbad', blurb: 'Patches the BleedingPipe / ObjectInputStream security hole in affected mods.' }], '', 0.1));

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

  /* ---------- entity census (counts vs players, heavy types, item floods) ---------- */
  function entityCensusFindings(ctx, hotspots, lagging, issues) {
    if (ctx.reportKind !== 'server') return;
    const total = hotspots.totalEntities || 0;
    const players = ctx.players || 0;
    const typeCount = name => { const e = (hotspots.types || []).find(([n]) => n.replace(/^minecraft:/, '') === name); return e ? e[1] : 0; };
    // baseline: ~350-500 entities per player is normal; helpers call ~1,000-1,500
    // for 3 players the upper end of normal
    const expected = Math.max(1500, players * 500);
    if (total > expected * 1.5)
      issues.push(mk(lagging ? 'warning' : 'info', 'Entities', `🐄 ${fmtNumS(total)} entities loaded for ${players} player${players === 1 ? '' : 's'}`,
        `That is well above the ~${fmtNumS(expected)} you would expect at this player count. Big farms, breeder overflow, or item piles are the usual causes.`,
        'Check the Entity Hotspots tab — the census below shows which types dominate.', [], '', lagging ? 0.45 : 0.08));
    const villagers = typeCount('villager');
    if (villagers >= 200)
      issues.push(mk(lagging ? 'warning' : 'info', 'Entities', `🧑‍🌾 ${fmtNumS(villagers)} villagers loaded`,
        'Villagers are among the most expensive mobs in the game (Brain AI, POI scans, pathfinding) — a few hundred cost far more than the same number of cows.',
        ctx.platform.isBukkit
          ? 'Shrink or consolidate trading halls, and consider a villager-lobotomizer plugin (or Purpur\'s `mobs.villager.lobotomize.enabled` in purpur.yml) for boxed-in villagers.'
          : 'Shrink or consolidate trading halls, and box villagers 1×1 (or put them on rails/minecarts) to cut their pathfinding.', [], '', lagging ? 0.4 : 0.06));
    const junk = typeCount('item') + typeCount('experience_orb') + typeCount('arrow') + typeCount('falling_block');
    if (junk >= 1500)
      issues.push(mk(lagging ? 'warning' : 'info', 'Entities', `📦 ${fmtNumS(junk)} dropped items / orbs / projectiles loaded`,
        'This is usually a farm output pile or a broken collection system. Do NOT reach for a clear-lag plugin — the server can despawn junk itself, cheaply.',
        ctx.platform.isBukkit
          ? 'On Paper, set per-item timers with `entities.spawning.alt-item-despawn-rate` and cap saved projectiles/orbs with `chunks.entity-per-chunk-save-limit` (both in paper-world-defaults.yml).'
          : 'Fix the overflowing farm/collection, and consider a mod that merges or despawns excess drops.', [], '', lagging ? 0.4 : 0.06));
  }
  const fmtNumS = n => Number(n).toLocaleString('en-US');

  /* ---------- datapack intelligence ---------- */
  function datapackFindings(ctx, subsystems, lagging, issues) {
    if (ctx.reportKind !== 'server') return;
    // Modrinth auto-packages datapacks as mods with ids starting "mr_" — they
    // perform exactly like raw datapacks (i.e. badly, if they use functions).
    const mrMods = ctx.plugins.filter(p => /^mr[_ ]/i.test(p.name || ''));
    const dpHot = subsystems.some(s => s.id === 'datapack' && s.pct >= 0.08);
    if (mrMods.length && (dpHot || ctx.platform.isModded))
      issues.push(mk(dpHot ? 'warning' : 'info', 'Datapacks', `📜 ${mrMods.length} datapack${mrMods.length > 1 ? 's' : ''} packaged as mods`,
        `These "mods" are actually datapacks auto-packaged by Modrinth (their IDs start with \`mr_\`): ${mrMods.slice(0, 8).map(p => p.name).join(', ')}${mrMods.length > 8 ? ', …' : ''}. Function-based datapacks re-run their commands every tick and are a very common hidden lag source — packaging them as a mod does not make them faster.`,
        dpHot ? 'The tick breakdown shows datapack functions are hot — these are prime suspects. Test with them removed.'
              : 'If datapack function time ever shows up in the breakdown, start your search here.', [], '', dpHot ? 0.5 : 0.05));
    const packs = get(ctx.platformStats, ['world', 'dataPacks']) || [];
    const userPacks = packs.filter(p => !p.builtin && !/^vanilla$|^bukkit$|^paper$|^purpur$/i.test(p.name || ''));
    if (dpHot && userPacks.length)
      issues.push(mk('info', 'Datapacks', `📜 ${userPacks.length} datapack${userPacks.length > 1 ? 's' : ''} enabled`,
        'Datapack functions are hot in this profile, and spark cannot tell packs apart. Enabled non-vanilla packs: ' + userPacks.slice(0, 10).map(p => p.name).join(', ') + (userPacks.length > 10 ? ', …' : '') + '.',
        'To find the guilty one: run vanilla `/perf start` / `/perf stop` (MC 1.17+), then upload the generated zip to the misode.github.io Report Inspector — it attributes time per pack. Or bisect by disabling packs.', [], '', 0.3));
  }

  /* ---------- known culprits + anti-pattern frames ---------- */
  const CULPRITS = [
    { match: /^levelledmobs$/i, sev: 'warning', title: 'LevelledMobs runs heavy async work',
      note: 'LevelledMobs does most of its work on background threads, where the default profile does not look — servers have seen it eat entire cores while the main thread looked clean.',
      fix: 'If overall CPU is high while the tick breakdown looks fine, test without it, and re-profile with `/spark profiler start --thread *` to see async load.' },
    { match: /stacker|stackmob/i, sev: 'info', title: 'Mob-stacking plugin detected',
      note: 'Stacking naturally-spawned mobs backfires: the mob cap never fills, so the server spawns (and stacks) endlessly — a spawn-loop treadmill.',
      fix: 'Use stacking for spawner farms only; leave natural spawns to the normal caps.' },
    { match: /^distanthorizons$/i, sev: 'warning', title: 'Distant Horizons on the server',
      note: 'The server-side Distant Horizons component (LOD generation) is a repeat offender for CPU and memory load on busy servers.',
      fix: 'If the server struggles, test without it — client-side DH still works without the server component (with reduced range).' },
  ];
  function culpritFindings(ctx, lagging, issues) {
    ctx.plugins.forEach(p => {
      const c = CULPRITS.find(c => c.match.test(SparkKB.norm(p.name)));
      if (c) issues.push(mk(c.sev, 'Plugins', `🔎 ${c.title}`, c.note, c.fix, [], '', 0.1));
    });
    // anti-pattern frames on the main thread: sync database work & offline-player lookups
    if (ctx.type !== 'sampler' || !ctx.threadsData.length) return;
    const main = pickMainThread(ctx.threadsData);
    if (!main) return;
    const pool = main.children || [];
    let sqlMs = 0, offlineMs = 0, totalMs = sum(main.times) || 1;
    const stack = (main.childrenRefs || []).slice();
    const seenIdx = new Set();
    while (stack.length) {
      const i = stack.pop();
      if (seenIdx.has(i)) continue; seenIdx.add(i);
      const n = pool[i]; if (!n) continue;
      const sig = (n.className || '') + '.' + (n.methodName || '');
      if (/hikari|java\.sql\.|com\.mysql|org\.mariadb|org\.sqlite|org\.postgresql/i.test(sig)) sqlMs += sum(n.times);
      else if (/getOfflinePlayer\b/.test(sig)) offlineMs += sum(n.times);
      else (n.childrenRefs || []).forEach(r => stack.push(r)); // don't descend into matched subtrees (avoid double count)
    }
    if (sqlMs / totalMs >= 0.02)
      issues.push(mk('warning', 'Plugins', `🗄️ Database queries on the main thread (${(sqlMs / totalMs * 100).toFixed(1)}%)`,
        'SQL / connection-pool frames are showing up on the server thread. Every query blocks the tick for its full round-trip — this is a plugin doing sync database work, a classic lag anti-pattern.',
        'Find the plugin above these frames in the Call Tree / Sources tab and report it (or check for an "async" option in its config).', [], '', 0.5));
    if (offlineMs / totalMs >= 0.01)
      issues.push(mk('warning', 'Plugins', '🗄️ getOfflinePlayer() on the main thread',
        'Offline-player lookups can hit disk or network and are showing up in the tick. Plugins calling this in events or commands cause stutter.',
        'Identify the calling plugin in the Call Tree and report it; there is usually an async alternative.', [], '', 0.4));
  }

  /* ---------- config sanity (only clearly-out-of-range values) ---------- */
  function configFindings(ctx, lagging, issues) {
    if (ctx.reportKind !== 'server') return;
    const t = ctx.tune;
    if (t.view != null && t.view >= 16)
      issues.push(mk('warning', 'Config', `🌍 view-distance is ${t.view}`,
        'View distance grows quadratically: 16 loads ~3.4x the chunks of 8, per player. Values this high are very expensive in RAM and chunk work.',
        'Most servers run 6-10 (`view-distance` in server.properties). Players who want long sight lines can use client-side LOD mods instead.', [], '', 0.4));
    if (t.sim != null && t.sim >= 12)
      issues.push(mk('warning', 'Config', `🌍 simulation-distance is ${t.sim}`,
        'Simulation distance controls the radius that actually TICKS (mobs, crops, redstone) around each player — it is the single most expensive distance setting.',
        'Most servers run 4-8 (`simulation-distance` in server.properties); farms beyond that radius pause instead of running.', [], '', 0.45));
    const rules = get(ctx.platformStats, ['world', 'gameRules']) || [];
    const rts = rules.find(r => /^randomTickSpeed$/i.test(r.name || ''));
    if (rts) {
      const vals = Object.values(rts.worldValues || {}).map(v => num(v)).filter(v => v != null);
      const worst = Math.max.apply(null, vals.length ? vals : [0]);
      if (worst > 3)
        issues.push(mk(worst > 20 ? 'critical' : 'warning', 'Config', `🎲 randomTickSpeed is ${worst}`,
          `The vanilla default is 3. At ${worst}, every loaded chunk section rolls ${worst} random block ticks per tick — crops, fire, fluids all churn ${Math.round(worst / 3)}x harder.`,
          'Run `/gamerule randomTickSpeed 3` (per world) unless you have a specific event running.', [], '', 0.5));
    }
  }

  /* ---------- profile-quality gate ----------
   * Findings about the REPORT itself: a short, empty, startup, or slow-ticks-only
   * profile supports far weaker conclusions, and helpers reject such reports
   * on sight. Saying so up front is what separates evidence from guessing.
   */
  function profileQualityFindings(ctx, issues, mainThreadTotal) {
    if (ctx.type !== 'sampler') return;
    const dur = ctx.profile.durationMs;
    if (dur != null && dur > 0 && dur < 180000)
      issues.push(mk('warning', 'Profile', `⏱️ Short profile (${fmtMs(dur)})`,
        'Profiles under ~3 minutes rarely capture enough ticks to be representative — community helpers generally ask for 5-10 minutes (`/spark profiler start --timeout 600`), taken **while the problem is happening**.',
        'Treat everything below as a weaker signal, and consider re-profiling for longer.', [], '', 98));
    if (ctx.reportKind === 'server' && ctx.players === 0 && !ctx.isAllocation)
      issues.push(mk('warning', 'Profile', '🫥 Nobody was online during this profile',
        'A server with 0 players does almost nothing — no mob spawning around players, no chunk loading, no network load. This profile mostly shows the server idling, not how it behaves under load.',
        'Re-run the profiler while players are online and the lag is actually happening.', [], '', 98));
    if (ctx.serverUptime != null && dur != null && ctx.serverUptime < dur + 180000)
      issues.push(mk('warning', 'Profile', '🚀 Profile taken right after startup',
        'The server had just started when this profile ran. Startup is dominated by one-off work (JIT warm-up, world loading, plugin init), so it does not represent normal running performance.',
        'Let the server run for a while, then profile during normal play.', [], '', 98));
    if (ctx.ticksOver != null) {
      // tickLengthThreshold is stored in microseconds
      const thrMs = ctx.ticksOver > 10000 ? ctx.ticksOver / 1000 : ctx.ticksOver;
      const included = ctx.includedTicks;
      const realMspt = (included && mainThreadTotal) ? mainThreadTotal / included : null;
      issues.push(mk('info', 'Profile', `🎯 Slow-ticks-only profile (--only-ticks-over ${thrMs.toFixed(0)})`,
        `This profile only sampled ticks longer than ${thrMs.toFixed(0)}ms${included ? ` (${included} ticks captured)` : ''}, which is the right tool for hunting lag spikes. But it means the percentages describe **only the slow ticks**, not average load${realMspt ? `, and the average of the captured slow ticks is about ${realMspt.toFixed(0)}ms each` : ''}.`,
        'Read the breakdown as "what makes the bad ticks bad". For overall load, take a normal profile too.', [], '', 97));
    }
    if (ctx.profile.engine === 'JAVA' && /windows/i.test(ctx.osName))
      issues.push(mk('info', 'Profile', '🪟 Windows Java-sampler profile',
        'On Windows spark falls back to its built-in Java sampler, which has known accuracy quirks (safepoint bias, occasional >100% frames). Treat exact percentages with some skepticism.',
        'For precise profiles, Linux hosting (async-profiler engine) gives more reliable data.', [], '', 5));
  }

  /* ---------- main ---------- */
  function analyze(report) {
    const ctx = buildContext(report);
    const issues = [];
    let threadsPanel = [];
    const avg = ctx.tps ? Math.min(num(ctx.tps.last1m) != null ? num(ctx.tps.last1m) : 20, 20) : null;
    const avg3 = avgTps(ctx.tps);
    const msptMed = ctx.mspt && ctx.mspt.last1m ? num(ctx.mspt.last1m.median) : null;
    const msptMax = ctx.mspt && ctx.mspt.last1m ? num(ctx.mspt.last1m.max) : null;
    const msptLagging = msptMed != null && msptMed > 45;
    const tpsLagging = (avg != null && avg < 19) || (avg3 != null && avg3 < 18.5);
    const lagging = msptLagging || tpsLagging;
    // TPS low while the tick itself is fast = the bottleneck is OUTSIDE the
    // server (host contention / CPU steal), not tick work. Only meaningful on
    // normal profiles of real servers.
    const hostSuspect = ctx.reportKind === 'server' && !ctx.isAllocation && ctx.ticksOver == null
      && tpsLagging && msptMed != null && msptMed < 45;
    const lag = { lagging, msptLagging, tpsLagging, hostSuspect, msptMed, avg: avg != null ? avg : avg3 };

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
    if (ctx.platform.family === 'hytale')
      issues.push(mk('info', 'Profile', '🟠 Hytale server report',
        'This is a Hytale server, so the Minecraft-specific checks (configs, mods, Java version pairing) are skipped. TPS/MSPT, GC, hardware and thread analysis still apply.', '', [], '', 95));
    const isFolia = /folia/i.test(ctx.brand);
    if (isFolia)
      issues.push(mk('info', 'Profile', '🧵 Folia report — read per region',
        'Folia ticks independent world regions on parallel threads, so there is no single "Server thread" or global MSPT. The breakdown below covers the BUSIEST region thread; other region threads are normal, and one hot region (like spawn) can lag while the rest of the server runs at 20 TPS.', '', [], '', 95));

    // reassurance: a red "max" MSPT with a healthy median is one spike, not lag
    if (!lagging && msptMed != null && msptMax != null && msptMax > 100)
      issues.push(mk('info', 'Profile', '📈 Big max-MSPT number, healthy median',
        `The worst single tick took ${msptMax.toFixed(0)}ms, but the median is ${msptMed.toFixed(1)}ms — that red max just means ONE tick was slow (a world save, a chunk load burst). It takes a recurring pattern, not one number, to mean lag.`,
        'Nothing to do unless players actually feel stutter. For hunting real spikes: `/spark profiler start --only-ticks-over 100`.', [], '', 3));

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
        // On Folia, parallel region threads are the design, not an anomaly.
        if (hot && breakdown.total && hot.ms >= breakdown.total * 0.5 && !(isFolia && /region/i.test(hot.name || '')))
          issues.push(mk(lagging ? 'warning' : 'info', 'Threads', `🧵 Another busy thread: ${hot.name}`,
            `The thread \u201c${hot.name}\u201d used ${fmtMs(hot.ms)}, which is a lot next to the main thread. This is often async chunk generation, world saving, or a plugin/mod background task.`,
            'Open this thread in the spark viewer to see what it is doing. We only break down the main server thread above.', [], '', 0.45));
      }
    }

    // profile-quality gate (how much can this report actually prove?)
    profileQualityFindings(ctx, issues, breakdown ? breakdown.total : null);

    // reassurance: lots of idle headroom = healthy, say so explicitly
    if (!lagging && !ctx.isAllocation && breakdown && breakdown.total > 0 && breakdown.idle / breakdown.total >= 0.4)
      issues.push(mk('good', 'Profile', '😴 Plenty of headroom',
        `${(breakdown.idle / breakdown.total * 100).toFixed(0)}% of the profiled time is the server *waiting* for the next tick — that is idle headroom, the opposite of lag. (The big "wait" frame at the top of the flame graph is this, not a problem.)`,
        '', [], '', 2));

    // entity hotspots + census
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
          `Run \`/tp ${top.x * 16} ~ ${top.z * 16}\`${top.world ? ` in ${top.world}` : ''} and clear it out or cap it. See the Entity Hotspots tab for the full list.`, [], '', lagging ? 0.5 : 0.1));
      }
      entityCensusFindings(ctx, hotspots, lagging, issues);
    }

    // datapack intelligence (mr_-packaged mods, enabled pack list)
    datapackFindings(ctx, subsystems, lagging, issues);

    // memory / gc (the detail finding lives in hardwareFindings to avoid duplication)
    const memory = memoryAnalysis(ctx);

    // blog-derived hardware/RAM/bottleneck intelligence
    hardwareFindings(ctx, subsystems, memory, lag, issues);

    // known-culprit plugins/mods + anti-pattern frames
    culpritFindings(ctx, lagging, issues);

    // config sanity (only clearly-out-of-range values)
    configFindings(ctx, lagging, issues);

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
