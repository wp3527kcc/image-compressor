<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:shell-and-package-rules -->
# Shell & Package Manager Rules

- 使用node命令之前必须先通过 use20 切换node版本
- 包管理统一使用 `pnpm`，禁止使用 `npm` / `yarn`（如安装：`pnpm add xxx`，开发依赖：`pnpm add -D xxx`）。
- 每次做完改动同步更新README.md
- 关键代码段添加注释
- 处理所有碰到的ts报错问题
- SQL操作不允许使用delete操作 统一采用标识符过滤
<!-- END:shell-and-package-rules -->
