// Baixa as fontes das legendas (Google Fonts, licença OFL) para worker/fonts.
// Funciona em Windows, Mac e Linux (substitui o download.sh).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worker/fonts");
const GF = "https://raw.githubusercontent.com/google/fonts/main/ofl";
const MS = "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf";
const FONTS = {
  "Anton-Regular.ttf": `${GF}/anton/Anton-Regular.ttf`,
  "BebasNeue-Regular.ttf": `${GF}/bebasneue/BebasNeue-Regular.ttf`,
  "Poppins-Medium.ttf": `${GF}/poppins/Poppins-Medium.ttf`,
  "Poppins-Bold.ttf": `${GF}/poppins/Poppins-Bold.ttf`,
  "Montserrat-SemiBold.ttf": `${MS}/Montserrat-SemiBold.ttf`,
  "Montserrat-ExtraBold.ttf": `${MS}/Montserrat-ExtraBold.ttf`,
  "Inter-Variable.ttf": `${GF}/inter/Inter%5Bopsz,wght%5D.ttf`,
};

fs.mkdirSync(DIR, { recursive: true });
for (const [name, url] of Object.entries(FONTS)) {
  const out = path.join(DIR, name);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`  fonte baixada: ${name}`);
  } catch (e) {
    console.log(`  aviso: não foi possível baixar ${name} (${e.message}); será usada uma fonte parecida`);
  }
}
