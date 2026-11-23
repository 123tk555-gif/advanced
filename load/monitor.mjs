// 試験中の API のメモリとイベントループの遅れを 5 秒ごとに記録する(node --import で読み込む)
import { appendFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";

const file = process.env.MONITOR_FILE;
if (file) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let cpu = process.cpuUsage();
  let at = Date.now();
  setInterval(() => {
    const used = process.cpuUsage(cpu);
    const elapsed = Date.now() - at;
    cpu = process.cpuUsage();
    at = Date.now();
    const { rss, heapUsed } = process.memoryUsage();
    const row = {
      at,
      rssMb: Math.round(rss / 1048576),
      heapMb: Math.round(heapUsed / 1048576),
      cpuPct: Math.round(((used.user + used.system) / 1000 / elapsed) * 100),
      loopP99Ms: Math.round(delay.percentile(99) / 1e6),
    };
    appendFileSync(file, `${JSON.stringify(row)}\n`);
    delay.reset();
  }, 5000).unref();
}

// PROFILE_FILE があれば、起動 PROFILE_DELAY_MS 後から PROFILE_MS の間、CPU の使い道を記録する
const profileFile = process.env.PROFILE_FILE;
if (profileFile) {
  const { Session } = await import("node:inspector/promises");
  const { writeFileSync } = await import("node:fs");
  const session = new Session();
  session.connect();
  setTimeout(
    async () => {
      await session.post("Profiler.enable");
      await session.post("Profiler.start");
      setTimeout(
        async () => {
          const { profile } = await session.post("Profiler.stop");
          writeFileSync(profileFile, JSON.stringify(profile));
        },
        Number(process.env.PROFILE_MS ?? 30000),
      ).unref();
    },
    Number(process.env.PROFILE_DELAY_MS ?? 60000),
  ).unref();
}
