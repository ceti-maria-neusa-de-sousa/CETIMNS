import { PDFDocument, rgb } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";

const source = "C:/Users/dougl/Downloads/relatorio.pdf";
const schoolLogo = new URL("../logo-ceti.png", import.meta.url);
const output = new URL("../relatorio-logo-escola.pdf", import.meta.url);

const document = await PDFDocument.load(await readFile(source));
const logo = await document.embedPng(await readFile(schoolLogo));
const page = document.getPage(0);

// The original right-side emblem occupies this exact header area. Cover only
// that mark, then draw the school logo at the same footprint.
page.drawRectangle({ x: 19.5, y: 762.5, width: 62, height: 60, color: rgb(1, 1, 1) });
page.drawImage(logo, { x: 20.4, y: 763.2, width: 60, height: 60 });

await writeFile(output, await document.save());
