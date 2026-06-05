/* =========================================================================
 * Spark Analyzer — data layer
 * Protobuf schema (merged from lucko/spark proto definitions) + fetch/decode.
 * No build step required: uses protobuf.js (full) + pako from CDN.
 * ========================================================================= */

const SPARK_PROTO = `
syntax = "proto3";
package spark;

/* ---------- shared (spark.proto) ---------- */

message PlatformMetadata {
  Type type = 1;
  string name = 2;
  string version = 3;
  string minecraft_version = 4;
  int32 spark_version = 7;
  string brand = 8;
  reserved 5, 6;
  enum Type { SERVER = 0; CLIENT = 1; PROXY = 2; APPLICATION = 3; }
}

message SystemStatistics {
  Cpu cpu = 1;
  Memory memory = 2;
  map<string, Gc> gc = 3;
  Disk disk = 4;
  Os os = 5;
  Java java = 6;
  int64 uptime = 7;
  map<string, NetInterface> net = 8;
  Jvm jvm = 9;
  message Cpu {
    int32 threads = 1;
    Usage process_usage = 2;
    Usage system_usage = 3;
    string model_name = 4;
    message Usage { double last1m = 1; double last15m = 2; }
  }
  message Memory {
    MemoryPool physical = 1;
    MemoryPool swap = 2;
    message MemoryPool { int64 used = 1; int64 total = 2; }
  }
  message Gc { int64 total = 1; double avg_time = 2; double avg_frequency = 3; }
  message Disk { int64 used = 1; int64 total = 2; }
  message Os { string arch = 1; string name = 2; string version = 3; }
  message Java { string vendor = 1; string version = 2; string vendor_version = 3; string vm_args = 4; }
  message Jvm { string name = 1; string vendor = 2; string version = 3; }
  message NetInterface {
    RollingAverageValues rx_bytes_per_second = 1;
    RollingAverageValues tx_bytes_per_second = 2;
    RollingAverageValues rx_packets_per_second = 3;
    RollingAverageValues tx_packets_per_second = 4;
  }
}

message PlatformStatistics {
  Memory memory = 1;
  map<string, Gc> gc = 2;
  int64 uptime = 3;
  Tps tps = 4;
  Mspt mspt = 5;
  Ping ping = 6;
  int64 player_count = 7;
  WorldStatistics world = 8;
  OnlineMode online_mode = 9;
  message Memory {
    MemoryUsage heap = 1;
    MemoryUsage non_heap = 2;
    repeated MemoryPool pools = 3;
    message MemoryPool { string name = 1; MemoryUsage usage = 2; MemoryUsage collection_usage = 3; }
    message MemoryUsage { int64 used = 1; int64 committed = 2; int64 init = 3; int64 max = 4; }
  }
  message Gc { int64 total = 1; double avg_time = 2; double avg_frequency = 3; }
  message Tps { double last1m = 1; double last5m = 2; double last15m = 3; int32 game_target_tps = 4; }
  message Mspt { RollingAverageValues last1m = 1; RollingAverageValues last5m = 2; int32 game_max_ideal_mspt = 3; }
  message Ping { RollingAverageValues last15m = 1; }
  enum OnlineMode { UNKNOWN = 0; OFFLINE = 1; ONLINE = 2; }
}

message WorldStatistics {
  int32 total_entities = 1;
  map<string, int32> entity_counts = 2;
  repeated World worlds = 3;
  repeated GameRule game_rules = 4;
  repeated DataPack data_packs = 5;
  message World { string name = 1; int32 total_entities = 2; repeated Region regions = 3; }
  message Region { int32 total_entities = 1; repeated Chunk chunks = 2; }
  message Chunk { int32 x = 1; int32 z = 2; int32 total_entities = 3; map<string, int32> entity_counts = 4; }
  message GameRule { string name = 1; string default_value = 2; map<string, string> world_values = 3; }
  message DataPack { string name = 1; string description = 2; string source = 3; bool builtin = 4; }
}

message WindowStatistics {
  int32 ticks = 1;
  double cpu_process = 2;
  double cpu_system = 3;
  double tps = 4;
  double mspt_median = 5;
  double mspt_max = 6;
  int32 players = 7;
  int32 entities = 8;
  int32 tile_entities = 9;
  int32 chunks = 10;
  int64 start_time = 11;
  int64 end_time = 12;
  int32 duration = 13;
}

message RollingAverageValues {
  double mean = 1; double max = 2; double min = 3; double median = 4; double percentile95 = 5;
}

message CommandSenderMetadata {
  Type type = 1; string name = 2; string unique_id = 3;
  enum Type { OTHER = 0; PLAYER = 1; }
}

message PluginOrModMetadata {
  string name = 1; string version = 2; string author = 3; string description = 4; bool builtin = 5;
}

message HealthData {
  HealthMetadata metadata = 1;
  map<int32, WindowStatistics> time_window_statistics = 2;
}

message HealthMetadata {
  CommandSenderMetadata creator = 1;
  PlatformMetadata platform_metadata = 2;
  PlatformStatistics platform_statistics = 3;
  SystemStatistics system_statistics = 4;
  int64 generated_time = 5;
  map<string, string> server_configurations = 6;
  map<string, PluginOrModMetadata> sources = 7;
  map<string, string> extra_platform_metadata = 8;
}

/* ---------- sampler (spark_sampler.proto) ---------- */

message SamplerData {
  SamplerMetadata metadata = 1;
  repeated ThreadNode threads = 2;
  map<string, string> class_sources = 3;
  map<string, string> method_sources = 4;
  map<string, string> line_sources = 5;
  repeated int32 time_windows = 6;
  map<int32, WindowStatistics> time_window_statistics = 7;
  SocketChannelInfo channel_info = 8;
}

message SamplerMetadata {
  CommandSenderMetadata creator = 1;
  int64 start_time = 2;
  int32 interval = 3;
  ThreadDumper thread_dumper = 4;
  DataAggregator data_aggregator = 5;
  string comment = 6;
  PlatformMetadata platform_metadata = 7;
  PlatformStatistics platform_statistics = 8;
  SystemStatistics system_statistics = 9;
  map<string, string> server_configurations = 10;
  int64 end_time = 11;
  int32 number_of_ticks = 12;
  map<string, PluginOrModMetadata> sources = 13;
  map<string, string> extra_platform_metadata = 14;
  SamplerMode sampler_mode = 15;
  SamplerEngine sampler_engine = 16;
  string sampler_engine_version = 17;
  message ThreadDumper {
    Type type = 1; repeated int64 ids = 2; repeated string patterns = 3;
    enum Type { ALL = 0; SPECIFIC = 1; REGEX = 2; }
  }
  message DataAggregator {
    Type type = 1; ThreadGrouper thread_grouper = 2; int64 tick_length_threshold = 3; int32 number_of_included_ticks = 4;
    enum Type { SIMPLE = 0; TICKED = 1; }
    enum ThreadGrouper { BY_NAME = 0; BY_POOL = 1; AS_ONE = 2; }
  }
  enum SamplerMode { EXECUTION = 0; ALLOCATION = 1; }
  enum SamplerEngine { JAVA = 0; ASYNC = 1; }
}

message ThreadNode {
  string name = 1;
  reserved 2;
  repeated StackTraceNode children = 3;
  repeated double times = 4;
  repeated int32 children_refs = 5;
}

message StackTraceNode {
  reserved 1, 2;
  string class_name = 3;
  string method_name = 4;
  int32 parent_line_number = 5;
  int32 line_number = 6;
  string method_desc = 7;
  repeated double times = 8;
  repeated int32 children_refs = 9;
}

message SocketChannelInfo { string channel_id = 1; bytes public_key = 2; }

/* ---------- heap (spark_heap.proto) ---------- */

message HeapData {
  HeapMetadata metadata = 1;
  repeated HeapEntry entries = 2;
}

message HeapMetadata {
  CommandSenderMetadata creator = 1;
  PlatformMetadata platform_metadata = 2;
  PlatformStatistics platform_statistics = 3;
  SystemStatistics system_statistics = 4;
  int64 generated_time = 5;
  map<string, string> server_configurations = 6;
  map<string, PluginOrModMetadata> sources = 7;
  map<string, string> extra_platform_metadata = 8;
}

message HeapEntry { int32 order = 1; int32 instances = 2; int64 size = 3; string type = 4; }
`;

const SparkData = (() => {
  let root = null;
  let types = {};

  function init() {
    if (root) return;
    if (typeof protobuf === 'undefined') throw new Error('protobuf.js failed to load (check your network / CDN).');
    root = protobuf.parse(SPARK_PROTO, { keepCase: false }).root;
    types = {
      sampler: root.lookupType('spark.SamplerData'),
      heap: root.lookupType('spark.HeapData'),
      health: root.lookupType('spark.HealthData'),
    };
  }

  function parseId(input) {
    if (!input) return null;
    let s = String(input).trim();
    s = s.split('#')[0].split('?')[0];
    s = s.replace(/^https?:\/\//i, '');
    if (s.includes('/')) {
      const parts = s.split('/').filter(Boolean);
      s = parts[parts.length - 1];
    }
    s = s.trim();
    return /^[A-Za-z0-9]+$/.test(s) ? s : null;
  }

  const BYTEBIN = 'https://spark-usercontent.lucko.me/';

  function decodeBuffer(buf, ctypeHint) {
    let bytes = new Uint8Array(buf);
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof pako === 'undefined') throw new Error('pako failed to load (needed to decompress this report).');
      bytes = pako.inflate(bytes);
    }
    const hint = (ctypeHint || '').toLowerCase();
    let hinted = null;
    if (hint.includes('sampler')) hinted = 'sampler';
    else if (hint.includes('heap')) hinted = 'heap';
    else if (hint.includes('health')) hinted = 'health';

    function toObj(kind, msg) {
      return types[kind].toObject(msg, { longs: Number, enums: String, bytes: String, defaults: true, arrays: true, objects: true });
    }

    // 1) Authoritative path: a Content-Type / extension hint is reliable.
    if (hinted) {
      try {
        const obj = toObj(hinted, types[hinted].decode(bytes));
        if (obj && obj.metadata) return { type: hinted, data: obj };
      } catch (e) { /* fall through to heuristic */ }
    }

    // 2) Heuristic path: decode each type and score by semantic validity.
    const validStr = s => typeof s === 'string' && s.length > 0 && s.length < 256 && !/[\x00-\x08\x0e-\x1f]/.test(s);
    function score(kind, obj) {
      let sc = 0;
      const pm = obj && obj.metadata && obj.metadata.platformMetadata;
      if (pm) {
        if (validStr(pm.name)) sc += 2;
        if (validStr(pm.brand)) sc += 2;
        if (pm.minecraftVersion && /^\d+\.\d+/.test(pm.minecraftVersion)) sc += 3;
        if (validStr(pm.version)) sc += 1;
      }
      if (kind === 'sampler' && obj.threads && obj.threads.length && validStr(obj.threads[0].name)) sc += 3;
      if (kind === 'heap' && obj.entries && obj.entries.length && validStr(obj.entries[0].type) && Number(obj.entries[0].size) > 0) sc += 3;
      if (kind === 'health') {
        const tw = obj.timeWindowStatistics; const ks = tw ? Object.keys(tw) : [];
        if (ks.length && ks.some(k => Number(tw[k].ticks) > 0 || Number(tw[k].tps) > 0)) sc += 4;
      }
      return sc;
    }
    const order = [hinted].concat(['sampler', 'heap', 'health'].filter(k => k !== hinted)).filter(Boolean);
    let lastErr, best = null;
    for (const kind of order) {
      try {
        const obj = toObj(kind, types[kind].decode(bytes));
        if (!obj || !obj.metadata) continue;
        const sc = score(kind, obj);
        if (!best || sc > best.sc) best = { kind, obj, sc };
      } catch (e) { lastErr = e; }
    }
    if (!best) throw lastErr || new Error('Could not decode spark data.');
    return { type: best.kind, data: best.obj };
  }

  async function fetchReport(input) {
    init();
    const code = parseId(input);
    if (!code) throw new Error('That does not look like a valid spark link or code.');
    let res;
    try {
      res = await fetch(BYTEBIN + code, { headers: { Accept: '*/*' } });
    } catch (e) {
      throw new Error('Network/CORS error while fetching the report. Check the link, or use file upload.');
    }
    if (res.status === 404) throw new Error('Report not found (404). The code may be wrong or the report expired.');
    if (!res.ok) throw new Error('Server returned HTTP ' + res.status + ' fetching the report.');
    const ctype = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    const out = decodeBuffer(buf, ctype);
    out.code = code;
    return out;
  }

  function decodeFile(arrayBuffer, filename) {
    init();
    const name = (filename || '').toLowerCase();
    let hint = '';
    if (name.endsWith('.sparkprofile')) hint = 'sampler';
    else if (name.endsWith('.sparkheap')) hint = 'heap';
    const out = decodeBuffer(arrayBuffer, hint);
    out.code = null;
    return out;
  }

  return { fetchReport, decodeFile, parseId };
})();
