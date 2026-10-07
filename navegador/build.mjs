// Gera navegador/dist: a página + scripts + motor ONNX + modelo Whisper em partes,
// pronto para publicar como artefato (arquivos de no máximo 14 MB).
//   cd navegador && npm install --ignore-scripts && npm run build
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, "dist");
const CACHE = path.join(HERE, ".cache");
const PART_SIZE = 14_000_000;
const MODEL_PKG = "sts-whisper-base@1.0.0"; // Xenova/whisper-base (Apache-2.0) empacotado no npm
const MODEL = "whisper-base";

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "ort"), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

// 1. Scripts (app + worker), reaproveitando a lógica de src/lib do projeto principal
const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  alias: { "onnxruntime-web/webgpu": "onnxruntime-web/wasm", "@": path.join(HERE, "../src") },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};
await esbuild.build({ ...common, entryPoints: [path.join(HERE, "src/worker.ts")], outfile: path.join(DIST, "worker.js") });
await esbuild.build({ ...common, entryPoints: [path.join(HERE, "src/app.ts")], outfile: path.join(DIST, "app.js") });

// 2. Motor ONNX Runtime (WebAssembly, CPU)
const ortDist = path.join(HERE, "node_modules/onnxruntime-web/dist");
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  fs.copyFileSync(path.join(ortDist, f), path.join(DIST, "ort", f));
}

// 3. Modelo Whisper, dividido em partes
const tgzDir = path.join(CACHE, "model");
if (!fs.existsSync(path.join(tgzDir, "package"))) {
  fs.mkdirSync(tgzDir, { recursive: true });
  const name = execFileSync("npm", ["pack", MODEL_PKG, "--silent"], { cwd: tgzDir, encoding: "utf8" }).trim().split("\n").pop();
  execFileSync("tar", ["-xzf", name], { cwd: tgzDir });
}
const src = path.join(tgzDir, "package/models/Xenova", MODEL);
const manifest = { model: MODEL, files: {} };
const copyTree = (from, rel) => {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const abs = path.join(from, entry.name);
    const relPath = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) {
      copyTree(abs, relPath);
      continue;
    }
    if (entry.name.endsWith(".onnx") && !entry.name.includes("_quantized")) continue; // só a versão q8
    const out = path.join(DIST, relPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const size = fs.statSync(abs).size;
    if (size > PART_SIZE) {
      const buf = fs.readFileSync(abs);
      const parts = Math.ceil(size / PART_SIZE);
      for (let i = 0; i < parts; i++) fs.writeFileSync(`${out}.part${i}`, buf.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
      manifest.files[relPath] = { parts, size };
    } else {
      fs.copyFileSync(abs, out);
    }
  }
};
copyTree(src, `models/${MODEL}`);
fs.writeFileSync(path.join(DIST, "models/manifest.json"), JSON.stringify(manifest));

// 4. Detecção de rosto (face-api, MIT): biblioteca + modelo TinyFaceDetector
const fa = path.join(HERE, "node_modules/@vladmandic/face-api");
fs.copyFileSync(path.join(fa, "dist/face-api.esm.js"), path.join(DIST, "face-api.esm.js"));
fs.mkdirSync(path.join(DIST, "face"), { recursive: true });
for (const f of ["tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model.bin"]) {
  fs.copyFileSync(path.join(fa, "model", f), path.join(DIST, "face", f));
}

// 5. Página
fs.copyFileSync(path.join(HERE, "src/index.html"), path.join(DIST, "index.html"));

const list = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else list.push([path.relative(DIST, p), fs.statSync(p).size]);
  }
};
walk(DIST);
const big = list.filter(([, s]) => s > 15 * 1024 * 1024);
if (big.length) throw new Error(`Arquivos acima de 15 MB: ${big.map(([f]) => f).join(", ")}`);
console.log(`dist pronto: ${list.length} arquivos, ${(list.reduce((a, [, s]) => a + s, 0) / 1e6).toFixed(1)} MB`);
