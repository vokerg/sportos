#!/usr/bin/env python3
"""Small no-dependency XLSX inspector for weird workbook discovery.

It reads workbook/sheet XML directly and prints sheet names plus first rows.
It is intentionally not part of runtime import; the TypeScript importer uses SheetJS.
"""
from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def col_to_idx(col: str) -> int:
    n = 0
    for c in col.upper():
        n = n * 26 + ord(c) - 64
    return n - 1


def shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out: list[str] = []
    for si in root.findall("a:si", NS):
        out.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))
    return out


def sheets(z: zipfile.ZipFile):
    root = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    for sh in root.findall(".//a:sheet", NS):
        rid = sh.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        yield sh.attrib["name"], relmap[rid]


def cell_text(c: ET.Element, shared: list[str]) -> str:
    t = c.attrib.get("t")
    v = c.find("a:v", NS)
    f = c.find("a:f", NS)
    if t == "s" and v is not None:
        return shared[int(v.text or "0")]
    if t == "inlineStr":
        return "".join(tt.text or "" for tt in c.findall(".//a:t", NS))
    if f is not None and v is None:
        return "=" + (f.text or "")
    return "" if v is None else str(v.text or "")


def main(path: str, max_rows: int = 8, max_cols: int = 16) -> None:
    with zipfile.ZipFile(path) as z:
        shared = shared_strings(z)
        for name, target in sheets(z):
            print(f"\n## {name} ({target})")
            root = ET.fromstring(z.read("xl/" + target))
            for row in root.findall(".//a:sheetData/a:row", NS)[:max_rows]:
                cells = [""] * max_cols
                for c in row.findall("a:c", NS):
                    m = re.match(r"([A-Z]+)(\d+)", c.attrib["r"])
                    if not m:
                        continue
                    idx = col_to_idx(m.group(1))
                    if idx < max_cols:
                        cells[idx] = cell_text(c, shared)
                print(row.attrib.get("r"), cells)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: inspect-xlsx-openxml.py workbook.xlsx")
    main(sys.argv[1])
