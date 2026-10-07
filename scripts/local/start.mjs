// Liga tudo: Supabase local + site + worker. Ctrl+C desliga o site e o worker.
import fs from "node:fs";
import path from "node:path";
import { c, isWin, ROOT, runVisible, startProcess } from "./common.mjs";

if (!fs.existsSync(path.join(ROOT, ".env")) || !fs.existsSync(path.join(ROOT, "node_modules"))) {
  c.fail("Rode primeiro o instalador (instalar.bat no Windows, instalar.sh no Mac/Linux).");
  process.exit(1);
}

c.title("Máquina de Cortes — iniciando");
c.info("Ligando o Supabase local (confirme que o Docker Desktop está aberto)...");
if (!runVisible("npx", ["--yes", "supabase", "start"])) {
  c.fail("Não foi possível iniciar o Supabase. Abra o Docker Desktop e tente de novo.");
  process.exit(1);
}

const web = startProcess("site", "35", "npm", ["run", "dev"]);
const worker = startProcess("worker", "36", "npm", ["run", "worker"]);

let opened = false;
web.stdout.on("data", (d) => {
  if (!opened && /Ready|Local:/.test(d.toString())) {
    opened = true;
    const url = "http://localhost:3000";
    c.ok(`Site no ar: ${url} (deixe esta janela aberta; Ctrl+C para desligar)`);
    const opener = isWin ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    try {
      runVisible(opener[0], opener[1]);
    } catch {
      /* abra manualmente */
    }
  }
});

const stop = () => {
  c.info("Desligando o site e o worker... (o Supabase continua ligado; para desligar: npx supabase stop)");
  web.kill();
  worker.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const [name, child] of [["site", web], ["worker", worker]]) {
  child.on("exit", (code) => {
    if (code) c.fail(`O ${name} parou (código ${code}). Veja as mensagens acima.`);
  });
}
