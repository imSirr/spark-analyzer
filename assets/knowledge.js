/* =========================================================================
 * Spark Analyzer — knowledge base
 *  - platform detection
 *  - flame-graph subsystem classifier (Spigot + Mojmap signatures)
 *  - optimization-mod catalog (platform-tagged, scenario-based)
 *  - bundled spark info-points (hover descriptions), from lucko/spark-infopoints
 * ========================================================================= */

const SparkKB = (() => {

  /* ---------------- platform detection ---------------- */
  function classifyPlatform(meta) {
    const name = (meta.platformName || '').toLowerCase();
    const brand = (meta.brand || '').toLowerCase();
    const type = (meta.platformType || '').toUpperCase();
    const s = name + ' ' + brand;
    const has = w => s.includes(w);

    let loader = 'unknown', family = 'unknown', label = meta.brand || meta.platformName || 'Unknown';
    if (type === 'PROXY' || has('velocity') || has('bungeecord') || has('waterfall') || has('gate')) {
      loader = 'proxy'; family = 'proxy';
    } else if (has('neoforge')) { loader = 'neoforge'; family = 'modded'; }
    else if (has('quilt')) { loader = 'quilt'; family = 'modded'; }
    else if (has('fabric')) { loader = 'fabric'; family = 'modded'; }
    // hybrids first (they contain "forge" AND a bukkit api)
    else if (has('mohist') || has('arclight') || has('magma') || has('youer') || has('cardboard') || has('banner')) { loader = 'hybrid'; family = 'hybrid'; }
    else if (has('forge')) { loader = 'forge'; family = 'modded'; }
    else if (has('folia')) { loader = 'paper'; family = 'bukkit'; }
    else if (has('purpur')) { loader = 'paper'; family = 'bukkit'; }
    else if (has('pufferfish')) { loader = 'paper'; family = 'bukkit'; }
    else if (has('paper')) { loader = 'paper'; family = 'bukkit'; }
    else if (has('spigot')) { loader = 'spigot'; family = 'bukkit'; }
    else if (has('craftbukkit') || has('bukkit')) { loader = 'craftbukkit'; family = 'bukkit'; }
    return { loader, family, label, isModded: family === 'modded', isBukkit: family === 'bukkit' || family === 'hybrid', isProxy: family === 'proxy' };
  }

  /* ---------------- subsystem classifier ----------------
   * Each subsystem has signature patterns that match a frame's "class.method".
   * Patterns deliberately cover BOTH Spigot mappings (WorldServer, PlayerChunkMap,
   * PathfinderGoalSelector...) and Mojang mappings (ServerLevel, ChunkMap, GoalSelector...).
   * Order matters: more specific subsystems are listed first.
   */
  const SUBSYSTEMS = [
    { id: 'idle', label: 'Idle / waiting (healthy)', icon: '😴', idle: true,
      patterns: [/waitUntilNextTick/i, /sleepForTick/i, /\bThread\.sleep\b/i, /LockSupport\.park/i, /Unsafe\.park/i, /pollTask/i] },

    { id: 'hoppers', label: 'Hoppers', icon: '📦',
      patterns: [/Hopper/i] },

    { id: 'redstone', label: 'Redstone', icon: '🔴',
      patterns: [/redstone/i, /RedStoneWire/i, /RedstoneTorch/i, /\.wire\./i] },

    { id: 'spawning', label: 'Mob spawning', icon: '🐣',
      patterns: [/NaturalSpawner/i, /SpawnState/i, /spawnCategoryForChunk/i, /mobSpawn/i] },

    { id: 'mobai', label: 'Mob AI / pathfinding', icon: '🧠',
      patterns: [/GoalSelector/i, /PathfinderGoal/i, /PathNavigation/i, /Navigation\.tick/i, /PathFinder/i, /\.pathfinder\./i, /\bBrain\b/i, /behavior/i, /\.ai\./i, /Sensor/i, /MemoryModule/i] },

    { id: 'villagers', label: 'Villagers / POI', icon: '🧑‍🌾',
      patterns: [/Villager/i, /PoiManager/i, /VillagePlace/i, /PoiSection/i, /\bpoi\b/i] },

    { id: 'blockticks', label: 'Random block ticks (crops, fire, fluids, ice)', icon: '🌾',
      patterns: [/tickChunk\b/, /randomTick/i, /tickBlock\b/, /CropBlock/i, /FarmBlock/i, /FireBlock/i, /SpreadingSnowyDirt/i] },

    { id: 'blockentities', label: 'Block entities (tile entities)', icon: '🧰',
      patterns: [/tickBlockEntities/i, /BlockEntity/i, /TileEntity/i, /\.block\.entity\./i] },

    { id: 'entities', label: 'Entity ticking', icon: '🐄',
      patterns: [/tickNonPassenger/i, /tickPassenger/i, /EntityTickList/i, /guardEntityTick/i, /\.entity\.Entity\.tick/i, /LivingEntity/i, /\.world\.entity\./i, /Mob\.(tick|aiStep)/i, /aiStep/i] },

    { id: 'worldgen', label: 'World generation', icon: '🌍',
      patterns: [/levelgen/i, /NoiseChunk/i, /NoiseBasedChunk/i, /ChunkGenerator/i, /generate(Noise|Surface|Features|Carvers|Structures)/i, /WorldGenRegion/i, /SurfaceRules/i, /\.feature\./i, /Structure(Start|Feature|Manager)/i, /BiomeSource/i, /ProtoChunk/i] },

    { id: 'lighting', label: 'Lighting engine', icon: '💡',
      patterns: [/LightEngine/i, /LevelLightEngine/i, /LightingProvider/i, /starlight/i, /\.lighting\./i, /SkyLight/i, /BlockLight/i] },

    { id: 'chunks', label: 'Chunk loading / ticking / saving', icon: '🧱',
      patterns: [/tickChunks?/i, /ChunkMap/i, /PlayerChunkMap/i, /ServerChunkCache/i, /ChunkProviderServer/i, /ChunkHolder/i, /DistanceManager/i, /ChunkTaskPriority/i, /ChunkSerializer/i, /ChunkStorage/i, /SectionStorage/i, /ChunkStatus/i, /\.chunk\./i, /unloadChunks/i, /saveAllChunks/i] },

    { id: 'fluids', label: 'Fluid (water/lava) ticking', icon: '💧',
      patterns: [/FlowingFluid/i, /LiquidBlock/i, /FluidState/i, /\.fluid\./i] },

    { id: 'datapack', label: 'Datapack command functions', icon: '📜',
      patterns: [/ServerFunctionManager/i, /CommandFunction/i, /Command Function/i, /FunctionManager/i] },

    { id: 'network', label: 'Networking / entity tracking', icon: '🌐',
      patterns: [/PlayerConnectionUtils/i, /ServerGamePacketListener/i, /PlayerConnection/i, /NetworkManager/i, /ServerConnection/i, /Connection\.(tick|send)/i, /sendPacket/i, /EntityTrackerEntry/i, /ChunkSender/i, /\.protocol\./i, /io\.netty/i, /broadcastChanges/i] },

    { id: 'storage', label: 'World / region file I/O', icon: '💾',
      patterns: [/RegionFile/i, /\.nbt\./i, /NbtIo/i, /CompoundTag/i, /SavedData/i, /DataFixer/i, /datafixers/i] },
  ];

  function classifyFrame(className, methodName) {
    const sig = (className || '') + '.' + (methodName || '');
    for (const sub of SUBSYSTEMS) {
      for (const p of sub.patterns) if (p.test(sig)) return sub.id;
    }
    return null;
  }
  function subsystemMeta(id) { return SUBSYSTEMS.find(s => s.id === id); }

  /* whether a class belongs to vanilla / jdk (i.e. not an add-on) */
  function originOfClass(className) {
    const c = className || '';
    if (/^(java|javax|jdk|sun|com\.sun)\./.test(c)) return 'jdk';
    if (/^net\.minecraft\./.test(c) || /^com\.mojang\./.test(c)) return 'vanilla';
    if (/^(org\.bukkit|org\.spigotmc|com\.destroystokyo|io\.papermc|org\.purpurmc|gg\.pufferfish)\./.test(c)) return 'server';
    return 'addon';
  }

  /* ---------------- optimization mod catalog ----------------
   * platforms: which loaders the mod supports.
   * scenarios: subsystem ids this mod helps with.
   */
  const MR = 'https://modrinth.com/mod/';
  const MODS = [
    { id: 'lithium', name: 'Lithium', url: MR + 'lithium', platforms: ['fabric', 'neoforge', 'quilt'],
      scenarios: ['entities', 'mobai', 'spawning', 'blockentities', 'blockticks', 'hoppers', 'chunks', 'fluids', 'villagers'],
      blurb: 'Speeds up a huge range of game logic (mob AI, block ticking, hoppers, chunks). Often 30-50% faster, with no change to how the game plays.' },
    { id: 'canary', name: 'Canary', url: 'https://www.curseforge.com/minecraft/mc-mods/canary', platforms: ['forge'],
      scenarios: ['entities', 'mobai', 'spawning', 'blockentities', 'blockticks', 'hoppers', 'chunks', 'fluids', 'villagers'],
      blurb: 'The Forge version of Lithium. Same game-logic speedups for Forge servers.' },
    { id: 'radium', name: 'Radium', url: MR + 'radium', platforms: ['forge', 'neoforge'],
      scenarios: ['entities', 'mobai', 'spawning', 'blockentities', 'blockticks', 'hoppers', 'chunks', 'fluids', 'villagers'],
      blurb: 'A Lithium port for (Neo)Forge. Same game-logic speedups, no gameplay changes.' },
    { id: 'moonrise', name: 'Moonrise', url: MR + 'moonrise-opt', platforms: ['fabric', 'neoforge'],
      scenarios: ['chunks', 'worldgen', 'lighting', 'entities'], conflicts: ['c2me'],
      blurb: "Spottedleaf's port of Paper's chunk and tick optimizations. Big wins for chunk loading, generation and lighting. It replaces C2ME, so don't run both." },
    { id: 'c2me', name: 'C2ME', url: MR + 'c2me-fabric', platforms: ['fabric'],
      scenarios: ['worldgen', 'chunks'], conflicts: ['moonrise'],
      blurb: 'Spreads chunk loading and world generation across all your CPU cores. Up to about 70% faster terrain, great when people explore a lot.' },
    { id: 'noisium', name: 'Noisium', url: MR + 'noisium', platforms: ['fabric', 'quilt', 'neoforge'],
      scenarios: ['worldgen'],
      blurb: 'Speeds up world generation by roughly 20-30%. Works well alongside chunk mods.' },
    { id: 'ferritecore', name: 'FerriteCore', url: MR + 'ferrite-core', platforms: ['fabric', 'forge', 'neoforge', 'quilt'],
      scenarios: ['memory'],
      blurb: 'Cuts RAM use by around 40-50% by removing duplicated block and model data. A must for big modpacks.' },
    { id: 'modernfix', name: 'ModernFix', url: MR + 'modernfix', platforms: ['fabric', 'forge', 'neoforge'],
      scenarios: ['memory', 'boot'],
      blurb: 'An all-in-one mod that lowers RAM use, speeds up startup, and fixes a lot of bugs and leaks. Standard in most modpacks.' },
    { id: 'memoryleakfix', name: 'MemoryLeakFix', url: MR + 'memoryleakfix', platforms: ['fabric', 'forge', 'quilt'], maxVer: '1.20.4',
      scenarios: ['memory'],
      blurb: 'Patches several known memory leaks (server and client). Good for servers that slow down the longer they run. (1.20.4 and older.)' },
    { id: 'servercore', name: 'ServerCore', url: MR + 'servercore', platforms: ['fabric', 'forge', 'neoforge'],
      scenarios: ['entities', 'spawning', 'chunks'],
      blurb: 'Server-focused tuning: mob and breeding caps, entity limits, and dynamic view distance. Great when you have lots of players.' },
    { id: 'krypton', name: 'Krypton', url: MR + 'krypton', platforms: ['fabric'],
      scenarios: ['network'],
      blurb: 'Optimizes the networking code (up to about 40% less network CPU). Helps with rubber-banding when players are many or far away.' },
    { id: 'clumps', name: 'Clumps', url: MR + 'clumps', platforms: ['fabric', 'forge', 'neoforge'],
      scenarios: ['entities'],
      blurb: 'Groups XP orbs into one entity, which stops the big TPS drops from XP and mob farms.' },
    { id: 'alternatecurrent', name: 'Alternate Current', url: MR + 'alternate-current', platforms: ['fabric', 'forge', 'neoforge', 'quilt'],
      scenarios: ['redstone'],
      blurb: 'Rewrites the redstone engine to be up to about 95% cheaper, while behaving exactly like vanilla. Great for big farms and contraptions.' },
    { id: 'aiimprovements', name: 'AI Improvements', url: MR + 'ai-improvements', platforms: ['forge', 'neoforge'],
      scenarios: ['mobai'],
      blurb: 'Lowers the CPU cost of mob pathfinding. Handy for packs with lots of custom or dense mobs.' },
    { id: 'scalablelux', name: 'ScalableLux', url: MR + 'scalablelux', platforms: ['fabric', 'forge', 'neoforge'],
      scenarios: ['lighting'],
      blurb: 'A fork of Starlight. A multithreaded, much faster lighting engine.' },
    { id: 'vmp', name: 'VMP (Very Many Players)', url: MR + 'vmp-fabric', platforms: ['fabric'],
      scenarios: ['network', 'chunks'],
      blurb: 'Optimizes player tracking and chunk sending for servers with lots of players online at once.' },
    { id: 'mobtimizations', name: 'Mobtimizations', url: MR + 'mobtimizations', platforms: ['fabric', 'forge'],
      scenarios: ['entities', 'mobai'],
      blurb: 'Tweaks entity behavior to cut their cost. Behavior can differ from vanilla very slightly.' },
    { id: 'structurelayout', name: 'Structure Layout Optimizer', url: MR + 'structurelayoutoptimizer', platforms: ['fabric', 'forge', 'neoforge'],
      scenarios: ['worldgen'],
      blurb: 'Speeds up structure generation. Handy for packs with lots of structures.' },
    { id: 'cesium', name: 'Cesium', url: MR + 'cesium', platforms: ['fabric', 'neoforge'],
      scenarios: ['storage'],
      blurb: 'Shrinks save file size, which eases disk load on big worlds.' },
    { id: 'alltheleaks', name: 'AllTheLeaks', url: MR + 'alltheleaks', platforms: ['neoforge', 'fabric'],
      scenarios: ['memory'],
      blurb: 'Finds and patches memory leaks from the game and from other mods.' },
    { id: 'chunky', name: 'Chunky (pre-generation)', url: 'https://modrinth.com/plugin/chunky', platforms: ['fabric', 'forge', 'neoforge', 'paper', 'spigot', 'craftbukkit', 'hybrid'],
      scenarios: ['worldgen', 'chunks'],
      blurb: 'Pre-generates your world so the server is not building terrain while players explore. Works as a plugin or a mod.' },
  ];

  function modsFor(loader, scenarioId) {
    return MODS.filter(m => m.platforms.includes(loader) && (!scenarioId || (m.scenarios || []).includes(scenarioId)));
  }

  /* server-software fork suggestions (bukkit family) */
  function forkSuggestion(platform) {
    const l = platform.loader;
    if (l === 'craftbukkit') return { sev: 'critical', text: 'CraftBukkit has none of the modern performance work. Switch to **Paper**, a drop-in replacement that gives a big TPS boost.', url: 'https://papermc.io/downloads/paper' };
    if (l === 'spigot') return { sev: 'warning', text: 'Spigot is well behind Paper on performance. **Paper** is a drop-in upgrade with a lot more optimizations.', url: 'https://papermc.io/downloads/paper' };
    if (l === 'paper') return { sev: 'info', text: 'On Paper you can squeeze out more with **Purpur** or **Pufferfish**. They add DAB (Dynamic Activation of Brain), which cuts the cost of mob and villager AI.', url: 'https://purpurmc.org/' };
    return null;
  }

  /* ---------------- info-points (hover descriptions) ----------------
   * Sourced from lucko/spark-infopoints (open source). Keyed by exact method
   * name; the UI matches on the frame's class.method().
   */
  const INFO_METHODS = {
    'net.minecraft.server.MinecraftServer.waitUntilNextTick()': 'Usually the server "sleeping" (waiting to process the next tick). Sometimes used to run scheduled tasks. This is healthy.',
    'net.minecraft.server.IAsyncTaskHandler.sleepForTick()': 'The server is waiting for the next tick. This is healthy idle time.',
    'net.minecraft.server.MinecraftServer.tickServer()': 'The main server update loop. It runs all the per-tick server work.',
    'net.minecraft.server.level.WorldServer.tick()': 'Updating a specific world: blocks, weather, scheduled ticks, etc.',
    'net.minecraft.server.level.ServerLevel.tick()': 'Updating a specific world: blocks, weather, scheduled ticks, etc.',
    'net.minecraft.world.level.entity.EntityTickList.forEach()': 'Iterating over every entity in a world to tick it. High here = too many entities.',
    'net.minecraft.world.level.World.tickBlockEntities()': 'Ticking block entities (chests, hoppers, furnaces…). High here = too many tile entities/hoppers.',
    'net.minecraft.world.level.Level.tickBlockEntities()': 'Ticking block entities (chests, hoppers, furnaces…). High here = too many tile entities/hoppers.',
    'net.minecraft.server.level.WorldServer.tickNonPassenger()': 'Ticking a single (non-passenger) entity and its AI.',
    'net.minecraft.server.level.ServerLevel.tickNonPassenger()': 'Ticking a single (non-passenger) entity and its AI.',
    'net.minecraft.server.level.ChunkProviderServer.tickChunks()': 'Ticking loaded chunks: random ticks, mob spawning, block ticking.',
    'net.minecraft.server.level.ServerChunkCache.tickChunks()': 'Ticking loaded chunks: random ticks, mob spawning, block ticking.',
    'net.minecraft.server.level.PlayerChunkMap.tick()': 'Managing which chunks are loaded/sent to players.',
    'net.minecraft.server.level.ChunkMap.tick()': 'Managing which chunks are loaded/sent to players.',
    'net.minecraft.world.entity.ai.goal.PathfinderGoalSelector.tick()': 'Running mob AI goals (pathfinding, targeting…). High here = mob AI cost.',
    'net.minecraft.world.entity.ai.goal.GoalSelector.tick()': 'Running mob AI goals (pathfinding, targeting…). High here = mob AI cost.',
    'net.minecraft.server.ServerFunctionManager.tick()': 'Datapack functions executed every tick. Use /perf to find expensive ones.',
    'net.minecraft.network.protocol.PlayerConnectionUtils.run()': 'Processing incoming packets (player actions).',
    'net.minecraft.server.level.EntityTrackerEntry.sendChanges()': 'Sending entity updates to clients. High here = many visible entities/players.',
  };
  const INFO_THREADS = {
    'Server thread': 'The main server thread that runs the game loop. Everything here counts against your MSPT.',
  };
  function infoFor(className, methodName, threadName) {
    if (threadName && INFO_THREADS[threadName]) return INFO_THREADS[threadName];
    const key = (className ? className + '.' : '') + (methodName || '') + '()';
    return INFO_METHODS[key] || null;
  }

  /* ---------------- CPU quality (from cpu model name) ---------------- */
  function cpuQuality(model) {
    const m = (model || '').toLowerCase();
    if (!m) return { tier: 'unknown' };
    if (/ryzen|threadripper|x3d/.test(m)) return { tier: 'good', note: 'an AMD Ryzen, which has strong single-core speed. Ideal for Minecraft.' };
    if (/epyc/.test(m)) return { tier: 'ok', note: 'an EPYC server CPU. Usually fine, though single-core speed depends on the host.' };
    if (/atom|celeron|pentium/.test(m)) return { tier: 'weak', note: 'a low-power CPU with weak single-core speed, which is a poor fit for Minecraft.' };
    if (/opteron/.test(m)) return { tier: 'weak', note: 'an old AMD Opteron with very weak single-core speed for Minecraft.' };
    // only flag clearly-old Xeons (E3/E5/E7 or v2-v4); modern Xeon-W/Scalable are fine
    if (/xeon/.test(m) && (/e[357]-\d/.test(m) || /\sv[234](\s|$)/.test(m)))
      return { tier: 'weak', note: 'an older Intel Xeon built for many-core server work, so the single-core speed Minecraft depends on is usually poor.' };
    if (/core\s*i[3579]|i[3579]-/.test(m)) return { tier: 'ok', note: 'a consumer Intel Core CPU. It works, though AMD Ryzen X3D chips are better for Minecraft.' };
    return { tier: 'unknown' };
  }

  /* ---------------- Java runtime recommendation ---------------- */
  function javaMajor(v) {
    const s = String(v || '').trim();
    let m = s.match(/^1\.(\d+)/); if (m) return parseInt(m[1]);     // 1.8.0 -> 8
    m = s.match(/^(\d+)/); return m ? parseInt(m[1]) : null;          // 17.0.8 -> 17
  }
  function recommendedJava(mcVersion) {
    const p = String(mcVersion || '').split('.').map(n => parseInt(n) || 0);
    const major = p[1] || 0, patch = p[2] || 0;
    if (major > 20 || (major === 20 && patch >= 5) || major >= 21) return 21;
    if (major >= 18) return 17;
    if (major >= 17) return 16;
    return 8;
  }

  /* ---------------- mod audit (from MC-Optimization-Guide) ---------------- */
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // aliases used to detect whether a given catalog mod is already installed
  const MOD_ALIASES = {
    lithium: ['lithium'], radium: ['radium'], canary: ['canary'], ferritecore: ['ferritecore'],
    modernfix: ['modernfix'], c2me: ['c2me', 'concurrentchunkmanagementengine', 'c2mefabric'],
    alltheleaks: ['alltheleaks'], moonrise: ['moonrise', 'moonriseopt'], noisium: ['noisium'],
    krypton: ['krypton', 'kryptonfnp', 'kryptonreforged'], clumps: ['clumps'],
    alternatecurrent: ['alternatecurrent'], mobtimizations: ['mobtimizations'],
    structurelayout: ['structurelayoutoptimizer'], cesium: ['cesium'],
    vmp: ['verymanyplayers', 'vmp'], servercore: ['servercore'], scalablelux: ['scalablelux'],
    aiimprovements: ['aiimprovements'], memoryleakfix: ['memoryleakfix'], chunky: ['chunky'],
  };

  // the core server-side mods worth having, per loader
  const CORE_MODS = {
    fabric: ['lithium', 'ferritecore', 'modernfix', 'c2me'],
    quilt: ['lithium', 'ferritecore', 'modernfix'],
    neoforge: ['lithium', 'ferritecore', 'modernfix', 'c2me'],
    forge: ['radium', 'ferritecore', 'modernfix'],
  };

  function modById(id) { return MODS.find(m => m.id === id); }
  function isModInstalled(id, normSet) {
    const al = MOD_ALIASES[id] || [id];
    if (al.some(a => normSet.has(a))) return true;
    const m = modById(id);
    return m ? normSet.has(norm(m.name)) : false;
  }

  // 'junk' = fake/AI/no-effect, 'harmful' = breaks things or vanilla parity, 'redundant' = fine but superseded
  const BAD_MODS = {
    // fake / no effect
    fpsboost: { sev: 'junk', reason: 'is a fake mod that does not actually improve performance.' },
    threatengl: { sev: 'junk', reason: 'is a fake mod that does not actually improve performance.' },
    gpubooster: { sev: 'junk', reason: 'does not actually fix VRAM leaks despite the name.' },
    gputape: { sev: 'junk', reason: 'does not actually fix VRAM leaks despite the name.' },
    videotape: { sev: 'junk', reason: 'does not actually fix VRAM leaks despite the name.' },
    // AI-generated / problematic
    async: { sev: 'junk', reason: 'has compatibility issues and contains AI-generated code.' },
    unbinilium: { sev: 'junk', reason: 'is an AI-generated mod that can cause severe performance issues.' },
    propane: { sev: 'junk', reason: 'is AI-generated and gives no real performance gain.' },
    projectunbound: { sev: 'junk', reason: 'is AI-generated and gives no real performance gain.' },
    ravicon: { sev: 'junk', reason: 'is AI-generated.' },
    vramo: { sev: 'junk', reason: 'is likely AI-generated with a questionable benefit.' },
    clab: { sev: 'junk', reason: 'is low-quality and redundant with proper culling mods.' },
    superfastmath: { sev: 'junk', reason: 'can actually be slower than vanilla and overlaps with Lithium.' },
    // breaks parity / harmful
    fasterrandom: { sev: 'harmful', reason: 'breaks vanilla parity by changing how randomness works.' },
    methane: { sev: 'harmful', reason: 'disables light calculations and breaks vanilla parity, and conflicts with proper lighting mods.' },
    ksyxis: { sev: 'harmful', reason: 'removes spawn chunks, which can break farms and mechanics that rely on them.' },
    smoothchunksave: { sev: 'harmful', reason: 'stops saving the world once MSPT goes above 50, which risks losing data.' },
    performant: { sev: 'harmful', reason: 'slows parts of the game down to fake higher performance.' },
    dimensionalthreading: { sev: 'harmful', reason: 'has known compatibility issues and bugs.' },
    optifine: { sev: 'harmful', reason: 'often causes performance and mod-compatibility problems, and does nothing on a server anyway.' },
    // redundant (gentle)
    rubidium: { sev: 'redundant', reason: 'overlaps with Embeddium.', alt: 'Embeddium' },
    xenon: { sev: 'redundant', reason: 'overlaps with Embeddium.', alt: 'Embeddium' },
    magnesium: { sev: 'redundant', reason: 'overlaps with Embeddium.', alt: 'Embeddium' },
    halogen: { sev: 'redundant', reason: 'overlaps with Embeddium.', alt: 'Embeddium' },
    chlorine: { sev: 'redundant', reason: 'overlaps with Embeddium.', alt: 'Embeddium' },
    hydrogen: { sev: 'redundant', reason: 'overlaps with FerriteCore.', alt: 'FerriteCore' },
    helium: { sev: 'redundant', reason: 'overlaps with FerriteCore.', alt: 'FerriteCore' },
    saturn: { sev: 'redundant', reason: 'overlaps with ModernFix.', alt: 'ModernFix' },
    dashloader: { sev: 'redundant', reason: 'overlaps with ModernFix.', alt: 'ModernFix' },
    fastboot: { sev: 'redundant', reason: 'overlaps with ModernFix.', alt: 'ModernFix' },
    lightspeed: { sev: 'redundant', reason: 'overlaps with ModernFix.', alt: 'ModernFix' },
    threadtweak: { sev: 'redundant', reason: 'overlaps with C2ME.', alt: 'C2ME' },
    fastasyncworldsave: { sev: 'redundant', reason: 'is redundant and partly incompatible with C2ME.', alt: 'C2ME' },
    chunksending: { sev: 'redundant', reason: 'overlaps with Krypton.', alt: 'Krypton' },
    outofsight: { sev: 'redundant', reason: 'overlaps with Entity Culling.', alt: 'Entity Culling' },
    memoryleakfix: { sev: 'redundant', reason: 'is mostly unnecessary on modern versions, where these leaks are already fixed.', minMinor: 21 },
    canary: { sev: 'redundant', reason: 'overlaps with Radium on Forge/NeoForge.', alt: 'Radium', loaders: ['forge', 'neoforge'] },
  };

  function mcMinorOf(v) { const p = String(v || '').split('.'); return parseInt(p[1]) || 0; }

  function modAudit(names, loader, mcVersion) {
    const minor = mcMinorOf(mcVersion);
    const normSet = new Set(names.map(norm));
    const remove = [], redundant = [];
    names.forEach(n => {
      const b = BAD_MODS[norm(n)];
      if (!b) return;
      if (b.minMinor && !(minor >= b.minMinor)) return;
      if (b.maxMinor && !(minor <= b.maxMinor)) return;
      if (b.loaders && !b.loaders.includes(loader)) return;
      if (b.sev === 'redundant') redundant.push({ name: n, reason: b.reason, alt: b.alt });
      else remove.push({ name: n, sev: b.sev, reason: b.reason });
    });
    let core = (CORE_MODS[loader] || []).slice();
    if (isModInstalled('moonrise', normSet)) core = core.filter(id => id !== 'c2me'); // Moonrise replaces C2ME
    const missingCore = core.filter(id => !isModInstalled(id, normSet)).map(id => {
      const m = modById(id); return { id, name: m.name, url: m.url, blurb: m.blurb };
    });
    return { remove, redundant, missingCore };
  }

  /* ---------------- client-only mod detection ----------------
   * High-confidence, hand-vetted list of mods that ONLY affect a player's own
   * game (rendering, HUD, sound, input, cosmetics, item viewers). On a dedicated
   * server they do nothing. The EXCLUDE set is a safety net for mods that are
   * actually server-side or "both" (verified) so they are never flagged.
   * This is intentionally conservative: when unsure, a mod is left out.
   */
  const CLIENT_ONLY_RAW = [
    // renderers / shaders / sodium family / optifine
    'sodium','sodium-fabric','sodiumextras','sodiumoptionsapi','sodiumoptionsmodcompat','sodiumleafculling',
    'sodiumdynamiclights','sodiumcoreshadersupport','sodium-shader-support','xanders-sodium-options','indium',
    'embeddium','textrues_embeddium_options','textruesrubidiumoptions','rubidium','rubidium_extras','magnesium_extras',
    'reforgium','cubium','beddium','relictium','xenon','lazurite','neoculus','oculus','iris','optifine','optiforge',
    'optigui','euphoriapatcher','colorwheel','colorwheel_patcher','watermedia','nvidium','acedium',
    // zoom
    'absolutely-not-a-zoom-mod','justzoom','vanillazoom','itemzoom','ok-zoomer','wisla',
    // client fps / visual
    'immediatelyfast','immediatelyfastreforged','fpsreducer','fpsreducer2','fps-monitor','entityculling','cullleaves',
    'cull-less-leaves','culllessleaves','cullparticles','cull-particles','dynamic-fps','flickerfix','gpumemleakfix',
    'gpushift','smoothfocus','smoothswapping','notenoughanimations','animaticareforged','fancyblockparticles',
    'chunkanimator','blinkload','stop_rendering','cleanview','better-clouds','betterfoliage','fallingleaves',
    'bettergrassify','clear-water','cave_dust','wakes','effective','particle-rain','particular','particleeffects',
    'fancyspawneggs','ctm','connectedness','configured-connectedness','entity-texture-features','entity_texture_features',
    'entity_model_features','better-hp','itemphysiclite','itemstitchingfix','nbt_glint','axolotl-item-fix',
    // dynamic lights / brightness / fog
    'dynamiclights','dynamiclightsreforged','ryoamiclights','lightfallclient','fadingnightvision','fullbrightnesstoggle',
    'hennyfullbright','voidfog','nofog','betterfog','fogtweaker','simplefog','darkness','totaldarkness',
    'perdimensionbrightness','resource_gamma_util','betterdarkmode','areyoublind','perception','no_nv_flash',
    // huds / overlays / info
    'betterf3','betterpingdisplay','pinghud','ping','inventoryhud','rpg-hud','armorhud','immersivearmorhud',
    'detailarmorbar','overloadedarmorbar','armorchroma','armorpointspp','toughnessbar','classicbar','healthoverlay',
    'torohealth','neat','beenfo','paperdoll','guiclock','guicompass','light-overlay','lightoverlay','minihud',
    'litematica','forgematica','durability101','durabilitynotifier','durabilitytooltip','pickupnotifier','itemborders',
    'legendarytooltips','enhancedtooltips','adaptivetooltips','inline_tooltips','better_tooltips','obscure_tooltips_fix',
    'helditemtooltips','shulkertooltip','maptooltip','anviltooltipmod','miningspeedtooltips','modnametooltip',
    'tooltipscroller','whats-that-slot','status-effect-bars','enhanced_boss_bars','smarthud','smartcursor','floppyhud',
    'seasonhud','servercountryflags','memoryusagescreen','effectinsights','effectsleft','stylisheffects',
    'armorstatushud','leavemybarsalone','overflowingbars','heldeitemtooltips','horsestatsmod','batty\'scoordinatesplusmod',
    'wheredididie','coordinates','jade','wthit','toughnessbar',
    // chat
    'advancedchat','advancedchatcore','advancedchathud','chat_heads','chatnotify','longerchathistory','timestamp-chat',
    'timestamps','twitchchat','talkingheads','chat ping',
    // sound / music
    'ambientsounds','dynamicsurroundings','dynamicsurroundingshuds','soundfilters','audio improvements','presencefootsteps',
    'charmonium','dripsounds','ambience','ambientenvironment','extremesoundmuffler','soundreloader','sounddeviceoptions',
    'omegamute','music-duration-reducer','music_delay_reducer','musicdr','dynamic-music','dynmus','infinitemusic',
    'medievalmusic','combat_music','currentgamemusictrack','biomemusic','armorsoundtweak','auditory','coolrain',
    'redstone sound slider','soundreloader',
    // cosmetics / skins / first-person
    'essential','minecraftcapes','3dskinlayers','skinlayers3d','fabricemotes','mobends','firstpersonmod','firstperson',
    'shouldersurfing','betterthirdperson','backtools','jbra-client','portraitcraft',
    // menus / gui / input
    'controlling','mousewheelie','mousetweaks','inventoryessentials','inventorytweaks','inventoryprofiles','inventoryspam',
    'itemlocks','movingslots','multihotbar','bh-menu','minemenu','packmenu','custommainmenu','bettertitlescreen','modtabs',
    'modernui','catalogue','configured','controllable','controller support','gamemenumodoption','keybindspurger','keywizard',
    'keymap','rebind-narrator','mcbindtype','antighost','massunbind','bettermodsbutton','yungsmenutweaks','fancymenu',
    'drippyloadingscreen','loadmyresources','defaultoptions','defaultsettings','resourcepackoverrides','resourcepackorganizer',
    'keeptheresourcepack','resourceloader','packmodemenu','betterplacement','preciseblockplacing','custom-crosshair-mod',
    'customcursor','customcursormod','fabriccustomcursormod','forgecustomcursormod','dynamiccrosshair','catchindicator',
    'catchrate-display','tiptthescales','tipthescales','blur','borderlesswindow','borderless','fullscreenwindowed',
    'windowedfullscreen','translucent-window','panorama','rrls','noautojump','cutthrough','hidehands','itlt','catalogue',
    // discord rpc / social
    'craftpresence','simplediscordrichpresence','simple-rpc','discordrpc','customdiscordrpc','lotrdrp','minetogether',
    'galacticraft-rpc','simplerpc',
    // item viewers / recipe (client)
    'jei','justenoughitems','roughlyenoughitems','emi','justenoughcalculation','justenougheffects','justenoughprofessions',
    'justenoughbeacons','just-enough-harvestcraft','justenoughdrags','jeed','jehc','jei_hover_search','jei_trim_hider',
    'jeiintegration','jerintegration','neirecipehandlers','distraction_free_recipes','better-recipe-book','hiddenrecipebook',
    'tconjei','tconplanner','forestryworktabledisplay','enchantmentdescriptions','nekosenchantedbooks','enchantment-lore',
    'completionistsindex','itemzoom','jead','whats-that-slot',
    // misc client utilities
    'reauth','authme','oldjavawarning','nostartupmessages','shutupexperimentalsettings','shutupmodelloader',
    'shut_up_gl_error','yeetusexperimentus','screenshot-to-clipboard','advancementscreenshot','freecam','freelook',
    'fastquit','fast-ip-ping','auto-reconnect','autoreconnect','cherishedworlds','desiredservers','notes','notifmod',
    'tips','toast control','toastcontrol','ding','eiramoticons','craftpresence','fabricmod_voxelmap','forgemod_voxelmap',
    'jmi','clienttweaks','modnametooltip','craftpresence',
  ];
  // verified server-side or "both" mods that must NEVER be flagged as client-only
  const CLIENT_EXCLUDE_RAW = [
    'phosphor','lazydfu','smoothboot','smoothbootreloaded','radon','helium','hydrogen','replanter','spawnerfix',
    'certain_questing_additions','appliedsorting','ae_pattern_improve','guideme','mindful-eating','exhaustedstamina',
    'extendedhitbox','mobplusplus','bannerunlimited','e4mc','mcwifipnp','ngrok-lan-expose-mod','viaforge','viaversion',
    'torchoptimizer','ferritecore','modernfix','c2me','lithium','radium','canary','moonrise','krypton','clumps',
    'alternatecurrent','servercore','scalablelux','noisium','alltheleaks','mobtimizations','structurelayoutoptimizer',
    'cesium','chunky','vmp','verymanyplayers',
  ];
  const CLIENT_ONLY = new Set(CLIENT_ONLY_RAW.map(norm).filter(Boolean));
  const CLIENT_EXCLUDE = new Set(CLIENT_EXCLUDE_RAW.map(norm).filter(Boolean));

  // returns the subset of given mod names that are confidently client-only
  function detectClientMods(names) {
    const out = [];
    (names || []).forEach(n => {
      const k = norm(n);
      if (k && CLIENT_ONLY.has(k) && !CLIENT_EXCLUDE.has(k)) out.push(n);
    });
    return out;
  }

  /* map an unattributed class to an installed mod/plugin by package name */
  function guessSourceFromPackage(className, sources) {
    if (!className) return null;
    const c = className.toLowerCase().replace(/[^a-z0-9]/g, '');
    let best = null, bestLen = 0;
    (sources || []).forEach(src => {
      const nm = norm(src.name);
      if (nm.length >= 4 && c.includes(nm) && nm.length > bestLen) { best = src.name; bestLen = nm.length; }
    });
    return best;
  }

  /* small brand-styled badge per platform (offline, no external logos) */
  const PLATFORM_STYLE = {
    paper:       { color: '#eceff4', text: '#1b1f27', mono: 'Pa', name: 'Paper' },
    purpur:      { color: '#8b5cf6', text: '#ffffff', mono: 'Pu', name: 'Purpur' },
    pufferfish:  { color: '#f4a259', text: '#231a10', mono: 'Pf', name: 'Pufferfish' },
    folia:       { color: '#34d399', text: '#06281e', mono: 'Fo', name: 'Folia' },
    spigot:      { color: '#cda434', text: '#231d06', mono: 'Sp', name: 'Spigot' },
    craftbukkit: { color: '#c98b3a', text: '#231706', mono: 'CB', name: 'CraftBukkit' },
    fabric:      { color: '#cdb389', text: '#26200f', mono: 'Fa', name: 'Fabric' },
    quilt:       { color: '#c084fc', text: '#1f0f33', mono: 'Qu', name: 'Quilt' },
    forge:       { color: '#1f3b57', text: '#dbe7f3', mono: 'Fg', name: 'Forge' },
    neoforge:    { color: '#f16436', text: '#ffffff', mono: 'Ne', name: 'NeoForge' },
    hybrid:      { color: '#6b7280', text: '#ffffff', mono: 'Hy', name: 'Hybrid' },
    proxy:       { color: '#3b82f6', text: '#ffffff', mono: 'Px', name: 'Proxy' },
    unknown:     { color: '#3a455a', text: '#cbd5e1', mono: '?',  name: 'Unknown' },
  };
  function platformStyle(loader) { return PLATFORM_STYLE[loader] || PLATFORM_STYLE.unknown; }

  return { classifyPlatform, classifyFrame, subsystemMeta, SUBSYSTEMS, originOfClass, MODS, modsFor, forkSuggestion, infoFor, cpuQuality, javaMajor, recommendedJava, norm, isModInstalled, modAudit, detectClientMods, guessSourceFromPackage, platformStyle };
})();
