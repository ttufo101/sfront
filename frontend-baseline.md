---
name: frontend-baseline
description: 公司前端技术栈与工程基线。当新建或修改前端项目、判断技术选型、目录/依赖边界、Feature 隔离、UI 组件和接口封装时加载。团队标准栈是 React 18 + TypeScript + Vite + shadcn/ui 2.x + Tailwind CSS 3.4。
---

# 前端技术栈与工程基线

> 本文件是团队前端技术栈、目录职责、Feature 隔离、依赖方向和客户端边界的唯一事实源。项目规则只补充本项目特有选型，不重复团队标准。

## 一、团队标准技术栈

- UI 应用使用 **React 18 + TypeScript + Vite + shadcn/ui 2.x + Tailwind CSS 3.4**。
- React 使用 `createRoot`；不得生成 React 19 专属 API 或把 Next.js、Vue、Create React App 当作默认脚手架。
- Vite 是团队标准构建工具；具体 Vite 小版本和包管理器跟随项目锁文件与现有配置，不在本 Rule 中臆造。
- shadcn/ui 2.x 指组件初始化与生成方式遵循 2.x；生成后的组件代码归项目所有，默认放在 `src/components/ui/`。优先组合、扩展现有 shadcn/ui 组件，不再引入一套平行 UI 组件库。
- Tailwind 固定为 3.4 配置模型，使用项目的 `tailwind.config.*`、PostCSS 和语义化 CSS 变量；不得混用 Tailwind 4 的 CSS-first 配置、`@theme` 或仅适用于 v4 的写法。
- 路由、服务端状态、客户端状态、表单、图标、测试框架和包管理器未被本 Rule 固定：已有项目沿用现状，新项目只按已确认需求引入最小依赖。

### 栈内实现约束

- React 新代码使用函数组件和 Hooks；不得生成仅适用于 React Server Components/Next.js 的 `use client`、Server Action 或文件路由约定。既有 Class Component 只做本次必要维护，不顺手全量改写。
- 浏览器端环境变量通过 Vite 的 `import.meta.env` 读取；暴露给客户端的变量遵循 `VITE_` 前缀，并在 `src/config/` 集中解析、校验和导出。不得在组件中散落读取，也不得把密钥放进客户端环境变量。
- `components.json`、TypeScript alias、Tailwind content 路径和项目目录必须一致；生成 shadcn/ui 组件前先检查现有配置，不能用重新初始化覆盖项目定制。
- 多个条件类名使用项目统一的 `cn` 工具合并；组件变体沿用 shadcn/ui 的既有模式，不用字符串拼接另造一套变体协议。
- Tailwind 响应式遵循移动优先；重复出现且具有设计语义的视觉值应沉淀到本次指定设计规则目录的 Token 和 Tailwind 配置，不用 arbitrary value 长期替代设计 Token。
- TypeScript 业务数据类型来自已确认契约或明确的 ViewModel；不得用 `any`、重复手写不一致的接口类型或把后端原始响应直接扩散到展示组件。

### 新项目与既有项目

- **新建前端项目**必须采用上述标准栈，不得把其它框架或主要版本作为隐含默认值。
- **既有项目已符合标准栈**时，沿用其锁定版本、目录和封装，不为追逐最新小版本主动升级。
- **既有项目不符合标准栈**时，不得在普通需求中静默迁移。先列出当前栈、与团队标准的差异、迁移影响和本次需求能否在现状上安全完成；技术栈迁移必须由用户明确授权并作为独立范围处理。
- Project Rules 只有在记录已批准的历史兼容、迁移计划或本项目额外选型时才能偏离本节，并必须写明依据；不能用项目规则无说明地覆盖团队标准。

## 二、目录职责（React/TS 前端）

```
src/
├── app/                    # 应用入口、Provider、Router、路由页面、顶层错误边界
├── features/               # 按业务域隔离的实现
│   └── <feature>/
│       ├── api/            # 类型化函数与 Query/Mutation hooks
│       ├── components/     # 仅供当前业务域使用的组件
│       ├── hooks/          # 当前业务域 hooks（可选）
│       ├── stores/         # 当前业务域客户端状态（可选）
│       └── types/          # 当前业务域类型（可选）
├── components/
│   ├── ui/                 # 无业务语义的复用 UI
│   ├── layouts/            # 跨路由布局
│   └── errors/             # 公共错误展示
├── config/                 # 环境变量、路径、运行配置
├── hooks/                  # 跨业务复用 hooks
├── lib/                    # 跨业务基础设施；XRPC 受影响时含 transport
├── testing/                # 测试初始化、Mock 与测试工具（不进入生产依赖）
├── types/                  # 跨业务共享类型
└── utils/                  # 无业务状态的纯工具
```

## 三、依赖方向（本文件为团队唯一事实源）

**允许方向：**
```text
app → features → components | hooks | lib | types | utils | config
app ───────────────────────→ components | hooks | lib | types | utils | config
```

**禁止方向：**
- `features/<a>` 导入 `features/<b>`；`features` 导入 `app`。
- `components`/`hooks`/`lib`/`types`/`utils`/`config` 导入 `features` 或 `app`。
- 公共 UI 导入具体业务类型、业务 Query 或业务 Store。
- 页面/组件直接创建 HTTP/XRPC transport、拼 Gateway URL 或手写信封。
- 生产代码导入 `testing`，或以 `features/shared` 规避 Feature 所有权。

**跨 Feature 协作顺序**：① app 层组合 → ② 真正无业务归属能力下沉公共层 → ③ 若实为同一业务边界则调整 Feature 所有权并在设计中说明。

## 四、Feature 公开入口

- Feature 可按规模提供 `index.ts` 公开入口；外部消费者通过它访问组件/Hooks/类型。
- endpoint 常量、Store 实现和私有组件**不应泄漏**；app 按设计组合 Feature 暴露的模块，Feature 之间仍禁止直接导入。

## 五、命名与实现约束

- TS/TSX 文件与普通目录用 `kebab-case`；TypeScript 开启 `strict`；`@/` 映射到 `src/`。
- 样式优先使用 Tailwind 工具类和本次指定设计规则目录中定义的语义 Token；不得在业务组件中散落无法追溯的颜色、间距、圆角和阴影魔法值。
- shadcn/ui 公共组件保持无业务语义；业务组合进入对应 Feature。修改生成组件时保留可升级性，并说明偏离上游组件的必要原因。
- 页面/组件**不直接调用** `fetch`、Axios 或底层 XRPC client；网络调用归属 Feature API 或公共 transport。
- Loading/Empty/Error/Success/权限拒绝在最接近业务语义的 Feature 或路由边界处理。

## 六、实现范围

- **新项目**：从上述目录职责开始，只建当前需求需要的目录和文件，不复制样板业务、资源、Mock 数据或演示页面。
- **既有项目**：先记录当前目录、依赖和边界规则，再做最小修改；发现跨 Feature 耦合先报告影响，不顺手重构无关代码。
