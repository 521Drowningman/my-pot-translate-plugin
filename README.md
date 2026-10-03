# 自定义大模型翻译插件（pot-app）

一个 pot-app（3.x）的**外置翻译插件**，把翻译交给任意自定义大模型 API。一个插件同时支持两种接口格式，在服务设置里下拉切换：

- **OpenAI 兼容格式**（`POST /v1/chat/completions`）：OpenAI 官方、DeepSeek、Kimi（月之暗面）、硅基流动、通义、one-api / new-api 等各类中转站均可
- **Claude 格式**（`POST /v1/messages`）：Anthropic 官方及兼容网关

支持自定义 API 地址 / Key / 模型 / 提示词 / 温度等参数，可选流式输出（打字机效果）。纯 JavaScript 实现，跨平台，无任何依赖。

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

| 配置项 | 说明 |
|---|---|
| 当前档案 | 填档案名称的全部或片段（如 `cl` 匹配 `claude`）；留空使用下方基础配置 |
| 档案列表 | JSON 数组，一次写入多套模型预设（见[多模型档案](#多模型档案一次配置随时切换)）；留空则读插件目录下的 `profiles.json` |
| 失败自动切换档案 | 开启后当前档案请求失败时按列表顺序换下一个重试（默认关闭） |
| 接口格式 | `openai`（默认，兼容所有 OpenAI 格式服务）或 `claude`（Anthropic 格式） |
| API 地址 | Base URL 或完整端点均可，留空用官方默认。智能补全规则见下 |
| API Key | 必填 |
| 模型名称 | 必填，如 `gpt-4o-mini`、`deepseek-chat`、`claude-sonnet-4-5` |
| 流式输出 | 默认关闭；开启后逐字显示，详见下方[流式输出](#流式输出说明) |
| Temperature | 留空默认 0.1 |
| 最大输出 Tokens | Claude 接口必填（API 强制），留空默认 4096；OpenAI 格式留空则不发送 |
| 系统提示词 | 自定义翻译风格，支持占位符，留空用内置默认 |
| 用户提示词 | 承载原文的模板，默认 `"""\n$text\n"""` |
| 额外请求参数 | JSON 对象，原样合并进请求体，如 `{"top_p":0.9}` |

**API 地址智能补全**（以 OpenAI 格式为例，Claude 同理把后半段换成 `/messages`）：

| 你填的地址 | 实际请求 |
|---|---|
| 留空 | `https://api.openai.com/v1/chat/completions`（claude 格式为 `https://api.anthropic.com/v1/messages`） |
| `https://api.deepseek.com` | `https://api.deepseek.com/v1/chat/completions` |
| `https://xxx.com/v1` | `https://xxx.com/v1/chat/completions` |
| `https://xxx.com/v1/chat/completions` | 原样使用 |

**提示词占位符**：`$text` 原文、`$from` 源语言、`$to` 目标语言、`$detect` 自动检测的源语言。语言以英文名传入（如 `Simplified Chinese`）。配置框是单行的，用 `\n` 表示换行。

## 多模型档案：一次配置，随时切换

把常用的多套模型配置（不同厂商、不同 Key、不同模型，甚至不同提示词风格）写成一个 JSON 数组，粘贴到「档案列表」里。之后切换模型只需打开服务设置，把「当前档案」改成对应名称即可，不用再逐项修改：

```json
[
  { "name": "deepseek", "apiFormat": "openai", "requestPath": "https://api.deepseek.com", "apiKey": "sk-xxx", "model": "deepseek-chat" },
  { "name": "claude", "apiFormat": "claude", "apiKey": "sk-ant-xxx", "model": "claude-sonnet-4-5", "maxTokens": "8192" },
  { "name": "学术润色", "systemPrompt": "你是学术论文润色引擎，译文需符合学术写作规范。\\n只输出润色后的文本。" }
]
```

- `name` 必填，其余字段（`apiFormat`、`requestPath`、`apiKey`、`model`、`temperature`、`maxTokens`、`systemPrompt`、`userPrompt`、`extraJson`）都可以只写需要覆盖的部分，没写的沿用服务设置里的基础配置
- 「当前档案」留空 = 直接使用基础配置（即界面上填的那些字段），此时档案功能完全不介入
- 「当前档案」支持片段匹配（忽略大小写）；找不到或匹配到多个档案时，报错会列出所有可用档案名
- 档案太长不方便贴在配置框？把 JSON 数组保存为 `profiles.json` 放进插件目录（`%APPDATA%\com.pot-app.desktop\plugins\translate\plugin.com.zmw.custom-llm\`），「档案列表」留空即自动读取
- 「失败自动切换档案」开启后，当前档案请求失败（限流、额度用完、网络错误等）会按列表顺序自动换下一个重试，全部失败才报错，并附上每个档案的失败原因

## 多实例

pot 支持把同一插件添加多次：**服务设置 → 添加外部插件**里重复添加本插件，每个实例独立保存一套配置。例如可以同时添加「DeepSeek 快速翻译」「Claude 高质量翻译」两个服务，在翻译窗口里按需切换。

多实例和档案二选一即可：**多实例**切换最快（加好后在翻译窗口直接下拉选服务，不用进设置），但服务列表会多几项；**档案**让服务列表保持干净、多套预设共享同一份基础配置，切换时需要打开服务设置改一个字段。

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
node test/run-test.mjs        # 19 个用例：双格式 × 流式/非流式、URL 补全、多模型档案、错误抛出
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

## 插件机制说明

pot 3.x 的外置插件是 JavaScript 插件：`.potext` 本质是 zip 包，内含 `info.json`（声明 id、配置项、语言映射）、`main.js`（实现 `async function translate(text, from, to, options)`）和图标。pot 的 webview 加载执行，配置由 pot 按实例保存并在调用时通过 `options.config` 注入。开发文档参见官方模板仓库 [pot-app-translate-plugin-template](https://github.com/pot-app/pot-app-translate-plugin-template)。
