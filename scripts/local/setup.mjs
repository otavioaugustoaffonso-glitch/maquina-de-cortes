// Instalação local, 100% gratuita: verifica requisitos, instala dependências,
// liga o Supabase local, cria o banco e preenche .env/.env.local automaticamente.
import fs from "node:fs";
import path from "node:path";
import { c, findPython, has, isWin, parseSupabaseStatus, ROOT, runQuiet, runVisible, upsertEnv } from "./common.mjs";

c.title("Máquina de Cortes — instalação");

// 1. Requisitos
c.title("1/5 Verificando programas necessários");
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  c.fail(`Node.js ${process.versions.node} é antigo. Instale o Node.js 22: https://nodejs.org`);
  process.exit(1);
}
c.ok(`Node.js ${process.versions.node}`);

const missing = [];
if (has("ffmpeg", ["-version"])) c.ok("ffmpeg");
else missing.push("ffmpeg — https://ffmpeg.org/download.html (Windows: winget install ffmpeg | Mac: brew install ffmpeg)");

const python = findPython();
if (python) c.ok(`Python 3 (${python.cmd})`);
else missing.push("Python 3 — https://www.python.org/downloads (no Windows marque 'Add Python to PATH')");

if (has("docker", ["info"])) c.ok("Docker em execução");
else missing.push("Docker Desktop aberto — https://www.docker.com/products/docker-desktop (instale, abra e espere ficar pronto)");

if (missing.length) {
  c.fail("Faltam programas. Instale e rode o instalador de novo:");
  for (const m of missing) console.log(`   - ${m}`);
  process.exit(1);
}

// 2. Dependências
c.title("2/5 Instalando dependências do site (pode levar alguns minutos)");
if (!runVisible("npm", ["install", "--no-audit", "--no-fund"])) {
  c.fail("Falha no npm install.");
  process.exit(1);
}
c.title("3/5 Instalando dependências de vídeo e transcrição (Python, ambiente isolado em .venv)");
const venvDir = path.join(ROOT, ".venv");
const venvPython = isWin ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
if (!fs.existsSync(venvPython) && !runVisible(python.cmd, [...python.extra, "-m", "venv", venvDir])) {
  c.fail("Não foi possível criar o ambiente Python (.venv). No Linux, instale o pacote python3-venv.");
  process.exit(1);
}
if (!runVisible(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]) || !runVisible(venvPython, ["-m", "pip", "install", "-r", "worker/requirements.txt"])) {
  c.fail("Falha ao instalar as dependências Python.");
  process.exit(1);
}
runVisible("node", ["scripts/local/download-fonts.mjs"]);

// 3. Supabase local
c.title("4/5 Ligando o Supabase local (na primeira vez baixa as imagens do Docker — vários minutos)");
if (!runVisible("npx", ["--yes", "supabase", "start"])) {
  c.fail("Não foi possível iniciar o Supabase. Confirme que o Docker Desktop está aberto e tente de novo.");
  process.exit(1);
}
c.info("Criando as tabelas e regras de acesso...");
if (!runVisible("npx", ["--yes", "supabase", "db", "reset"])) {
  c.fail("Falha ao criar o banco (supabase db reset).");
  process.exit(1);
}

// 4. .env automáticos
c.title("5/5 Configurando as variáveis de ambiente");
const status = runQuiet("npx", ["--yes", "supabase", "status", "-o", "env"]);
const sb = status ? parseSupabaseStatus(status) : {};
if (!sb.url || !sb.anonKey || !sb.serviceKey) {
  c.fail("Não consegui ler as chaves do Supabase. Rode `npx supabase status` e copie-as para .env e .env.local manualmente.");
  process.exit(1);
}
const values = {
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey,
  PYTHON_BIN: venvPython,
};
// Usa o Ollama automaticamente se ele estiver instalado com um modelo adequado
const ollama = runQuiet("ollama", ["list"]);
const model = ollama?.match(/^(qwen2\.5:[\w.]+|llama3\.[\w.]*:[\w.]+)/m)?.[1];
if (model) {
  values.ANALYSIS_PROVIDER = "ollama";
  values.LLM_MODEL = model;
  c.ok(`Ollama encontrado: a IA local (${model}) vai escolher os cortes`);
} else {
  c.info("Ollama não encontrado: a escolha dos cortes usará regras (veja COMO-USAR.md para ativar a IA local).");
}
upsertEnv(path.join(ROOT, ".env"), values);
upsertEnv(path.join(ROOT, ".env.local"), values);
c.ok(".env e .env.local configurados");

c.title("Pronto! Para usar, rode o arquivo 'iniciar' (iniciar.bat no Windows, iniciar.sh no Mac/Linux).");
