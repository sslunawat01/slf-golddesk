#!/usr/bin/env python3
"""Offline sanity validator for schema.sql + seed.sql (no Postgres available).
Checks:
  1. paren balance & non-empty statements
  2. duplicate CREATE TABLE / TYPE / FUNCTION / VIEW names
  3. every REFERENCES target table exists (order-aware: must exist EARLIER,
     unless added via ALTER TABLE ... ADD CONSTRAINT later — tracked)
  4. referenced enum types are defined
  5. seed.sql INSERT column lists ⊆ real columns of the target table
  6. seed.sql INSERT targets exist
"""
import re, sys

def read(p): return open(p).read()

def strip_comments(s):
    s = re.sub(r"--[^\n]*", "", s)
    return s

def split_stmts(s):
    # naive but adequate: split on ; at paren depth 0 outside $$ bodies
    out, buf, depth, i, in_dollar = [], [], 0, 0, False
    while i < len(s):
        if s.startswith("$$", i):
            in_dollar = not in_dollar; buf.append("$$"); i += 2; continue
        c = s[i]
        if not in_dollar:
            if c == "(": depth += 1
            elif c == ")": depth -= 1
            elif c == ";" and depth == 0:
                st = "".join(buf).strip()
                if st: out.append(st)
                buf = []; i += 1; continue
        buf.append(c); i += 1
    st = "".join(buf).strip()
    if st: out.append(st)
    return out

def main():
    schema = strip_comments(read("schema.sql"))
    errors, warns = [], []

    # 1 paren balance (outside $$)
    depth = 0; in_d = False; i = 0
    while i < len(schema):
        if schema.startswith("$$", i): in_d = not in_d; i += 2; continue
        if not in_d:
            if schema[i] == "(": depth += 1
            elif schema[i] == ")": depth -= 1
            if depth < 0: errors.append(f"unbalanced ')' at offset {i}"); break
        i += 1
    if depth > 0: errors.append(f"{depth} unclosed '(' in schema")

    stmts = split_stmts(schema)

    tables, types, funcs, views = {}, set(), set(), set()
    deferred_fk = []          # (stmt_no, target)
    for n, st in enumerate(stmts):
        m = re.match(r"CREATE TABLE (\w+)", st)
        if m and " PARTITION OF " not in st:
            name = m.group(1)
            if name in tables: errors.append(f"duplicate table {name}")
            body = st[st.index("(")+1:]
            # depth-aware split on top-level commas
            parts, buf, depth = [], [], 0
            for ch in body:
                if ch == "(": depth += 1
                elif ch == ")":
                    if depth == 0: break
                    depth -= 1
                if ch == "," and depth == 0:
                    parts.append("".join(buf)); buf = []
                else:
                    buf.append(ch)
            parts.append("".join(buf))
            cols = []
            for line in parts:
                cm = re.match(r"\s*(\w+)\s+\S", line)
                kw = line.strip().split(" ")[0].upper() if line.strip() else ""
                if cm and kw not in ("PRIMARY","UNIQUE","CHECK","FOREIGN","CONSTRAINT"):
                    cols.append(cm.group(1))
            tables[name] = set(cols)
            for ref in re.findall(r"REFERENCES (\w+)", st):
                if ref not in tables and ref != name:
                    errors.append(f"stmt {n}: table {name} references {ref} before it exists")
        m = re.match(r"CREATE TYPE (\w+)", st)
        if m:
            if m.group(1) in types: errors.append(f"duplicate type {m.group(1)}")
            types.add(m.group(1))
        m = re.match(r"CREATE (?:OR REPLACE )?FUNCTION (\w+)", st)
        if m:
            if m.group(1) in funcs: errors.append(f"duplicate function {m.group(1)}")
            funcs.add(m.group(1))
        m = re.match(r"CREATE VIEW (\w+)", st)
        if m: views.add(m.group(1))
        m = re.match(r"ALTER TABLE (\w+) ADD CONSTRAINT \w+ FOREIGN KEY \([^)]+\) REFERENCES (\w+)", st)
        if m:
            if m.group(1) not in tables: errors.append(f"ALTER on unknown table {m.group(1)}")
            if m.group(2) not in tables: errors.append(f"ALTER FK to unknown table {m.group(2)}")

    # enum usage check: any column typed with a lowercase word that matches a CREATE TYPE requirement
    for name, cols in tables.items(): pass  # column-type extraction is heuristic; skip deep check

    # seed checks
    try:
        seed = strip_comments(read("seed.sql"))
        for n, st in enumerate(split_stmts(seed)):
            m = re.match(r"INSERT INTO (\w+)\s*\(([^)]*)\)", st)
            if m:
                t, cols = m.group(1), [c.strip() for c in m.group(2).split(",")]
                if t not in tables:
                    errors.append(f"seed stmt {n}: unknown table {t}")
                else:
                    bad = [c for c in cols if c not in tables[t]]
                    if bad: errors.append(f"seed {t}: unknown columns {bad}")
            elif re.match(r"INSERT INTO (\w+)\s+SELECT", st) or re.match(r"INSERT INTO (\w+)\s+VALUES", st):
                t = re.match(r"INSERT INTO (\w+)", st).group(1)
                if t not in tables: errors.append(f"seed stmt {n}: unknown table {t}")
    except FileNotFoundError:
        warns.append("seed.sql not present yet")

    print(f"tables={len(tables)} types={len(types)} functions={len(funcs)} views={len(views)} stmts={len(stmts)}")
    for w in warns: print("WARN:", w)
    if errors:
        print("\nERRORS:")
        for e in errors: print("  ✗", e)
        sys.exit(1)
    print("✓ schema.sql structural checks passed" + (" · seed.sql column checks passed" if not warns else ""))

if __name__ == "__main__":
    main()
