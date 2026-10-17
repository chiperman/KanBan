# 依赖公告处置记录

> 历史记录：本文件仅反映 2026-09-19 的依赖与审计现场。2026-10-18 从 `docs/operations/` 归入历史审查区，未重新审计；下文的“当前”不代表今天的安全状态。现行文档入口见 [维护规则](../README.md)。

2026-09-19，macOS arm64。仅更新 Next 与受影响传递依赖，无 override。

| 官方公告 | 原锁定版本 | 修复版本 | 暴露面核对 |
|---|---|---|---|
| [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) | Next 16.2.11 | 16.3.3 | Windows 文件系统路径；本机 macOS 不符合 Windows 条件 |
| [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | Next 16.2.11 | 16.3.3 | 图像优化 AVIF；未使用 next/image，不把此项等同于关闭框架入口 |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | Sharp 0.34.5 | 0.35.0 | 非可信 GIF/TIFF/VIPS；经 Next 上游升级 |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | Sharp 0.34.5 | 0.35.4 | 特定 glibc Linux/libheif 条件；不声称 macOS 已被利用 |
| [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | PostCSS 8.4.31 | 8.5.12 | 非可信 CSS sourceMappingURL 文件读取 |
| [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | PostCSS 8.4.31 | 8.5.18 | 非可信 CSS source map 路径遍历 |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | PostCSS 8.4.31 | 8.5.10 | 内联非可信 CSS 闭合 style 引发 XSS |
| [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | PostCSS 8.4.31 | 8.5.23 | 前述 source map 修复的无 from 绕过 |
| [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | nanoid 3.3.16 | 3.3.18 | customAlphabet/customRandom size=0；业务未调用 |

最终锁定：Next 16.3.3、Sharp 0.35.4、PostCSS 8.5.23、nanoid 3.3.19。应用未发现处理非可信 CSS 的入口；所有公告仍通过升级处置，无需依赖“不可达”豁免。构建平台证据仅覆盖本机 macOS，不宣称其他平台已验收。

验证：生产依赖审计从 2 critical / 5 high / 2 moderate 降至 0；冻结安装通过；隔离生产构建通过；HTTPS 注册/登录/退出通过；资产业务 14 项、菜单与挑战 5 项通过。零公告是当前审计快照，不是长期安全保证。原始日志位于外部临时证据目录，未提交日志、凭证、数据库或构建产物。
