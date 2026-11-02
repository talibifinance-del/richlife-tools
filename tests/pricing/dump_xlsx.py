#!/usr/bin/env python3
"""Dumps every cell of a workbook to JSON. --cached adds the stored values next to the formulas."""
import json, sys, openpyxl
path, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(path)
form = {ws.title: {c.coordinate: (c.value.text if hasattr(c.value, 'text') else c.value) for row in ws.iter_rows() for c in row if c.value is not None} for ws in wb.worksheets}
if '--cached' in sys.argv:
    wv = openpyxl.load_workbook(path, data_only=True)
    cached = {ws.title: {k: ws[k].value for k in form[ws.title]} for ws in wv.worksheets}
    json.dump({'formulas': form, 'cached': cached}, open(out, 'w'), ensure_ascii=False, default=str)
else:
    json.dump(form, open(out, 'w'), ensure_ascii=False, default=str)
