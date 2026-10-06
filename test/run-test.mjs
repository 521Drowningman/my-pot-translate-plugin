// 脱离 pot 直接测试 main.js：stub 掉 pot 注入的 utils（用 Node 内置 fetch 模拟 tauriFetch），
// 启动本地 mock 服务器，覆盖 OpenAI / Claude 两种格式 × 流式 / 非流式、URL 智能补全、错误抛出。
//
// 用法：
//   node test/run-test.mjs
// 真实 API 冒烟测试（可选）：
//   LLM_SMOKE=1 LLM_FORMAT=openai LLM_BASE_URL=https://api.deepseek.com \
//   LLM_API_KEY=sk-xxx LLM_MODEL=deepseek-chat node test/run-test.mjs
//
// 需要 Node 18+（内置 fetch）。
import { readFile } from 'node:fs/promises';
import { startMockServer } from './mock-server.mjs';

const script = await readFile(new URL('../main.js', import.meta.url), 'utf8');
// pot 通过 eval 加载 main.js 并取走全局 translate 函数，这里等价复现
const pluginApi = new Function(`${script}\nreturn { translate, applyProviderPreset };`)();
const translate = pluginApi.translate;
const applyProviderPreset = pluginApi.applyProviderPreset;

// —— pot utils 的最小实现 ——
const Body = { json: (obj) => obj };
const tauriFetch = async (url, opts = {}) => {
    const res = await fetch(url, {
        method: opts.method || 'GET',
        headers: opts.headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) data = await res.json();
    else data = await res.text();
    return { ok: res.ok, status: res.status, data };
};
const utils = { http: { fetch: tauriFetch, Body } };

const TEXT = 'Hello, world!';
const EXPECTED = 'Hello, world! (translated)';

function opts(config, setResult = () => {}) {
    return { config, detect: 'en', setResult, utils };
}

async function expectThrow(fn, keyword, label) {
    try {
        await fn();
    } catch (e) {
        const msg = typeof e === 'string' ? e : e.message || String(e);
        if (!msg.includes(keyword)) {
            throw new Error(`${label}: 抛错内容未包含「${keyword}」，实际为：${msg}`);
        }
        return;
    }
    throw new Error(`${label}: 期望抛出包含「${keyword}」的错误，但没有抛错`);
}

const cases = [
    [
        'openai 非流式：只填域名，自动补全 /v1/chat/completions',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({ apiFormat: 'openai', requestPath: base, apiKey: 'test-key', model: 'gpt-4o-mini' })
            );
            if (r !== EXPECTED) throw new Error(`翻译结果不符：${r}`);
        },
    ],
    [
        'openai 非流式：以 /v1 结尾只补 /chat/completions',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/v1',
                    apiKey: 'test-key',
                    model: 'gpt-4o-mini',
                })
            );
            if (r !== EXPECTED) throw new Error(`翻译结果不符：${r}`);
        },
    ],
    [
        'openai 非流式：完整端点原样使用 + temperature/maxTokens/extraJson',
        async () => {
            const r = await translate(
                TEXT,
                'auto',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/v1/chat/completions',
                    apiKey: 'test-key',
                    model: 'gpt-4o-mini',
                    temperature: '0.3',
                    maxTokens: '2048',
                    extraJson: '{"top_p":0.9}',
                })
            );
            if (r !== EXPECTED) throw new Error(`翻译结果不符：${r}`);
        },
    ],
    [
        'claude 非流式：只填域名，自动补全 /v1/messages',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({ apiFormat: 'claude', requestPath: base, apiKey: 'test-key', model: 'claude-sonnet-4-5' })
            );
            if (r !== EXPECTED) throw new Error(`翻译结果不符：${r}`);
        },
    ],
    [
        'openai 流式：setResult 增量回调，最终返回完整译文',
        async () => {
            const parts = [];
            const r = await translate(
                TEXT,
                'auto',
                'Simplified Chinese',
                opts({ apiFormat: 'openai', requestPath: base, apiKey: 'test-key', model: 'gpt-4o-mini', stream: 'true' }, (v) =>
                    parts.push(v)
                )
            );
            if (r !== EXPECTED) throw new Error(`最终结果不符：${r}`);
            if (parts.length < 2) throw new Error(`setResult 调用次数不足：${parts.length}`);
            if (parts[parts.length - 1] !== EXPECTED) throw new Error(`最后一次 setResult 不是完整结果`);
        },
    ],
    [
        'claude 流式：setResult 增量回调，最终返回完整译文',
        async () => {
            const parts = [];
            const r = await translate(
                TEXT,
                'auto',
                'Simplified Chinese',
                opts({ apiFormat: 'claude', requestPath: base, apiKey: 'test-key', model: 'claude-sonnet-4-5', stream: 'true' }, (v) =>
                    parts.push(v)
                )
            );
            if (r !== EXPECTED) throw new Error(`最终结果不符：${r}`);
            if (parts.length < 2) throw new Error(`setResult 调用次数不足：${parts.length}`);
            if (parts[parts.length - 1] !== EXPECTED) throw new Error(`最后一次 setResult 不是完整结果`);
        },
    ],
    [
        'openai 鉴权失败：抛出 401 错误',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({ apiFormat: 'openai', requestPath: base, apiKey: 'wrong-key', model: 'gpt-4o-mini' })
                    ),
                '401',
                'openai 401'
            );
        },
    ],
    [
        'claude 鉴权失败：抛出 401 错误',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({ apiFormat: 'claude', requestPath: base, apiKey: 'wrong-key', model: 'claude-sonnet-4-5' })
                    ),
                '401',
                'claude 401'
            );
        },
    ],
    [
        '缺 API Key：给出中文提示',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({ apiFormat: 'openai', requestPath: base, model: 'gpt-4o-mini' })
                    ),
                'API Key',
                '缺 API Key'
            );
        },
    ],
    [
        'extraJson 非法：抛出 JSON 错误提示',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({ apiFormat: 'openai', requestPath: base, apiKey: 'test-key', model: 'gpt-4o-mini', extraJson: '{bad json' })
                    ),
                'JSON',
                'extraJson 非法'
            );
        },
    ],
    [
        '请求地址为空：回退官方默认端点（离线抛网络错误 / 在线抛 401，均属预期）',
        async () => {
            let threw = false;
            try {
                await translate(
                    TEXT,
                    'English',
                    'Simplified Chinese',
                    opts({ apiFormat: 'openai', requestPath: '', apiKey: 'test-key', model: 'gpt-4o-mini' })
                );
            } catch (e) {
                threw = true;
            }
            if (!threw) throw new Error('空地址未走官方默认端点或请求未发出');
        },
    ],
    [
        '提示词风格：默认使用内置通用提示词',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({ apiFormat: 'openai', requestPath: base + '/whoami', apiKey: 'test-key', model: 'm' })
            );
            if (!r.includes('faithful')) throw new Error(`未使用内置通用提示词：${r}`);
        },
    ],
    [
        '提示词风格：学术/口语/直译预设生效',
        async () => {
            const mk = (promptStyle) =>
                translate(
                    TEXT,
                    'English',
                    'Simplified Chinese',
                    opts({
                        apiFormat: 'openai',
                        requestPath: base + '/whoami',
                        apiKey: 'test-key',
                        model: 'm',
                        promptStyle,
                    })
                );
            if (!(await mk('academic')).includes('academic')) throw new Error('学术风格未生效');
            if (!(await mk('colloquial')).includes('spoken')) throw new Error('口语风格未生效');
            if (!(await mk('literal')).includes('literal')) throw new Error('直译风格未生效');
        },
    ],
    [
        '提示词风格：自定义提示词生效（\\n 转义展开）',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/whoami',
                    apiKey: 'test-key',
                    model: 'm',
                    promptStyle: 'custom',
                    systemPrompt: 'LINEONE\\nLINETWO',
                })
            );
            if (!r.includes('LINEONE\nLINETWO')) throw new Error(`自定义提示词未生效：${r}`);
        },
    ],
    [
        '提示词风格：旧配置兼容（未选风格但已填提示词）',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/whoami',
                    apiKey: 'test-key',
                    model: 'm',
                    systemPrompt: 'OLD-SYS-PROMPT-MARKER',
                })
            );
            if (!r.includes('OLD-SYS-PROMPT-MARKER')) throw new Error(`旧配置自定义提示词未生效：${r}`);
        },
    ],
    [
        '服务商预设：deepseek 自动填模型，手填优先',
        async () => {
            const mk = (model) =>
                translate(
                    TEXT,
                    'English',
                    'Simplified Chinese',
                    opts({
                        apiFormat: 'openai',
                        requestPath: base + '/whoami',
                        apiKey: 'test-key',
                        model,
                        providerPreset: 'deepseek',
                    })
                );
            if (!(await mk('')).includes('model=deepseek-chat')) throw new Error('预设模型未自动填入');
            if (!(await mk('my-model')).includes('model=my-model')) throw new Error('手填模型未优先');
        },
    ],
    [
        '服务商预设：claude 官方同时切换接口格式与模型',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    requestPath: base + '/whoami',
                    apiKey: 'test-key',
                    providerPreset: 'claude',
                })
            );
            if (!r.includes('format=claude')) throw new Error(`接口格式未切换：${r}`);
            if (!r.includes('model=claude-sonnet-4-5')) throw new Error(`预设模型未填入：${r}`);
        },
    ],
    [
        '服务商预设：纯函数行为（不覆盖已填字段 / 自定义与未知值不动）',
        async () => {
            const filled = applyProviderPreset({ providerPreset: 'deepseek', requestPath: '', model: 'mine' });
            if (filled.requestPath !== 'https://api.deepseek.com') throw new Error('空地址未被预设填充');
            if (filled.model !== 'mine') throw new Error('手填模型被覆盖');
            const untouched = applyProviderPreset({ providerPreset: 'unknown', requestPath: '', model: '' });
            if (untouched.requestPath !== '' || untouched.model !== '') throw new Error('未知预设不应改动字段');
            const empty = applyProviderPreset({ requestPath: '', model: '' });
            if (empty.requestPath !== '' || empty.model !== '') throw new Error('无预设不应改动字段');
        },
    ],
    [
        '缓存优化：默认系统提示词为静态，跨语言对完全一致',
        async () => {
            const mk = (fromLang) =>
                translate(
                    TEXT,
                    fromLang,
                    'Simplified Chinese',
                    opts({ apiFormat: 'openai', requestPath: base + '/whoami', apiKey: 'test-key', model: 'm' })
                );
            const r1 = await mk('auto');
            const r2 = await mk('Japanese');
            if (!r1.includes('faithful')) throw new Error(`缺少默认提示词：${r1}`);
            if (r1 !== r2) throw new Error(`系统提示词随语言对变化，前缀缓存会被打断：\n${r1}\n${r2}`);
        },
    ],
    [
        '缓存优化：claude 格式 system 携带 cache_control 显式缓存标记',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({ apiFormat: 'claude', requestPath: base + '/whoami', apiKey: 'test-key', model: 'm' })
            );
            if (!r.includes('cc=yes')) throw new Error(`system 未加 cache_control：${r}`);
        },
    ],
];

const serverRef = await startMockServer(8787);
const base = 'http://127.0.0.1:8787';

let failed = 0;
for (const [name, fn] of cases) {
    try {
        await fn();
        console.log(`  PASS  ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL  ${name}\n        ${e.message || e}`);
    }
}

// —— 真实 API 冒烟测试（可选，通过环境变量开启）——
if (process.env.LLM_SMOKE === '1') {
    const cfg = {
        apiFormat: process.env.LLM_FORMAT || 'openai',
        requestPath: process.env.LLM_BASE_URL || '',
        apiKey: process.env.LLM_API_KEY || '',
        model: process.env.LLM_MODEL || '',
    };
    try {
        const r = await translate('The quick brown fox jumps over the lazy dog.', 'English', 'Simplified Chinese', opts(cfg));
        console.log(`  PASS  真实 API 冒烟测试 (${cfg.apiFormat} / ${cfg.model})\n        ${r.slice(0, 100)}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL  真实 API 冒烟测试\n        ${e.message || e}`);
    }
}

serverRef.close();
if (failed > 0) {
    console.error(`\n${failed} 个用例失败`);
    process.exit(1);
}
console.log('\n全部用例通过');
process.exit(0);
