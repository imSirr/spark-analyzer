// Phase 1-4 verification: synthetic decoded reports straight into analyze().
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'assets') + require('path').sep;
const src = fs.readFileSync(path + 'knowledge.js', 'utf8') + '\n' + fs.readFileSync(path + 'rules.js', 'utf8');
const sandbox = {};
new Function('globalThis', src + '\n;globalThis.SparkKB = SparkKB; globalThis.SparkRules = SparkRules;')(sandbox);
const { SparkKB, SparkRules } = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }

function baseThread() {
  return {
    name: 'Server thread', times: [100000], childrenRefs: [0, 1],
    children: [
      { className: 'net.minecraft.server.MinecraftServer', methodName: 'waitUntilNextTick', times: [84000], childrenRefs: [] },
      { className: 'net.minecraft.server.level.ServerLevel', methodName: 'tickNonPassenger', times: [16000], childrenRefs: [] },
    ],
  };
}
function makeReport(over) {
  const o = over || {};
  return {
    type: 'sampler',
    data: {
      metadata: Object.assign({
        platformMetadata: Object.assign({ type: 'SERVER', name: 'Paper', brand: 'Paper', version: '1.21.4-100', minecraftVersion: '1.21.4' }, o.pm),
        platformStatistics: Object.assign({
          tps: { last1m: 20, last5m: 20, last15m: 20 },
          mspt: { last1m: { mean: 8, max: 30, min: 2, median: 7, percentile95: 15 } },
          playerCount: 10, uptime: 86400000,
          memory: { heap: { used: 3e9, max: 8e9 } },
        }, o.ps),
        systemStatistics: Object.assign({
          cpu: { threads: 8, modelName: 'AMD Ryzen 7 5800X', processUsage: { last1m: 0.2 }, systemUsage: { last1m: 0.25 } },
          memory: { physical: { used: 1.2e10, total: 3.2e10 }, swap: { used: 0, total: 4e9 } },
          disk: { used: 1e11, total: 2.4e11 },
          gc: { 'G1 Young Generation': { total: 500, avgTime: 15, avgFrequency: 30000 }, 'G1 Old Generation': { total: 0, avgTime: 0, avgFrequency: 0 } },
          java: { vendor: 'Temurin', version: '21.0.6', vmArgs: '-Xms8G -Xmx8G -XX:+UseG1GC -XX:G1NewSizePercent=30' },
          os: { name: 'Linux' },
        }, o.sys),
        startTime: 1000000, endTime: 1000000 + (o.durMs != null ? o.durMs : 600000),
        numberOfTicks: 12000, samplerMode: 0, samplerEngine: o.engine || 'ASYNC',
        sources: o.sources || {},
        serverConfigurations: o.cfg || {},
        dataAggregator: o.agg,
      }, o.md),
      threads: o.threads || [baseThread()],
      classSources: o.classSources || {},
    },
  };
}
const titlesOf = a => a.issues.map(i => i.title).join(' | ');

/* 1. host contention: TPS low, MSPT fine */
{
  const a = SparkRules.analyze(makeReport({ ps: { tps: { last1m: 14, last5m: 14.5, last15m: 15 }, mspt: { last1m: { mean: 18, max: 60, min: 5, median: 16, percentile95: 30 } } } }));
  ok('host-contention verdict', /host machine/.test(titlesOf(a)), titlesOf(a));
  ok('no CPU-not-RAM verdict alongside', !/CPU, not RAM/.test(titlesOf(a)));
}
/* 2. profile quality: short, empty, startup */
{
  const a = SparkRules.analyze(makeReport({ durMs: 60000, ps: { playerCount: 0, uptime: 120000 } }));
  const t = titlesOf(a);
  ok('short-profile finding', /Short profile/.test(t), t);
  ok('empty-server finding', /Nobody was online/.test(t));
  ok('startup-profile finding', /right after startup/.test(t));
}
/* 3. ticks-over profile detected + host verdict suppressed */
{
  const a = SparkRules.analyze(makeReport({ agg: { type: 'TICKED', tickLengthThreshold: 100000, numberOfIncludedTicks: 371 } }));
  ok('ticks-over finding', /Slow-ticks-only/.test(titlesOf(a)), titlesOf(a));
}
/* 4. system red flags */
{
  const a = SparkRules.analyze(makeReport({
    sys: {
      memory: { physical: { used: 1.2e10, total: 1.6e10 }, swap: { used: 3e9, total: 8e9 } },
      disk: { used: 2.3e11, total: 2.4e11 },
      gc: { 'MarkSweepCompact': { total: 100, avgTime: 500, avgFrequency: 5000 } },
      java: { vendor: 'Oracle', version: '24.0.1', vmArgs: '-Xms4G -Xmx4G -XX:G1NewSizePercent=30 -XX:MaxRAMPercentage=95' },
      cpu: { threads: 8, modelName: 'AMD Ryzen 7 5800X', processUsage: { last1m: 0.2 }, systemUsage: { last1m: 0.25 } },
      os: { name: 'Linux' },
    },
  }));
  const t = titlesOf(a);
  ok('swap finding', /Swap is in use/.test(t), t);
  ok('disk finding', /Disk 9\d% full/.test(t));
  ok('serial GC finding', /Serial garbage collector/.test(t));
  ok('non-LTS java finding', /Java 24 is a non-LTS/.test(t));
  ok('flag conflict finding', /Conflicting heap flags/.test(t));
}
/* 5. mr_ datapack mods on fabric */
{
  const a = SparkRules.analyze(makeReport({
    pm: { name: 'Fabric', brand: 'Fabric' },
    sources: { mr_truly_epic: { name: 'mr_truly_epic', version: '1' }, sodium: { name: 'Sodium', version: '0.6' } },
  }));
  ok('mr_ datapack finding', /datapack.*packaged as mods/i.test(titlesOf(a)), titlesOf(a));
}
/* 6. entity census: villagers + junk flood */
{
  const a = SparkRules.analyze(makeReport({
    ps: {
      world: {
        totalEntities: 9000,
        entityCounts: { 'minecraft:villager': 950, 'minecraft:item': 2500, 'minecraft:cow': 100 },
        worlds: [{ name: 'world', totalEntities: 9000, regions: [{ chunks: [{ x: 1, z: 1, totalEntities: 700, entityCounts: { 'minecraft:villager': 700 } }] }] }],
        gameRules: [{ name: 'randomTickSpeed', defaultValue: '3', worldValues: { world: '100' } }],
      },
    },
  }));
  const t = titlesOf(a);
  ok('entity-count-vs-players finding', /entities loaded for 10 players/.test(t), t);
  ok('villager census finding', /950 villagers/.test(t));
  ok('item flood finding', /dropped items/.test(t));
  ok('randomTickSpeed finding', /randomTickSpeed is 100/.test(t));
  ok('tp command in hotspot fix', a.issues.some(i => /\/tp 16 ~ 16/.test(i.fix || '')));
}
/* 7. culprits + main-thread SQL */
{
  const sqlThread = baseThread();
  sqlThread.children.push({ className: 'com.zaxxer.hikari.pool.HikariPool', methodName: 'getConnection', times: [5000], childrenRefs: [] });
  sqlThread.childrenRefs = [0, 1, 2];
  sqlThread.times = [105000];
  const a = SparkRules.analyze(makeReport({ sources: { levelledmobs: { name: 'LevelledMobs', version: '4' } }, threads: [sqlThread] }));
  const t = titlesOf(a);
  ok('LevelledMobs culprit', /LevelledMobs/.test(t), t);
  ok('main-thread SQL finding', /Database queries on the main thread/.test(t));
}
/* 8. reassurance findings */
{
  const a = SparkRules.analyze(makeReport({ ps: { mspt: { last1m: { mean: 8, max: 300, min: 2, median: 7, percentile95: 15 } }, memory: { heap: { used: 7.7e9, max: 8e9 } } } }));
  const t = titlesOf(a);
  ok('headroom good finding', /Plenty of headroom/.test(t), t);
  ok('max-mspt reassurance', /healthy median/.test(t));
  ok('heap-full reassurance', /Heap looks full/.test(t));
  ok('no memory-pressure warning from heap alone', !/Memory pressure/.test(t));
}
/* 9. catalog gating */
{
  ok('lithium on neoforge 26.2', SparkKB.modsFor('neoforge', 'mobai', 102).some(m => m.id === 'lithium'));
  ok('no radium on forge 1.21', !SparkKB.modsFor('forge', 'mobai', 21.01).some(m => m.id === 'radium'));
  ok('radium on forge 1.20.1', SparkKB.modsFor('forge', 'mobai', 20.01).some(m => m.id === 'radium'));
  ok('no noisium past 1.21.6', !SparkKB.modsFor('fabric', 'worldgen', 21.11).some(m => m.id === 'noisium'));
  ok('no memoryleakfix on 1.21', !SparkKB.modsFor('fabric', 'memory', 21.01).some(m => m.id === 'memoryleakfix'));
  ok('c2me not core on fabric', SparkKB.modAudit([], 'fabric', '1.21.4').missingCore.every(m => m.id !== 'c2me'));
  ok('no radium in forge 1.21 missing-core', SparkKB.modAudit([], 'forge', '1.21.1').missingCore.every(m => m.id !== 'radium'));
  ok('lithium in neoforge 26.1 missing-core', SparkKB.modAudit([], 'neoforge', '26.1').missingCore.some(m => m.id === 'lithium'));
}
/* 10. RAM band cap */
{
  const ctx = SparkRules.buildContext(makeReport({ ps: { playerCount: 300 } }));
  // estimateRamGb is internal; check via the very-large-heap info instead
  const a = SparkRules.analyze(makeReport({ sys: {
    memory: { physical: { used: 4e10, total: 6.9e10 }, swap: { used: 0, total: 0 } },
    java: { vendor: 'T', version: '21.0.6', vmArgs: '-Xms32G -Xmx32G -XX:G1NewSizePercent=30' },
    cpu: { threads: 16, modelName: 'AMD Ryzen 9 5950X', processUsage: { last1m: 0.2 }, systemUsage: { last1m: 0.25 } },
    os: { name: 'Linux' },
  } }));
  ok('very large heap info', /Very large heap/.test(titlesOf(a)), titlesOf(a));
}
/* 11. Folia */
{
  const regionThread = { name: 'Region Scheduler Thread #2', times: [90000], childrenRefs: [0], children: [{ className: 'net.minecraft.server.level.ServerLevel', methodName: 'tickNonPassenger', times: [90000], childrenRefs: [] }] };
  const a = SparkRules.analyze(makeReport({ pm: { name: 'Folia', brand: 'Folia' }, threads: [baseThread(), regionThread] }));
  const t = titlesOf(a);
  ok('folia profile note', /Folia report/.test(t), t);
  ok('no busy-thread warning for region thread', !/Another busy thread/.test(t));
}
/* 12. hytale */
{
  const a = SparkRules.analyze(makeReport({ pm: { name: 'Hytale Server', brand: 'Hytale', minecraftVersion: '' } }));
  ok('hytale note', /Hytale server report/.test(titlesOf(a)), titlesOf(a));
  ok('no java-update finding for hytale', !/Update Java/.test(titlesOf(a)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
