#!/usr/bin/env python3
"""
관세청조회코드 xlsx「국가코드」시트 → src/constants/customsCountryCodes.ts 생성.

사용 예:
  python3 scripts/generate-customs-country-codes.py \\
    --xlsx "/Users/benkim/Downloads/관세청조회코드_v1.2 (2).xlsx"
"""

from __future__ import annotations

import argparse
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def col_row(cell_ref: str) -> tuple[int, int]:
    m = re.match(r"^([A-Z]+)(\d+)$", cell_ref)
    if not m:
        raise ValueError(cell_ref)
    letters, row_s = m.groups()
    col = 0
    for c in letters:
        col = col * 26 + (ord(c) - 64)
    return int(row_s), col


def load_shared_strings(z: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    out: list[str] = []
    for si in root.findall("m:si", ns):
        texts: list[str] = []
        for t in si.findall(".//m:t", ns):
            if t.text:
                texts.append(t.text)
        out.append("".join(texts))
    return out


def sheet_path_for_name(z: zipfile.ZipFile, sheet_name: str) -> str:
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    nsr = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
    id_to_target = {
        rel.get("Id"): rel.get("Target")
        for rel in rels.findall("r:Relationship", nsr)
    }
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    ns = {
        "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    for sh in wb.findall(".//m:sheet", ns):
        if sh.get("name") == sheet_name:
            rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            tgt = id_to_target.get(rid or "", "")
            return "xl/" + tgt.lstrip("/")
    raise SystemExit(f"시트 '{sheet_name}' 를 workbook 에서 찾지 못했습니다.")


def read_country_rows(z: zipfile.ZipFile, ss: list[str]) -> list[dict[str, str]]:
    path = sheet_path_for_name(z, "국가코드")
    root = ET.fromstring(z.read(path))
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: dict[int, dict[int, str]] = {}
    for c in root.findall(".//m:sheetData/m:row/m:c", ns):
        ref = c.get("r")
        if not ref:
            continue
        row, col = col_row(ref)
        if row < 5:
            continue
        v = c.find("m:v", ns)
        if v is None or v.text is None:
            val = ""
        elif c.get("t") == "s":
            val = ss[int(v.text)]
        else:
            val = v.text
        rows.setdefault(row, {})[col] = val.strip()

    out: list[dict[str, str]] = []
    for r in sorted(rows.keys()):
        d = rows[r]
        if 1 not in d:
            continue
        code = d[1].upper()
        if len(code) != 2:
            continue
        name = d.get(2, "")
        out.append({"id": code, "name": name})
    return out


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--xlsx",
        required=True,
        type=Path,
        help="관세청조회코드 xlsx 경로 (시트명 '국가코드'가 sheet3인 v1.2 기준)",
    )
    p.add_argument(
        "-o",
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent
        / "src"
        / "constants"
        / "customsCountryCodes.ts",
    )
    args = p.parse_args()

    xlsx = args.xlsx.expanduser().resolve()
    if not xlsx.is_file():
        raise SystemExit(f"파일 없음: {xlsx}")

    with zipfile.ZipFile(xlsx) as z:
        ss = load_shared_strings(z)
        countries = read_country_rows(z, ss)

    lines = [
        "/**",
        " * 국가코드(cntyCd) — `관세청조회코드` 엑셀 시트「국가코드」4행 헤더·5행부터 데이터 기준으로 생성.",
        " * `python3 scripts/generate-customs-country-codes.py --xlsx <경로>` 로 재생성하세요.",
        " */",
        "",
        'export type CustomsCountryId = (typeof CUSTOMS_COUNTRY_OPTIONS)[number]["id"];',
        "",
        "export const CUSTOMS_COUNTRY_OPTIONS = [",
    ]
    for o in countries:
        lines.append(f"  {{ id: '{esc(o['id'])}', name: '{esc(o['name'])}' }},")
    lines.append("] as const;")
    lines.append("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(countries)} countries → {args.out}")


if __name__ == "__main__":
    main()
