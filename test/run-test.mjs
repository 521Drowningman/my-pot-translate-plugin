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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMockServer } from './mock-server.mjs';

const script = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
// pot 通过 eval 加载 main.js 并取走全局 translate 函数，这里等价复现
const translate = new Function(`${script}\nreturn translate;`)();

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
const utils = {
    http: { fetch: tauriFetch, Body },
    pluginDir: '', // 档案文件用例里按需覆盖
    readTextFile: (p) => fs.readFile(p, 'utf8'),
};

const TEXT = 'Hello, world!';
const EXPECTED = 'Hello, world! (translated)';

function opts(config, setResult = () => {}, utilsOver = {}) {
    return { config, detect: 'en', setResult, utils: Object.assign({}, utils, utilsOver) };
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
        '档案：名称精确匹配并覆盖基础配置',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/whoami',
                    apiKey: 'base-key',
                    model: 'base-model',
                    profilesJson: '[{"name":"good","apiKey":"test-key","model":"good-model"}]',
                    activeProfile: 'good',
                })
            );
            if (!r.includes('key=test-key') || !r.includes('model=good-model')) {
                throw new Error(`档案未生效：${r}`);
            }
        },
    ],
    [
        '档案：大小写与片段匹配',
        async () => {
            const mk = (activeProfile) =>
                translate(
                    TEXT,
                    'English',
                    'Simplified Chinese',
                    opts({
                        apiFormat: 'openai',
                        requestPath: base + '/whoami',
                        apiKey: 'base-key',
                        model: 'base-model',
                        profilesJson: '[{"name":"Good","apiKey":"test-key","model":"good-model"}]',
                        activeProfile,
                    })
                );
            if (!(await mk('GOOD')).includes('model=good-model')) throw new Error('忽略大小写匹配失败');
            if (!(await mk('oo')).includes('model=good-model')) throw new Error('片段匹配失败');
        },
    ],
    [
        '档案：当前档案留空时使用基础配置',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/whoami',
                    apiKey: 'test-key',
                    model: 'base-model',
                    profilesJson: '[{"name":"good","apiKey":"test-key","model":"good-model"}]',
                })
            );
            if (!r.includes('model=base-model')) throw new Error(`基础配置未生效：${r}`);
        },
    ],
    [
        '档案：找不到时报错并列出可用档案',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({
                            apiFormat: 'openai',
                            requestPath: base + '/whoami',
                            apiKey: 'test-key',
                            model: 'm',
                            profilesJson: '[{"name":"good"},{"name":"claude"}]',
                            activeProfile: 'nope',
                        })
                    ),
                '可用档案',
                '找不到档案'
            );
        },
    ],
    [
        '档案：片段匹配到多个时报错提示',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({
                            apiFormat: 'openai',
                            requestPath: base + '/whoami',
                            apiKey: 'test-key',
                            model: 'm',
                            profilesJson: '[{"name":"gpt4"},{"name":"gpt-mini"}]',
                            activeProfile: 'gpt',
                        })
                    ),
                '匹配到多个',
                '多义匹配'
            );
        },
    ],
    [
        '档案：失败自动切换开启时换下一个档案重试',
        async () => {
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts({
                    apiFormat: 'openai',
                    requestPath: base + '/whoami',
                    apiKey: 'base-key',
                    model: 'base-model',
                    profilesJson:
                        '[{"name":"bad","apiKey":"wrong-key","model":"m"},{"name":"good","apiKey":"test-key","model":"good-model"}]',
                    activeProfile: 'bad',
                    autoFallback: 'true',
                })
            );
            if (!r.includes('model=good-model')) throw new Error(`未兜底成功：${r}`);
        },
    ],
    [
        '档案：失败自动切换关闭时直接报错',
        async () => {
            await expectThrow(
                () =>
                    translate(
                        TEXT,
                        'English',
                        'Simplified Chinese',
                        opts({
                            apiFormat: 'openai',
                            requestPath: base + '/whoami',
                            apiKey: 'base-key',
                            model: 'base-model',
                            profilesJson:
                                '[{"name":"bad","apiKey":"wrong-key","model":"m"},{"name":"good","apiKey":"test-key","model":"good-model"}]',
                            activeProfile: 'bad',
                            autoFallback: 'false',
                        })
                    ),
                '401',
                '兜底关闭'
            );
        },
    ],
    [
        '档案：profilesJson 为空时读取插件目录 profiles.json',
        async () => {
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pot-profiles-'));
            await fs.writeFile(
                path.join(dir, 'profiles.json'),
                JSON.stringify([{ name: 'filegood', apiKey: 'test-key', model: 'file-model' }])
            );
            const r = await translate(
                TEXT,
                'English',
                'Simplified Chinese',
                opts(
                    {
                        apiFormat: 'openai',
                        requestPath: base + '/whoami',
                        apiKey: 'base-key',
                        model: 'base-model',
                        activeProfile: 'filegood',
                    },
                    () => {},
                    { pluginDir: dir }
                )
            );
            if (!r.includes('model=file-model')) throw new Error(`文件档案未生效：${r}`);
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
