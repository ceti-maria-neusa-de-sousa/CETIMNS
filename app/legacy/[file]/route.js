import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT_FILES = {
  "index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "supabase.js": { file: "supabase.js", type: "text/javascript; charset=utf-8" },
  "logo-ceti.png": { file: "logo-ceti.png", type: "image/png" },
  "relatorio-logo-escola.pdf": { file: "relatorio-logo-escola.pdf", type: "application/pdf" }
};

export async function GET(_request, { params }) {
  const entry = ROOT_FILES[params.file];
  if (!entry) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(process.cwd(), entry.file);
  const data = await readFile(filePath);

  return new Response(data, {
    headers: {
      "Content-Type": entry.type,
      "Cache-Control": "no-store"
    }
  });
}
