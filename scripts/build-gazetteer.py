#!/usr/bin/env python3
"""Build the bundled SQLite gazetteer from GeoNames ZIP exports."""

import argparse
from pathlib import Path
import sqlite3
import tempfile
from zipfile import ZipFile


def rows(source, name):
    with ZipFile(source / f"{name}.zip") as archive, archive.open(f"{name}.txt") as file:
        for line in file:
            yield line.decode("utf-8").rstrip("\r\n").split("\t")


def build(source, output):
    places = {}
    for name in ("cities5000", "BY"):
        for fields in rows(source, name):
            if fields[6] == "P" and fields[7] not in {"PPLH", "PPLQ", "PPLW"}:
                id, label, ascii_label = fields[:3]
                lat, lon = map(float, fields[4:6])
                places[id] = (label, ascii_label, lat, lon, fields[8], int(fields[14] or 0))

    languages = ("be", "ru", "en")
    names = {}
    for fields in rows(source, "alternateNamesV2"):
        _, id, lang, label, preferred, short, colloquial, historic, *_ = fields
        if id in places and lang in languages and label and historic != "1" and colloquial != "1":
            names.setdefault(id, {}).setdefault(lang, []).append(
                (preferred != "1", short == "1", label)
            )

    # Replace atomically so a failed rebuild leaves the previous snapshot intact.
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        database = Path(temp) / "gazetteer.sqlite"
        with sqlite3.connect(database) as db:
            db.executescript("""
                CREATE TABLE place (
                    id INTEGER PRIMARY KEY, label TEXT NOT NULL, ascii_label TEXT NOT NULL,
                    lat REAL NOT NULL, lon REAL NOT NULL, country TEXT NOT NULL,
                    population INTEGER NOT NULL, be TEXT, ru TEXT, en TEXT
                );
                CREATE VIRTUAL TABLE place_fts USING fts5(
                    names, content='', tokenize='unicode61 remove_diacritics 2', prefix='2 3'
                );
            """)
            for id in sorted(places, key=int):
                place = places[id]
                translations = names.get(id, {})
                display = [min(translations[lang])[2] if lang in translations else None
                           for lang in languages]
                aliases = dict.fromkeys([place[0], place[1], *(
                    name for entries in translations.values() for _, _, name in entries
                )])
                db.execute("INSERT INTO place VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (id, *place, *display))
                db.execute("INSERT INTO place_fts (rowid, names) VALUES (?, ?)",
                           (id, " ".join(aliases)))
            db.execute("INSERT INTO place_fts (place_fts) VALUES ('optimize')")
            db.commit()
            db.execute("VACUUM")
        database.replace(output)
    print(f"Bundled {len(places):,} populated places in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Directory with BY, cities5000 and alternateNamesV2 ZIP exports")
    parser.add_argument("output", type=Path, nargs="?", default=Path("map-assets/gazetteer.sqlite"))
    args = parser.parse_args()
    build(args.source, args.output)
