// Benchmark: run one core variant in a Web Worker (as in the app).
self.onmessage = async (e) => {
  const { url, halfSteps, runs } = e.data;
  try {
    const mod = await (await import(url)).default();
    const out = [];
    for (let i = 0; i < runs; i++) {
      out.push(JSON.parse(mod.UTF8ToString(mod._bench_run(halfSteps))));
      self.postMessage({ progress: i + 1 });
    }
    self.postMessage({ runs: out });
  } catch (err) {
    self.postMessage({ error: String(err?.stack ?? err) });
  }
};
