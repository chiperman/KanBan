# 安全问题报告

请不要在公开 Issue、PR 或讨论中发布凭证、个人资产数据、Keychain 内容、`.env.local`、数据库文件或可利用细节。

请优先通过 GitHub 仓库的 **Report a vulnerability** 私下报告安全问题。报告应包含：

- 受影响的提交、版本或 workflow；
- 可复现步骤或最小样例；
- 影响范围；
- 已知的临时缓解方式。

本地正式数据和部署凭据不属于公开仓库内容。所有公开 PR 和 `main` 构建只运行 GitHub-hosted Runner；Mac mini 不注册为公开仓库 Runner，只通过维护者主动执行的手动部署入口更新正式副本。
