/**
 * Reads a CSV or XLSX file into a plain grid of strings.
 *
 * No dependency: an .xlsx is a ZIP of XML parts, and Node already ships
 * both the inflate (`node:zlib`) and everything else needed. Adding a
 * spreadsheet library to import one referential file would pull a large,
 * historically CVE-prone parser into the bundle for a format we only need
 * to read, never to write.
 *
 * Server-side only — see lib/server/catalogue.ts. Values come back as
 * strings exactly as stored; interpreting them is the mapping layer's job.
 */

import { inflateRawSync } from "node:zlib";

export type Sheet = {
  headers: string[];
  rows: string[][];
};

export class SpreadsheetError extends Error {}

// ---------------------------------------------------------------- CSV

/**
 * Excel on a French locale writes `;`, most exports write `,`. Guessing
 * from the header line rather than asking: a wrong guess is immediately
 * obvious in the mapping screen, where the admin sees the parsed columns.
 */
export function detectDelimiter(firstLine: string): string {
  const candidates = [";", ",", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    // Count only outside quotes, so a name like "DOLIPRANE 500, 1000" in a
    // comma file doesn't make `,` look like the winner in a `;` file.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (!inQuotes && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180: quoted fields may contain the delimiter, newlines, and `""`. */
export function parseCsv(text: string, delimiter?: string): Sheet {
  const clean = text.replace(/^﻿/, "");
  const firstLineEnd = clean.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd);
  const sep = delimiter ?? detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // A file not ending in a newline still has a last row to flush; one that
  // does must not gain a phantom empty row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return toSheet(rows.map((cells) => cells.map((cell) => cell.trim())));
}

// --------------------------------------------------------------- XLSX

type ZipEntry = { name: string; body: Buffer };

function readZip(buffer: Buffer): Map<string, Buffer> {
  const EOCD_SIGNATURE = 0x06054b50;
  let eocd = -1;
  // The end-of-central-directory record sits at the very end, unless the
  // archive carries a comment — scan back over the maximum comment length.
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new SpreadsheetError("Fichier illisible : ce n'est pas un classeur Excel (.xlsx) valide.");
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) {
    throw new SpreadsheetError("Classeur trop volumineux (format ZIP64 non pris en charge).");
  }

  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    // The local header repeats the name/extra lengths, and they can differ
    // from the central directory's — the data offset must come from there.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) entries.push({ name, body: raw });
    else if (method === 8) entries.push({ name, body: inflateRawSync(raw) });
    // Any other method (bzip2, lzma) is not something Excel writes.

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return new Map(entries.map((entry) => [entry.name, entry.body]));
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

/** Strips tags and decodes entities — `<t>` runs of a rich-text cell concatenate. */
function textContent(xml: string): string {
  return decodeXml(xml.replace(/<[^>]*>/g, ""));
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textContent(match[1]!));
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseWorksheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    const rowXml = rowMatch[1]!;

    for (const cellMatch of rowXml.matchAll(/<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1]!;
      const body = cellMatch[3] ?? "";
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /t="(\w+)"/.exec(attributes)?.[1];

      let value: string;
      if (type === "inlineStr") {
        value = textContent(body);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = type === "s" && raw !== "" ? (shared[Number(raw)] ?? "") : decodeXml(raw);
      }

      // Empty cells are omitted from the XML entirely, so a cell's column
      // has to come from its reference, not from its position in the row.
      const target = reference ? columnIndex(reference) : cells.length;
      while (cells.length < target) cells.push("");
      cells[target] = value.trim();
    }

    rows.push(cells);
  }

  return rows;
}

export function parseXlsx(buffer: Buffer): Sheet {
  const files = readZip(buffer);
  const shared = readSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8"));

  // Only the first worksheet. A referential export is one sheet; asking
  // which one to use would be a question with a single possible answer.
  const sheetName = [...files.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
  if (!sheetName) {
    throw new SpreadsheetError("Classeur vide : aucune feuille de calcul trouvée.");
  }

  return toSheet(parseWorksheet(files.get(sheetName)!.toString("utf8"), shared));
}

// ------------------------------------------------------------- Commun

function toSheet(grid: string[][]): Sheet {
  // Leading blank lines happen when an export starts with a title row that
  // was later cleared; the first row with content is the header.
  const firstFilled = grid.findIndex((row) => row.some((cell) => cell !== ""));
  if (firstFilled === -1) {
    throw new SpreadsheetError("Fichier vide : aucune ligne exploitable.");
  }

  const headers = grid[firstFilled]!.map((header) => header.trim());
  const rows = grid
    .slice(firstFilled + 1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      // Pad short rows so a mapping onto column 11 never reads undefined.
      const padded = [...row];
      while (padded.length < headers.length) padded.push("");
      return padded;
    });

  return { headers, rows };
}

export function parseSpreadsheet(fileName: string, buffer: Buffer): Sheet {
  if (/\.xlsx$/i.test(fileName)) return parseXlsx(buffer);
  if (/\.(csv|txt|tsv)$/i.test(fileName)) return parseCsv(buffer.toString("utf8"));
  if (/\.xls$/i.test(fileName)) {
    throw new SpreadsheetError(
      "Format .xls (Excel 97-2003) non pris en charge — réenregistrez le fichier en .xlsx ou .csv.",
    );
  }
  throw new SpreadsheetError("Format non reconnu — utilisez un fichier .xlsx ou .csv.");
}
