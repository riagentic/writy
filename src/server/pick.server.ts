// The native dialogs behind prefs.pick. Server only.
import { pickDirectory, pickFile } from "aio/server";
import type { Pick } from "../cell/prefs.ts";
import { MIME } from "./files.server.ts";

const DOCS = ["html", "htm", "dj", "djot", "md", "markdown", "txt", "docx", "odt", "doc", "rtf", "pdf"];
const SHEETS = ["xlsx", "xlsm", "xls", "ods", "fods", "csv", "tsv"];

const home = () => Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");

export function pick(kind: Pick, startIn?: string): Promise<string | null> {
  switch (kind) {
    case "open":
      return pickFile({
        title: "Open document",
        startIn,
        filters: [
          { name: "All documents and spreadsheets", extensions: [...DOCS, ...SHEETS] },
          { name: "Documents", extensions: DOCS },
          { name: "Spreadsheets", extensions: SHEETS },
          { name: "All files", extensions: ["*"] },
        ],
      });
    case "picture":
    case "video": {
      const exts = Object.keys(MIME).filter((e) => MIME[e].startsWith(kind === "picture" ? "image/" : "video/"));
      const name = kind === "picture" ? "Pictures" : "Videos";
      return pickFile({ title: `Insert ${kind}`, startIn, filters: [{ name, extensions: exts }, { name: "All files", extensions: ["*"] }] });
    }
    case "any":
      return pickFile({ title: "Attach file", startIn });
    case "folder":
      return pickDirectory({ title: "Save in folder", startIn: startIn ?? home() });
  }
}
