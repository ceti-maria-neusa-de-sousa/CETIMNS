import "./globals.css";

export const metadata = {
  title: "CETI Maria Neusa de Sousa",
  description: "Portal institucional do CETI Maria Neusa de Sousa, Francisco Macedo-PI."
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
