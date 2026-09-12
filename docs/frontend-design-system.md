# Boss Helper 前端设计系统

本文件是侧边栏前端的实现约束。视觉基线以 Chrome 原生 Side Panel 为目标：安静、紧凑、任务导向；品牌青色只表达主操作、选中和运行状态。

## 单一事实来源

- `src/assets/design-tokens.css`：颜色、间距、字号、圆角、阴影、动效和布局常量，并映射 Nuxt UI 的 `--ui-*` 变量。
- `src/assets/main.css`：页面结构与组件语义类，只消费 token，不重新定义颜色常量。
- Vue 组件：负责内容、状态和可访问语义。不得用长串 utility class 临时修补布局。
- `wxt.config.ts`：只保留跨页面且不会改变组件语义的 Nuxt UI 默认值；表单横竖布局必须由所在页面决定。

## 组件规则

### 设置区块

一个功能组使用一个 `.settings-section`。不要在区块内再嵌套同等级卡片；次级关系用分隔线、留白和标题层级表达。

### 筛选规则行

统一使用 `.filter-rule`：宽容器为“名称与启用状态 + 控件”单行结构，窄容器在 `30rem` 以下自动变为两行。交互控件不得放进另一个控件的 `label` 插槽。

### 表单与范围控件

输入容器必须具备 `min-width: 0`，并在所在容器内占满可用宽度。范围输入使用 `.range-control`；地址配置使用 `.address-*`；模型配置使用 `.model-form-*`。不要新增 `max-w-*`、固定 `grid-cols-*` 或百分比位移来修复侧边栏溢出。

### 色彩与状态

组件只引用 `--bh-color-*` 语义 token。成功、警告、错误分别使用 success、warning、danger；普通信息和装饰不得滥用品牌色。新增原始十六进制、rgb 或命名颜色前，必须先判断是否应扩充 token。

### 动效

动效只用于视图切换、状态变化和操作反馈，并消费 `--bh-duration-*` 与 `--bh-ease-*`。必须保留 `prefers-reduced-motion` 降级。

## 验收门禁

每次前端改动至少运行：

```bash
npm run check
npm run lint
npm run fmt:check
npm run test:contracts
npm run build:chrome
```

布局改动还必须在真实 Chrome Side Panel 中检查窄、中、宽三档，至少覆盖岗位工作台、自动化设置、AI 设置，以及展开后的复杂筛选项。构建成功不等于真实界面验收通过。
