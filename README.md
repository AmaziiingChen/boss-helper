> [!CAUTION]
> 本项目仅供学习交流，禁止用于商业用途
>
> 使用该脚本有一定风险(如黑号,封号,权重降低等)，本项目不承担任何责任

| Chrome                                                                                                                                                                                             | Crx搜搜                                                                                                                                           | Edge                                                                                                                                                                                                                                                                                                                           | FireFox                                                                                                                                   | Github                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ogkmgjbagackkdlcibcailacnncgonbn?label=Chrome插件商店)](https://chrome.google.com/webstore/detail/ogkmgjbagackkdlcibcailacnncgonbn) | [![Crx 搜搜](https://img.shields.io/badge/Crx搜索-v%3F.%3F.%3F-EF7C3D)](https://www.crxsoso.com/webstore/detail/ogkmgjbagackkdlcibcailacnncgonbn) | [![Edge Web Store](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjcllnbjfeamhihjpfjlclhdnjmggbgal&query=version&prefix=v&label=Edge插件商店&color=EF7C3D)](https://microsoftedge.microsoft.com/addons/detail/jcllnbjfeamhihjpfjlclhdnjmggbgal) | [![Firefox](https://img.shields.io/amo/v/boss-helper?label=Mozilla插件商店)](https://addons.mozilla.org/zh-TW/firefox/addon/boss-helper/) | [![GitHub Release](https://img.shields.io/github/v/release/Ocyss/boss-helper)](https://github.com/Ocyss/boss-helper/releases/latest/) |

> **国内**: 如果无法访问 `Chrome插件商店` , 请使用 `Crx搜搜` 或 `Edge插件商店` 安装

## 项目介绍

Boss直聘助手, 皆在减少投递简历的麻烦, 和提高投递简历的效率, 技术栈使用WXT + Vue3 + NuxtUI@4 + TailwindCSS@4, 开源在 Github 欢迎前来Pr

前端样式、组件布局与真实侧边栏验收规则见 [前端设计系统](docs/frontend-design-system.md)。

> 本项目处于积极维护状态, 一直很忙所以拖了比较久才开源，抱歉了~

### 简历匹配与飞书同步

在“AI 配置”中粘贴或选择 Markdown 简历，并配置 AI 筛选模型。模型返回决策、总体理由、匹配点、缺口风险和待核实项；自动投递关闭时不发送，开启后只发送 `APPLY`，也可单独允许发送 `REVIEW`，`REJECT` 永不发送。

启用飞书多维表格同步前，请在飞书开放平台为应用开通 `bitable:app` 多维表格读写权限并发布应用版本。只读权限无法满足新增、更新记录的需要。随后创建以下字段，并确保应用对目标多维表格具有访问权限：

| 字段名                                                      | 推荐类型                                           |
| ----------------------------------------------------------- | -------------------------------------------------- |
| BOSS 岗位 ID                                                | 单行文本（upsert 主键）                            |
| 岗位名称                                                    | 超链接（`{ text, link }`）                         |
| 公司名称                                                    | 单行文本                                           |
| 公司链接                                                    | 超链接或兼容 URL 字段                              |
| 薪资                                                        | 单行文本                                           |
| 薪资下限（月）、薪资上限（月）                              | 数字（仅可解析月薪时写入，单位为元）               |
| 实习周期、城市、区县、商圈、详细地址、招聘者、岗位状态      | 单行文本或兼容单选字段                             |
| 学历要求、经验要求、公司规模、公司行业、融资阶段、AI 决策   | 文本或单选（选项须覆盖插件写入值）                 |
| 职位技能、岗位标签                                          | 多选或可接收字符串数组的字段                       |
| 完整 JD、AI 判断理由、AI 匹配点、AI 缺口与风险、AI 待核实项 | 多行文本                                           |
| 求职进度                                                    | 单选或文本；仅首次创建写入“待处理”，随后由用户维护 |
| 同步时间                                                    | 日期时间（Unix 毫秒）                              |

不会写入“岗位更新时间”“招聘者活跃度”“是否已投递”等字段：招聘者活跃不是岗位更新时间，且同步与实际 BOSS 请求是相互独立的状态。

扩展按 `BOSS 岗位 ID` 新增或更新记录。简历文件本身不会上传；浏览器只在匹配时将简历文本发送给已配置的
AI 模型。

## 相关链接

唯一交流群:
微信麻烦, 飞书人数限制, 所以只开tg一个~

<img alt="交流群" src="./docs/img/tg.png" height="200" />

Github开源地址: <https://github.com/ocyss/boss-helper>

飞书反馈问卷(匿名): <https://gai06vrtbc0.feishu.cn/share/base/form/shrcnmEq2fxH9hM44hqEnoeaj8g>

> 每个提交都会给我发通知，我看见就会评论的形式回复 一般 1-2天

飞书问卷结果: <https://gai06vrtbc0.feishu.cn/share/base/view/shrcnrg8D0cbLQc89d7Jj7AZgMc>

greasyfork地址(0.2旧版本): <https://greasyfork.org/zh-CN/scripts/491340>

## 项目预览

[![卡片状态](docs/img/shot_2024-04-14_23-08-03.png)](docs/img/shot_2024-04-14_23-08-03.png)
[![账户配置](docs/img/shot_2024-04-14_23-09-05.png)](docs/img/shot_2024-04-14_23-09-05.png)
[![统计界面](docs/img/shot_2024-04-02_22-25-25.png)](docs/img/shot_2024-04-02_22-25-25.png)
[![配置界面](docs/img/shot_2024-04-02_22-26-54.png)](docs/img/shot_2024-04-02_22-26-54.png)
[![日志界面](docs/img/shot_2024-04-02_22-32-25.png)](docs/img/shot_2024-04-02_22-32-25.png)

## TODO

- [x] 优化UI去除广告
- [x] 批量投递简历
- 高级筛选
  - [x] 薪资,公司名,工作名,人数,内容简单筛选
  - 公司地址相关
    > 使用高德api，需要自行申请，或者使用关键字筛选, 暂时只有驾车和步行
    - [x] 驾车/步行距离
    - [x] 驾车/步行时间
  - [ ] 公司风险评控
  - [x] AI筛选
- AI 简历匹配与多模型管理
- 额外功能(有时间会写)
  - [x] 自适应UI适配手机
  - [ ] 黑名单
  - [x] 多账号管理 (废弃, 改为多配置切换)

## 参与贡献

1. Fork 本仓库并克隆到本地。
2. 在新分支上进行您的更改：`git checkout -b 您的分支名称`
3. 提交更改：`git commit -am '描述您的更改'`
4. 推送更改到您的 Fork：`git push origin 您的分支名称`
5. 提交 Pull 请求。

## 鸣谢

- <https://github.com/yangfeng20/boss_batch_push>
- <https://github.com/lisonge/vite-plugin-monkey>
- <https://github.com/chatanywhere/GPT_API_free>

- <https://uiverse.io/>
- <https://www.runoob.com/manual/mqtt/protocol/MQTT-3.1.1-CN.pdf>

## 类似项目

- <https://github.com/Frrrrrrrrank/auto_job__find__chatgpt__rpa>
- <https://github.com/noBaldAaa/find-job>

## 最后

嗯...

## Star 趋势

<a href="https://star-history.dera.page/#ocyss/boss-helper&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=ocyss/boss-helper&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=ocyss/boss-helper&type=Date" />
   <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=ocyss/boss-helper&type=Date" />
 </picture>
</a>
