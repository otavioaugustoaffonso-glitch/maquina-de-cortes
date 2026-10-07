import type { Metadata } from "next";
import { Anton, Bebas_Neue, Inter, Montserrat, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Fontes das legendas (o preview no navegador usa as mesmas do vídeo final)
const montserrat = Montserrat({ subsets: ["latin"], weight: ["600", "800"], variable: "--font-montserrat" });
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-poppins" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton" });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas" });

export const metadata: Metadata = {
  title: { default: "Máquina de Cortes", template: "%s · Máquina de Cortes" },
  description: "Transforme vídeos longos em cortes curtos prontos para TikTok, Reels e Shorts com IA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${montserrat.variable} ${poppins.variable} ${anton.variable} ${bebas.variable}`}>
      <body className="min-h-dvh bg-bg">{children}</body>
    </html>
  );
}
