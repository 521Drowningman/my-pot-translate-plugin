# 自定义大模型翻译插件（pot-app）

一个 pot-app（3.x）的**外置翻译插件**，把翻译交给任意自定义大模型 API。一个插件同时支持两种接口格式，在服务设置里下拉切换：

- **OpenAI 兼容格式**（`POST /v1/chat/completions`）：OpenAI 官方、DeepSeek、Kimi（月之暗面）、硅基流动、通义、one-api / new-api 等各类中转站均可
- **Claude 格式**（`POST /v1/messages`）：Anthropic 官方及兼容网关

支持自定义 API 地址 / Key / 模型 / 提示词 / 温度等参数，可选流式输出（打字机效果）。纯 JavaScript 实现，跨平台，无任何依赖。

**想随时切换大模型？** 把插件添加为多个服务实例（每个模型一个），翻译窗口的服务下拉里即点即切，见[多实例](#多实例像切换服务商一样下拉切换模型)。

## 安装

### 方式一：安装插件包

1. 打包得到 `plugin.com.zmw.custom-llm.potext`（见下方[打包](#开发与打包)），或从本仓库的 Releases / Actions 下载；
2. 打开 pot → **偏好设置** → **服务设置** → **添加外部插件** → **安装外部插件**，选择该 `.potext` 文件；
3. 安装后在外部插件列表中选中它，填写配置，然后在翻译窗口的服务列表里启用。

### 方式二：开发时直接部署（免打包，改完即生效）

把 `info.json`、`main.js`、`icon.svg` 三个文件直接放进插件目录即可（`.potext` 解压后就是这三个文件）：

```
%APPDATA%\com.pot-app.desktop\plugins\translate\plugin.com.zmw.custom-llm\
```

> 修改 `main.js` 后重启 pot（或重新触发一次翻译）即可生效，适合调试。

## 配置项说明

配置界面按「连接 / 输出 / 提示词 / 高级」四组展示，**每个字段的标签上都直接标注了默认值**（pot 的插件表单不会在输入框里预填内容，默认值一律"留空即生效"）：

| 分组 | 配置项 | 说明 |
|---|---|---|
| 连接 | 服务商预设 | 选 OpenAI / DeepSeek / Kimi / 硅基流动 / Claude 官方后，**地址与模型自动填好**（手动填写的值优先）；「自定义」为默认，所有字段以手动填写为准。见[服务商预设](#服务商预设选完只需贴-key) |
| 连接 | 接口格式 | `openai`（默认，兼容所有 OpenAI 格式服务）或 `claude`（Anthropic 格式） |
| 连接 | API 地址 | Base URL 或完整端点均可，留空用官方默认。智能补全规则见下 |
| 连接 | API Key | 必填 |
| 连接 | 模型名称 | 必填，如 `gpt-4o-mini`、`deepseek-chat`、`claude-sonnet-4-5` |
| 输出 | 流式输出 | 默认关闭；开启后逐字显示，详见下方[流式输出](#流式输出说明) |
| 输出 | Temperature | 留空默认 0.1 |
| 输出 | 最大输出 Tokens | Claude 接口必填（API 强制），留空默认 4096；OpenAI 格式留空则不发送 |
| 提示词 | 翻译风格 | 预置提示词一键切换，详见下方[翻译风格](#翻译风格) |
| 提示词 | 自定义系统提示词 | 「通用翻译 / 自定义提示词」风格下生效，`\n` 表示换行，留空用内置默认 |
| 提示词 | 用户提示词模板 | 承载原文的模板，默认 `"""\n$text\n"""` |
| 高级 | 额外请求参数 | JSON 对象，原样合并进请求体，如 `{"top_p":0.9}` |

**API 地址智能补全**（以 OpenAI 格式为例，Claude 同理把后半段换成 `/messages`）：

| 你填的地址 | 实际请求 |
|---|---|
| 留空 | `https://api.openai.com/v1/chat/completions`（claude 格式为 `https://api.anthropic.com/v1/messages`） |
| `https://api.deepseek.com` | `https://api.deepseek.com/v1/chat/completions` |
| `https://xxx.com/v1` | `https://xxx.com/v1/chat/completions` |
| `https://xxx.com/v1/chat/completions` | 原样使用 |

## 服务商预设：选完只需贴 Key

pot 的外置插件配置框不会预填输入框内容（这是 pot 表单渲染的机制），所以插件把"默认值"做成了**服务商预设下拉**，效果等同于预填：

- 选择 **OpenAI 官方 / DeepSeek / Kimi / 硅基流动** → API 地址、模型名称自动按官方默认值补齐；
- 选择 **Claude 官方** → 地址、模型自动补齐，接口格式同时切换为 `claude`；
- 你手动填写的地址/模型**永远优先**于预设——想用中转站或别的模型，直接改字段即可；
- 「自定义（默认）」= 不启用预设，一切以手动填写为准。

也就是说：**选预设 → 贴 API Key → 保存**，三步完成配置。内置的默认值包括：`gpt-4o-mini`、`deepseek-chat`、`moonshot-v1-8k`、`deepseek-ai/DeepSeek-V3`、`claude-sonnet-4-5`（预设内容见 `main.js` 的 `PROVIDER_PRESETS`，可直接改代码调整）。

**提示词占位符**：`$text` 原文、`$from` 源语言、`$to` 目标语言、`$detect` 自动检测的源语言。语言以英文名传入（如 `Simplified Chinese`）。配置框是单行的，用 `\n` 表示换行。

## 翻译风格

「翻译风格」下拉内置了多套系统提示词，不用自己编写就能切换译文风格：

| 风格 | 译文取向 |
|---|---|
| 通用翻译（默认） | 忠实、流畅的日常翻译；此时若填了「自定义系统提示词」则优先使用它 |
| 学术论文 | 正式学术语体，术语准确，保留引用、公式、代码 |
| 口语化 | 译成母语者的日常口语表达 |
| 逐字直译 | 尽量保留原文结构与措辞，不做意译 |
| 自定义提示词 | 完全使用「自定义系统提示词」中填写的内容 |

所有风格都支持 `$from`/`$to`/`$detect` 占位符。想微调某套预设：选「自定义提示词」，把预设文本（见 `main.js` 里的 `PROMPT_PRESETS`）粘贴进去修改即可。

## 多实例：像切换服务商一样下拉切换模型

pot 原生支持把同一插件添加多次，**每个实例就是翻译窗口服务下拉里的一个选项**——这是切换大模型最顺手的方式，每个模型只需配置一次，之后在翻译窗口里即点即切：

1. 打开 **偏好设置 → 服务设置 → 添加外部插件**，选「自定义大模型翻译」，列表里会多出一个实例；
2. 点该实例的配置，填入 Key / 模型等，并把**实例名称**改成好认的名字（如「DeepSeek」），下拉里显示的就是这个名字；
3. 再点一次 **添加外部插件** 添加下一个实例（如「Claude」），各填各的配置，互不影响；
4. 打开翻译窗口，目标区下方的服务下拉里即可在「DeepSeek」「Claude」……之间即点即切，无需再进设置。

## 常用服务配置示例

| 服务 | 接口格式 | API 地址 | 模型示例 |
|---|---|---|---|
| OpenAI 官方 | openai | 留空 | `gpt-4o-mini` |
| DeepSeek | openai | `https://api.deepseek.com` | `deepseek-chat` |
| Kimi | openai | `https://api.moonshot.cn` | `moonshot-v1-8k` |
| 硅基流动 | openai | `https://api.siliconflow.cn` | `deepseek-ai/DeepSeek-V3` |
| one-api/new-api 中转 | openai | 中转站地址（通常以 `/v1` 结尾） | 看渠道配置 |
| Claude 官方 | claude | 留空 | `claude-sonnet-4-5` |

## 流式输出说明

- 默认**关闭**：普通请求走 pot 内置的 Rust HTTP，没有浏览器跨域限制，任何服务都稳定可用；
- 开启后走浏览器直连逐段解析 SSE（打字机效果）。部分中转站/国内服务不支持浏览器跨域（CORS），此时插件会**自动回退**为普通请求，不影响出结果。

## 开发与打包

```
├── info.json        # 插件信息 + 配置项（needs）+ 语言映射
├── main.js          # 核心逻辑：双格式请求、流式 SSE、提示词构建
├── icon.svg         # 插件图标
├── build.ps1        # Windows 一键打包脚本
└── test/
    ├── mock-server.mjs   # 本地模拟 OpenAI / Claude 端点（支持流式）
    └── run-test.mjs      # 脱离 pot 的测试驱动（stub pot 的 utils）
```

**测试**（需要 Node 18+，无需安装依赖）：

```bash
node test/run-test.mjs        # 18 个用例：双格式 × 流式/非流式、URL 补全、提示词风格、服务商预设、错误抛出
# 真实 API 冒烟测试（可选）：
LLM_SMOKE=1 LLM_FORMAT=claude LLM_API_KEY=sk-xxx LLM_MODEL=claude-sonnet-4-5 node test/run-test.mjs
```

**打包**（Windows）：

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
# 生成 plugin.com.zmw.custom-llm.potext
```

Linux/macOS 手动打包：把 `info.json`、`main.js`、`icon.svg` 压缩为 zip（文件在压缩包根目录），重命名为 `plugin.com.zmw.custom-llm.potext`。

推送 GitHub 后 Actions 会自动打包上传 artifact；打 `v*` tag 时自动发布到 Release。

## 常见问题

- **提示 401 / 鉴权失败**：检查 API Key 是否填对、是否有前导空格；Claude 官方的 Key 以 `sk-ant-` 开头。
- **提示模型不存在**：确认模型名称与所选服务一致（各服务的模型列表可在其官网查询）。
- **Claude 报 `max_tokens` 相关错误**：Claude 接口强制要求该参数，确认「最大输出 Tokens」不超过所用模型的上限。
- **流式输出没效果**：该服务可能不支持浏览器跨域，插件已自动回退为普通请求，属正常现象。
- **翻译结果被截断**：调大「最大输出 Tokens」。
- **想改翻译风格**：修改「系统提示词」，例如 `你是一个专业的中英互译引擎，译文要符合学术写作规范。\n只输出译文。`
- **DeepSeek 缓存命中率低或为 0**：DeepSeek 是前缀缓存（自动、按 64-token 块、按账号隔离），命中靠"每次请求开头完全一致"。本插件已做针对性优化：默认系统提示词为**纯静态文本**（语言指令放在 user 消息开头），同语言对连续翻译即可命中；Claude 格式也已给 system 加 `cache_control` 显式缓存标记。仍为 0 时请排查：① 是否经中转站且其上游多个 API Key 轮询（缓存按上游账号隔离，插件无法解决）；② 翻译正文很短时命中块占比本来就小；③ 自定义提示词里用了 `$from/$to/$detect` 占位符会让前缀随请求变化。

## 插件机制说明

pot 3.x 的外置插件是 JavaScript 插件：`.potext` 本质是 zip 包，内含 `info.json`（声明 id、配置项、语言映射）、`main.js`（实现 `async function translate(text, from, to, options)`）和图标。pot 的 webview 加载执行，配置由 pot 按实例保存并在调用时通过 `options.config` 注入。开发文档参见官方模板仓库 [pot-app-translate-plugin-template](https://github.com/pot-app/pot-app-translate-plugin-template)。
