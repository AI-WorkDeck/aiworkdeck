# B13 real case (0.86.0 RC regression, release agent)

`合同草稿.docx` from the RC regression project, three versions, unchanged bytes:

- `base.docx`: merge base ("R"). Paragraph 0 is an AI pending insertion (text + paragraph mark, author `AI WorkDeck`).
- `main.docx`: mainline. Paragraph 0: the AI text pending-deleted by `测试甲-管理员` (a delete stacked on the AI insertion) + a pending insertion「表后总结（主稿：按月付款）。」.
- `other.docx`: draft「ClientB」. Same shape, insertion「表后总结（稿B：客户要求按季度付款）。」.

Before B13 the combined draft failed with「段数与共同的上一版对不上（当前 6，按计划应为 5）」. Fictional test content.
