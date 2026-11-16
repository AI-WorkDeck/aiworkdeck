# B13b real case (table cells, 2026-11-15 real-app run)

`付款计划.docx`, three versions from the isolated desktop's version repository, unchanged bytes:

- `base.docx`: merge base (no tracked changes).
- `main.docx`: mainline. Paragraph 1 is a pending change (两→三), and cell A1 a pending insertion「（已核）」.
- `other.docx`: draft. Cell A2 is a pending change (10→15).

The backend plan combines main's paragraph 1 and the adjacent cell A1 into one chunk, `MODIFY [1,3) texts=[p1, t0.0.0]`. The worker's paragraph-shift arithmetic counted texts against paragraphs only, decided a paragraph had been added, and failed alignment (「两边的段落对不上」). Fictional test content.
