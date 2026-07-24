// Phase 0 verification harness — loads knowledge.js + rules.js in Node and
// asserts the fixed behaviors.
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'assets') + require('path').sep;
const src = fs.readFileSync(path + 'knowledge.js', 'utf8') + '\n' + fs.readFileSync(path + 'rules.js', 'utf8');
const sandbox = {};
new Function('globalThis', src + '\n;globalThis.SparkKB = SparkKB; globalThis.SparkRules = SparkRules;')(sandbox);
const { SparkKB, SparkRules } = sandbox;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } }

/* ---- mcEra ---- */
eq('mcEra 1.20.5', SparkKB.mcEra('1.20.5'), 20.05);
eq('mcEra 1.21.11', SparkKB.mcEra('1.21.11'), 21.11);
eq('mcEra 26.1', SparkKB.mcEra('26.1'), 101);
eq('mcEra 26.2', SparkKB.mcEra('26.2'), 102);
eq('mcEra 26.1.2', SparkKB.mcEra('26.1.2'), 101);
eq('mcEra 27.1', SparkKB.mcEra('27.1'), 111);
eq('mcEra 1.8.8', SparkKB.mcEra('1.8.8'), 8.08);
eq('mcEra garbage', SparkKB.mcEra('foo'), 0);
ok('mcEra ordering', SparkKB.mcEra('26.1') > SparkKB.mcEra('1.21.11'));

/* ---- recommendedJava ---- */
eq('java for 26.2', SparkKB.recommendedJava('26.2'), 25);
eq('java for 26.1.2', SparkKB.recommendedJava('26.1.2'), 25);
eq('java for 1.21.4', SparkKB.recommendedJava('1.21.4'), 21);
eq('java for 1.20.5', SparkKB.recommendedJava('1.20.5'), 21);
eq('java for 1.20.4', SparkKB.recommendedJava('1.20.4'), 17);
eq('java for 1.18.2', SparkKB.recommendedJava('1.18.2'), 17);
eq('java for 1.16.5', SparkKB.recommendedJava('1.16.5'), 8);
eq('java for unknown', SparkKB.recommendedJava(''), null);

/* ---- modAudit era gates (memoryleakfix minMinor:21 should fire on 26.x) ---- */
const audit26 = SparkKB.modAudit(['MemoryLeakFix'], 'fabric', '26.1');
ok('memoryleakfix flagged redundant on 26.1', audit26.redundant.some(r => /memoryleakfix/i.test(r.name)));
const audit1194 = SparkKB.modAudit(['MemoryLeakFix'], 'fabric', '1.19.4');
ok('memoryleakfix NOT flagged on 1.19.4', !audit1194.redundant.some(r => /memoryleakfix/i.test(r.name)));

/* ---- fasterrandom now gentle ---- */
const auditFR = SparkKB.modAudit(['Faster Random'], 'fabric', '1.21.1');
ok('fasterrandom is redundant (gentle), not remove', auditFR.redundant.length === 1 && auditFR.remove.length === 0);

/* ---- JEI/EMI no longer client-only ---- */
eq('JEI/REI/EMI not flagged client-only', SparkKB.detectClientMods(['JEI', 'EMI', 'Roughly Enough Items', 'Sodium']), ['Sodium']);

/* ---- idle classification patterns ---- */
eq('waitForTasks is idle', SparkKB.classifyFrame('net.minecraft.server.MinecraftServer', 'waitForTasks'), 'idle');
eq('parkNanos is idle-pattern', SparkKB.classifyFrame('java.util.concurrent.locks.LockSupport', 'parkNanos'), 'idle');

/* ---- computeBreakdown idle attribution ---- */
// Build a fake thread: root -> waitUntilNextTick(600self) -> libc native(300self)
//                       root -> tickChildren: ServerLevel.tick(0) -> EntityTickList.forEach(100)
//                       root -> ChunkMap.tick(0) -> LockSupport.park(50)   [blocking inside work => chunks]
const pool = [
  { className: 'net.minecraft.server.MinecraftServer', methodName: 'waitUntilNextTick', times: [900], childrenRefs: [1] }, // 0
  { className: '/usr/lib/x86_64-linux-gnu/libc.so.6', methodName: '(native)', times: [300], childrenRefs: [] },            // 1
  { className: 'net.minecraft.server.level.ServerLevel', methodName: 'tick', times: [100], childrenRefs: [3] },            // 2
  { className: 'net.minecraft.world.level.entity.EntityTickList', methodName: 'forEach', times: [100], childrenRefs: [] }, // 3
  { className: 'net.minecraft.server.level.ChunkMap', methodName: 'tick', times: [50], childrenRefs: [5] },                // 4
  { className: 'java.util.concurrent.locks.LockSupport', methodName: 'park', times: [50], childrenRefs: [] },              // 5
];
const thread = { name: 'Server thread', times: [1050], children: pool, childrenRefs: [0, 2, 4] };
const bd = SparkRules._internal.computeBreakdown(thread, {}, 'Paper', []);
eq('idle includes native child under wait', bd.idle, 900);           // 600 self + 300 libc descendant
ok('no idle key leaks into bySub', !('idle' in bd.bySub) && !('__idle__' in bd.bySub));
eq('entities time attributed', bd.bySub.entities, 100);
eq('park under ChunkMap counts as chunks, not idle', bd.bySub.chunks, 50);
eq('active excludes inherited idle', bd.active, 150);
ok('entity pct now correct (100/150)', Math.abs(bd.bySub.entities / bd.active - 0.6667) < 0.01);

/* ---- GC frequency threshold (unit = ms) ---- */
// analyze() path needs a full report; test the constant indirectly by checking source text.
const rulesSrc = fs.readFileSync(path + 'rules.js', 'utf8');
ok('frequentGc uses 20000ms', /avgFreq < 20000/.test(rulesSrc));
ok('no flagAdvice remnants', !/flagAdvice/.test(rulesSrc));
ok('ZGenerational only in the Java-21 branch', /curJ >= 23 \? 'You can try `-XX:\+UseZGC`/.test(rulesSrc) && /On Java 21 you can try `-XX:\+UseZGC -XX:\+ZGenerational`/.test(rulesSrc));
const appSrc = fs.readFileSync(path + 'app.js', 'utf8');
ok('no setLatestMc call left', !/setLatestMc/.test(appSrc));
ok('GC display uses fmtMs', /every ' \+ fmtMs\(Number\(g\.avgFrequency\)\)/.test(appSrc));

/* ---- full analyze() smoke test on a synthetic 26.2 report ---- */
const report = {
  type: 'sampler',
  data: {
    metadata: {
      platformMetadata: { name: 'Paper', brand: 'Paper', minecraftVersion: '26.2', version: '26.2.build.42', type: 'SERVER' },
      platformStatistics: {
        tps: { last1m: 12.0, last5m: 13.0, last15m: 14.0 },
        mspt: { last1m: { mean: 70, max: 200, min: 30, median: 68, percentile95: 120 } },
        playerCount: 20,
        memory: { heap: { used: 3.9e9, max: 4e9 } },
      },
      systemStatistics: {
        cpu: { threads: 8, modelName: 'AMD Ryzen 7 5800X', processUsage: { last1m: 0.15 }, systemUsage: { last1m: 0.2 } },
        memory: { physical: { used: 1.2e10, total: 1.6e10 } },
        gc: { 'G1 Old Generation': { total: 50, avgTime: 400, avgFrequency: 9000 }, 'G1 Young Generation': { total: 900, avgTime: 20, avgFrequency: 1500 } },
        java: { version: '21.0.4', vmArgs: '-Xmx4G -Xms4G' },
      },
      sources: {},
      serverConfigurations: {},
      samplerMode: 'EXECUTION',
    },
    threads: [thread],
    classSources: {},
  },
};
const analysis = SparkRules.analyze(report);
ok('analyze() runs on 26.2 report', !!analysis && Array.isArray(analysis.issues));
const titles = analysis.issues.map(i => i.title).join(' | ');
ok('memory-bound verdict fires (freq 9s old-gen + long pauses + heap 97%)', /Main limit: RAM/.test(titles));
const javaIssue = analysis.issues.find(i => /Update Java/.test(i.title));
ok('recommends Java 25 on 26.2 (running 21)', javaIssue && /25/.test(javaIssue.title));
ok('no Aikar warning on MC 26.2', !/Aikar/.test(titles));
ok('no idle finding emitted', !/Idle \/ waiting/.test(titles));
console.log('issues found on synthetic report:', analysis.issues.map(i => `[${i.severity}] ${i.title}`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
