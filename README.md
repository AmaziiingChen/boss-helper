# BOSS Helper · Jobjob

基于 [Ocyss/boss-helper](https://github.com/Ocyss/boss-helper) 的本地二次开发。上游许可证为 [MIT](LICENSE)，本地分支为 `codex/resume-match-feishu`。

## 当前功能

- 读取 BOSS 列表与完整岗位详情，按当前筛选翻页采集。
- 结合简历和个人资料调用模型，返回匹配判断、理由与缺口。
- 按岗位 ID 在飞书去重入库、更新分析并回读求职进度。
- 生成和编辑招呼语，确认具体岗位与正文后单条发送。

## 技术与配置

WXT、Vue 3、PrimeVue 4 / Aura；模型通过 `API Key + Base URL + Model` 配置。上游 `devlog-ui` 作为子模块位于 `packages/devlog-ui/`。

在扩展“简历”页保存简历并导入根项目导出的 `profile/matching-profile.json`，再配置模型与飞书岗位表。

## 开发

在本目录执行：

```sh
npm run check
npm run test:contracts
npm run build
```

Chrome 加载目录为 `.output/chrome-mv3`。构建与实际加载目录保持一致。

## 联调状态

最近记录：2026-10-05。已完成模型调用、部分飞书真实读写与招呼语生成。接下来继续完整 JD、翻页采集、整条入库流程及浏览器内招呼语编辑保存。

操作细节、阶段状态与联调结果见 [BOSS 主线管线与联调](docs/BOSS主线管线与联调-2026-10-05.md)。
