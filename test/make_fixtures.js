// Generate synthetic .sparkprofile fixtures using the app's own bundled schema.
const fs = require('fs');
const protobuf = require('protobufjs');

const schemaSrc = fs.readFileSync(require('path').join(__dirname, '..', 'assets', 'schema.js'), 'utf8');
const m = schemaSrc.match(/const SPARK_PROTO = `([\s\S]*?)`;/);
if (!m) throw new Error('could not extract SPARK_PROTO');
const root = protobuf.parse(m[1], { keepCase: false }).root;
const SamplerData = root.lookupType('spark.SamplerData');

function node(className, methodName, ms, childrenRefs) {
  return { className, methodName, times: [ms], childrenRefs: childrenRefs || [] };
}

/* ---------- Fixture 1: laggy Paper 26.2 server ----------
 * 100s profile. Server thread total 100000ms:
 *  - waitUntilNextTick 30000 (idle) with libc child 20000 inside it
 *  - entity ticking 40000 (via ServerLevel.tick -> EntityTickList.forEach)
 *  - chunk work 20000, incl. a LockSupport.park(5000) INSIDE ChunkMap (sync-load stall)
 *  - a plugin frame 10000 (com.example.lagplugin)
 */
const pool1 = [
  /*0*/ node('net.minecraft.server.MinecraftServer', 'waitUntilNextTick', 30000, [1]),
  /*1*/ node('/usr/lib/x86_64-linux-gnu/libc.so.6', '(native)', 20000, []),
  /*2*/ node('net.minecraft.server.MinecraftServer', 'tickServer', 70000, [3, 5, 8]),
  /*3*/ node('net.minecraft.server.level.ServerLevel', 'tick', 40000, [4]),
  /*4*/ node('net.minecraft.world.level.entity.EntityTickList', 'forEach', 40000, []),
  /*5*/ node('net.minecraft.server.level.ChunkMap', 'tick', 20000, [6]),
  /*6*/ node('java.util.concurrent.locks.LockSupport', 'park', 5000, []),
  /*8*/ node('com.example.lagplugin.TaskRunner', 'run', 10000, []),
];
// fix ref index: node 8 is at pool index 7
pool1[2].childrenRefs = [3, 5, 7];

const fixture1 = {
  metadata: {
    platformMetadata: { type: 0, name: 'Paper', brand: 'Paper', version: '26.2.build.42', minecraftVersion: '26.2', sparkVersion: 2 },
    platformStatistics: {
      tps: { last1m: 13.5, last5m: 14.2, last15m: 15.0, gameTargetTps: 20 },
      mspt: { last1m: { mean: 72, max: 250, min: 30, median: 68, percentile95: 130 }, gameMaxIdealMspt: 50 },
      playerCount: 24,
      uptime: 86400000,
      memory: { heap: { used: 7.6e9, committed: 8e9, max: 8e9 } },
      onlineMode: 2,
      world: {
        totalEntities: 4200,
        entityCounts: { 'minecraft:villager': 950, 'minecraft:item': 800, 'minecraft:cow': 400, 'minecraft:zombie': 300 },
        worlds: [{
          name: 'world', totalEntities: 4200,
          regions: [{
            totalEntities: 4200,
            chunks: [
              { x: 10, z: -14, totalEntities: 620, entityCounts: { 'minecraft:villager': 500, 'minecraft:item': 120 } },
              { x: 3, z: 4, totalEntities: 200, entityCounts: { 'minecraft:cow': 200 } },
            ],
          }],
        }],
      },
    },
    systemStatistics: {
      cpu: { threads: 8, modelName: 'AMD Ryzen 7 5800X 8-Core Processor', processUsage: { last1m: 0.16, last15m: 0.15 }, systemUsage: { last1m: 0.2, last15m: 0.2 } },
      memory: { physical: { used: 1.3e10, total: 1.6e10 }, swap: { used: 0, total: 2e9 } },
      disk: { used: 9e10, total: 2.4e11 },
      gc: {
        'G1 Young Generation': { total: 900, avgTime: 25, avgFrequency: 1800 },
        'G1 Old Generation': { total: 40, avgTime: 350, avgFrequency: 9000 },
      },
      os: { arch: 'amd64', name: 'Linux', version: '6.8' },
      java: { vendor: 'Eclipse Adoptium', version: '21.0.4', vendorVersion: 'Temurin-21.0.4+7', vmArgs: '-Xms8G -Xmx8G -XX:+UseG1GC' },
      uptime: 86400000,
    },
    startTime: 1753300000000, endTime: 1753300100000, numberOfTicks: 1450, interval: 4000,
    samplerMode: 0, samplerEngine: 1,
    sources: {
      lagplugin: { name: 'LagPlugin', version: '1.0', author: 'someone' },
      clearlag: { name: 'ClearLagg', version: '3.2', author: 'bob' },
    },
    serverConfigurations: {},
  },
  threads: [{ name: 'Server thread', children: pool1, times: [100000], childrenRefs: [0, 2] }],
  classSources: { 'com.example.lagplugin.TaskRunner': 'LagPlugin' },
};

/* ---------- Fixture 2: healthy Fabric 1.21.1 modded server, missing core mods ---------- */
const pool2 = [
  node('net.minecraft.server.MinecraftServer', 'waitForTasks', 80000, []),
  node('net.minecraft.server.MinecraftServer', 'tickServer', 20000, [2]),
  node('net.minecraft.server.level.ServerLevel', 'tick', 15000, []),
];
const fixture2 = {
  metadata: {
    platformMetadata: { type: 0, name: 'Fabric', brand: 'Fabric', version: '0.16.5', minecraftVersion: '1.21.1', sparkVersion: 2 },
    platformStatistics: {
      tps: { last1m: 20, last5m: 20, last15m: 20, gameTargetTps: 20 },
      mspt: { last1m: { mean: 9, max: 60, min: 2, median: 8, percentile95: 18 }, gameMaxIdealMspt: 50 },
      playerCount: 5, uptime: 3600000,
      memory: { heap: { used: 3e9, committed: 6e9, max: 6e9 } },
    },
    systemStatistics: {
      cpu: { threads: 12, modelName: 'AMD Ryzen 5 7600', processUsage: { last1m: 0.08, last15m: 0.08 }, systemUsage: { last1m: 0.1, last15m: 0.1 } },
      memory: { physical: { used: 1e10, total: 3.2e10 }, swap: { used: 0, total: 0 } },
      gc: { 'G1 Young Generation': { total: 60, avgTime: 12, avgFrequency: 45000 }, 'G1 Old Generation': { total: 0, avgTime: 0, avgFrequency: 0 } },
      java: { vendor: 'Eclipse Adoptium', version: '21.0.6', vendorVersion: 'Temurin', vmArgs: '-Xms6G -Xmx6G' },
    },
    startTime: 1753300000000, endTime: 1753300300000, numberOfTicks: 6000, interval: 4000,
    samplerMode: 0, samplerEngine: 1,
    sources: {
      sodium: { name: 'Sodium', version: '0.6.0' },
      memoryleakfix: { name: 'MemoryLeakFix', version: '1.1.5' },
      fasterrandom: { name: 'Faster Random', version: '3.0' },
      somecontentmod: { name: 'SomeContentMod', version: '2.0' },
    },
    serverConfigurations: {},
  },
  threads: [{ name: 'Server thread', children: pool2, times: [100000], childrenRefs: [0, 1] }],
  classSources: {},
};

for (const [name, fx] of [['laggy-paper-26.2', fixture1], ['healthy-fabric-1.21.1', fixture2]]) {
  const err = SamplerData.verify(fx);
  if (err) throw new Error(name + ': ' + err);
  const buf = SamplerData.encode(SamplerData.create(fx)).finish();
  const out = require('path').join(__dirname, 'fixtures', name + '.sparkprofile');
  fs.mkdirSync(require('path').join(__dirname, 'fixtures'), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(name, buf.length, 'bytes ->', out);
}
