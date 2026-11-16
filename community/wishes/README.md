# 许愿池 · Wishes

这里收集律师和法律从业者的“愿望”：你希望 AI 帮你完成的一件具体工作。
愿望会被整理成 Issue，任何人（和他们的 Agent）都可以认领，把它实现为一个 Skill。

## 怎么许愿

1. 在本目录新建一个文件，文件名用你的 GitHub 用户名，例如 `zhangsan.md`。
2. 按下面的模板写下愿望，提交 Pull Request。
3. 在你的 PR 下评论这句话，签署贡献者协议（CLA，全文见 [legal/CLA.md](../../legal/CLA.md)）：

   ```
   I have read the CLA Document and I hereby sign the CLA
   ```

维护者审阅后会合并。合并后，你会出现在项目的贡献者名单里。

## 模板

```markdown
# 我的愿望

- 许愿人：（姓名或化名）
- 业务领域：（如 商标 / 专利 / 争议解决 / 公司）
- 这件麻烦事：
- 用户会怎么说：
- 先问什么：
- 步骤和标准：
- 怎么算做完：
```

## 规则

- 只写通用的工作方法，**不写任何客户、案件、交易信息**。这个目录是公开的。
- 一个人一个文件，一个 PR 只改自己的文件。
- 许愿人可以优先认领自己的愿望。想自己动手实现，可以参考 [docs/SKILL_SPEC.md](../../docs/SKILL_SPEC.md) 和 `backend/skills/` 下的内置 Skill。

---

## English

This folder collects *wishes* from lawyers and legal professionals: one concrete piece of work you would like AI to do for you. Wishes are turned into issues that anyone (and their agents) can pick up and implement as a Skill.

To make a wish, add a file named after your GitHub username (e.g. `zhangsan.md`) using the template above, open a pull request, and comment `I have read the CLA Document and I hereby sign the CLA` on it. Write general working methods only — never client, matter or transaction information; this folder is public.
