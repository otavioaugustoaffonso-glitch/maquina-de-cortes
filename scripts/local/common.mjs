// Utilitários compartilhados pelos scripts de instalação e inicialização.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const isWin = process.platform === "win32";

export const c = {
  ok: (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`),
  info: (m) => console.log(`\x1b[36m•\x1b[0m ${m}`),
  warn: (m) => console.log(`\x1b[33m!\x1b[0m ${m}`),
  fail: (m) => console.log(`\x1b[31m✖\x1b[0m ${m}`),
  title: (m) => console.log(`\n\x1b[1m${m}\x1b[0m`),
};

/** Executa um comando mostrando a saída; retorna true se deu certo. */
export function runVisible(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: isWin });
  return r.status === 0;
}

/** Executa um comando silenciosamente e devolve a saída (ou null se falhar). */
export function runQuiet(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: isWin });
  return r.status === 0 ? `${r.stdout ?? ""}${r.stderr ?? ""}` : null;
}

export function has(cmd, args = ["--version"]) {
  return runQuiet(cmd, args) !== null;
}

/** Descobre o comando do Python 3 que funciona neste computador. */
export function findPython() {
  const candidates = isWin ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const extra = cmd === "py" ? ["-3"] : [];
    const out = runQuiet(cmd, [...extra, "-c", "import sys; print(sys.version_info[0])"]);
    if (out && out.trim().startsWith("3")) return { cmd, extra };
  }
  return null;
}

/** Lê `supabase status -o env` e devolve URL e chaves (aceita os nomes antigos e novos). */
export function parseSupabaseStatus(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return {
    url: vars.API_URL,
    anonKey: vars.ANON_KEY || vars.PUBLISHABLE_KEY,
    serviceKey: vars.SERVICE_ROLE_KEY || vars.SECRET_KEY,
  };
}

/** Grava/atualiza variáveis num arquivo .env preservando o restante. */
export function upsertEnv(file, values) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(file, text);
}

export function startProcess(name, color, cmd, args) {
  const child = spawn(cmd, args, { cwd: ROOT, shell: isWin, env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(prefix + l);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}
