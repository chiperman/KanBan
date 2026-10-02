# 01 — 恢复手工来源资产类别的页面入口

Status: needs-triage
Type: task
Priority: P2
Review date: 2026-10-02

## 问题与证据

`CONTEXT.md` 约定手工来源可设置资产类别，但工作台迁移后，`src/ui/asset-source-detail.tsx` 没有该设置入口；`/asset-sources/[id]/settings` 仅接受 EVM 来源。持仓页的“资产类别”是查询筛选，不是来源设置。

服务端仍保留 `PATCH /api/asset-sources/[id]` 的 `manual-asset-class` 操作、持久化字段与估值归类。原浏览器测试还在点击已移除的“管理 A股”弹窗，不能用删除旧断言掩盖产品缺口。

## 最小方案与验收

- 在手工来源详情复用现有 Vibe 控件提供类别设置，不复活旧来源管理弹窗。
- 覆盖待分类、证券、加密资产、现金与其他投资资产，刷新后保留选择。
- 更改类别不改变来源金额、本金、历史汇率或估值完整性；不开放自动来源类别修改。
- 验证权限、键盘与窄屏交互，先按 DESIGN.md 核对固定上游。

## 评论

- 2026-10-02：本轮仅迁移回归和删除无生产引用的旧实现，没有实现新设置入口。保留分类接口浏览器测试，并增加 `src/domain/manual-asset-records.test.ts` 的分布守恒断言；两者不代表页面入口已恢复。
