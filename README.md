# Spark Analyzer

A fast, self contained web app that reads [spark](https://spark.lucko.me/) reports for Minecraft
servers and tells you, in plain language, **what is actually slowing your server down and how to
fix it**. Paste a `spark.lucko.me` link (or drop a `.sparkprofile` / `.sparkheap` file) and you get
a bottleneck verdict, a tick by tick breakdown, entity hotspots with coordinates, a plugin/mod
audit, an interactive timeline, and clear recommendations.

**Live**: [https://imsirr.github.io/spark-analyzer/](https://imsirr.github.io/spark-analyzer/)

Everything runs in the browser. There is no backend and no build step, so it deploys to GitHub
Pages (or any static host) exactly as is. Your report data never leaves your computer.

> Not affiliated with spark, PaperMC, or any server platform. It just reads spark's public data format.

## What it does

- **Bottleneck verdict.** Tells you whether you are **CPU/complexity bound or memory bound**, so you
  do not waste money on RAM that will not help. It accounts for the fact that Minecraft runs the
  world on a single thread, so overall CPU usage can look low even when one core is maxed out.
- **Tick breakdown.** Reads the profiler and splits the server thread's time across subsystems
  (entity ticking, mob AI, spawning, block entities, hoppers, chunk loading, world generation,
  lighting, redstone, fluids, networking, datapack functions, and more), and shows busy non main
  threads too.
- **Straight fixes plus the right mod.** Each hot subsystem maps to a concrete action and, for
  modded servers, a platform matched optimization mod (Lithium, Radium, Canary, Moonrise, C2ME,
  FerriteCore, ModernFix, ServerCore, Krypton, Clumps, Alternate Current, Chunky, and others).
- **Mod audit (modded).** Flags installed mods that are fake, broken, or redundant (with what to
  use instead), points out missing core optimization mods for your loader and version, and lists
  **client only mods** that do nothing on a dedicated server.
- **Entity hotspots.** The worst chunks by entity count, grouped per dimension with the total on
  each header row, and the exact coordinates to teleport to.
- **Source attribution.** Ranks plugins and mods by their share of server thread time so a single
  heavy add on cannot hide. Unmatched code is matched to a mod by package name where possible.
- **Health dashboard and interactive timeline.** TPS, MSPT, CPU, memory, GC, players and world
  stats with red / yellow / green status, plus a per minute history.
- **Flame graph and call tree, heap class histogram.** The classic views, with platform logos and
  entity icons.

It supports all three spark report types (profiler, heap summary, health), understands `--alloc`
allocation profiles, and adapts to proxy and client reports. It also avoids possible host specific false positives.

## How it works

Spark uploads reports to lucko's [bytebin](https://github.com/lucko/bytebin) content service and
encodes them with [Protocol Buffers](https://protobuf.dev/). This app:

1. Pulls the report code out of the link.
2. Fetches the raw bytes from `https://spark-usercontent.lucko.me/<code>` (bytebin allows cross
   origin requests), and decompresses them if needed.
3. Decodes them with [protobuf.js](https://github.com/protobufjs/protobuf.js) using the bundled
   spark schema.
4. Runs the recommendation engine and renders everything.

## Credits

- Built around the open data format of [lucko/spark](https://github.com/lucko/spark) and
  [spark-viewer](https://github.com/lucko/spark-viewer); frame descriptions from
  [lucko/spark-infopoints](https://github.com/lucko/spark-infopoints).
- Recommendation rules and the optimization mod lists were adapted from the community:
  [birdflop/botflop](https://github.com/birdflop/botflop), the
  [MC-Optimization-Guide](https://github.com/Polytetrafluoroethylene-PTFE/MC-Optimization-Guide)
  (originally by Radk6), the [Paper optimization guide](https://paper-chan.moe/paper-optimization/),
  and various hosting and community guides.
- Mob icons from the open [Entity-Icons](https://github.com/Simplexity-Development/Entity-Icons) set.
- Platform logos are the property of their respective projects and are used here only to identify
  the platform a report came from.

## License

PolyForm Noncommercial License 1.0.0
