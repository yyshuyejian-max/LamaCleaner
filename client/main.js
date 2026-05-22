// =====================================================
// LaMa Cleaner - Panel Logic
// =====================================================

const cs = new CSInterface();
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const url = require('url');
const { spawn } = require('child_process');

const SERVER_URL = 'http://127.0.0.1:8765';
const TMP_DIR = path.join(os.tmpdir(), 'ps_lama');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const $ = id => document.getElementById(id);

// ---------- 当前模式 ----------
let currentMode = 'selection'; // 'selection' | 'brush'

// ---------- 状态条 ----------
function setStatus(text, type) {
    const el = $('status');
    el.textContent = text;
    el.className = 'status ' + (type || 'pending');
}

// ---------- Loading 遮罩 ----------
function showOverlay(text, subtext) {
    $('overlayText').textContent = text || '处理中...';
    $('overlaySubtext').textContent = subtext || '';
    $('overlay').classList.remove('hidden');
}
function updateOverlay(text, subtext) {
    if (text !== undefined)    $('overlayText').textContent = text;
    if (subtext !== undefined) $('overlaySubtext').textContent = subtext;
}
function hideOverlay() {
    $('overlay').classList.add('hidden');
}

// ---------- 帮助弹窗 ----------
$('btnHelp').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
$('btnCloseHelp').addEventListener('click', () => $('helpModal').classList.add('hidden'));
$('helpModal').addEventListener('click', (e) => {
    if (e.target.id === 'helpModal') $('helpModal').classList.add('hidden');
});

// ---------- 模式切换 ----------
const STEPS = {
    selection: [
        '启动后端服务（首次需下载模型）',
        '用任意选区工具圈住要清除的区域',
        '点「清除选区内容」',
        '结果作为新图层贴回'
    ],
    brush: [
        '启动后端服务（首次需下载模型）',
        '点「创建蒙版图层」自动新建图层',
        '用画笔涂抹要清除的区域（颜色不限）',
        '点「清除涂抹区域」，蒙版自动隐藏'
    ]
};

function setMode(mode) {
    currentMode = mode;
    $('modeSelection').classList.toggle('active', mode === 'selection');
    $('modeBrush').classList.toggle('active', mode === 'brush');
    $('brushPane').classList.toggle('hidden', mode !== 'brush');
    $('btnCleanLabel').textContent = mode === 'brush' ? '清除涂抹区域' : '清除选区内容';

    const ol = $('stepsList');
    ol.innerHTML = '';
    STEPS[mode].forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        ol.appendChild(li);
    });
}

$('modeSelection').addEventListener('click', () => setMode('selection'));
$('modeBrush').addEventListener('click', () => setMode('brush'));

// ---------- 创建蒙版图层 ----------
$('btnCreateMask').addEventListener('click', () => {
    cs.evalScript('createMaskLayer()', (res) => {
        if (res === 'no_document') {
            setStatus('请先打开一个文档', 'err');
        } else if (res === 'exists') {
            setStatus('LaMa_Mask 图层已选中，开始涂抹吧', 'ok');
        } else if (res === 'ok') {
            setStatus('LaMa_Mask 图层已创建，用画笔涂抹吧', 'ok');
        } else {
            setStatus('创建失败: ' + res, 'err');
        }
    });
});

// ---------- 服务健康检查 ----------
function checkServer() {
    return new Promise(resolve => {
        const req = http.get(SERVER_URL + '/health', { timeout: 1500 }, res => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

async function refreshStatus() {
    const ok = await checkServer();
    if (ok) {
        setStatus('● 服务已就绪', 'ok');
        $('btnClean').disabled = false;
        $('btnStart').disabled = true;
        $('btnStart').textContent = '后端服务运行中';
    } else {
        setStatus('● 服务未启动', 'err');
        $('btnClean').disabled = true;
        $('btnStart').disabled = false;
        $('btnStart').textContent = '启动后端服务';
    }
}

// ---------- 启动后端 ----------
$('btnStart').addEventListener('click', () => {
    const extRoot = cs.getSystemPath(SystemPath.EXTENSION);
    const bat = path.join(extRoot, 'server', 'run.bat');

    if (!fs.existsSync(bat)) {
        setStatus('找不到 run.bat', 'err');
        return;
    }

    setStatus('正在启动服务...', 'pending');
    showOverlay('正在启动后端服务', '首次启动需下载模型 ~200MB，请耐心等待');

    const { exec } = require('child_process');
    const serverDir = path.join(extRoot, 'server');
    const startCmd = `start "LaMa Server" cmd.exe /k "${bat}"`;
    exec(startCmd, { cwd: serverDir }, (err) => {
        if (err) console.error('启动后端失败:', err);
    });

    let tries = 0;
    const interval = setInterval(async () => {
        tries++;
        const elapsed = tries * 2;
        updateOverlay(undefined, `已等待 ${elapsed} 秒... (首次最多 4 分钟)`);

        if (await checkServer()) {
            clearInterval(interval);
            hideOverlay();
            refreshStatus();
        } else if (tries > 120) {
            clearInterval(interval);
            hideOverlay();
            setStatus('启动超时，请查看后端窗口报错', 'err');
        }
    }, 2000);
});

// ---------- 核心：清除操作 ----------
$('btnClean').addEventListener('click', () => {
    const ts = Date.now();
    const imgPath  = path.join(TMP_DIR, `src_${ts}.png`).replace(/\\/g, '/');
    const maskPath = path.join(TMP_DIR, `mask_${ts}.png`).replace(/\\/g, '/');
    const outPath  = path.join(TMP_DIR, `out_${ts}.png`).replace(/\\/g, '/');
    const expand   = parseInt($('expand').value) || 0;

    $('btnClean').disabled = true;

    if (currentMode === 'brush') {
        // ── 涂抹蒙版模式 ──────────────────────────────
        // 立刻隐藏红色蒙版，避免用户看到红色残留，也避免混入导出的原图
        showOverlay('生成蒙版中...', '');
        cs.evalScript('hideMaskLayer()', () => {
            cs.evalScript(`exportPaintedMaskAndImage("${imgPath}", "${maskPath}", ${expand})`, (res) => {
                const errMsg = {
                    'no_document':   '请先打开一个文档',
                    'no_mask_layer': '找不到 LaMa_Mask 图层，请先点「创建蒙版图层」',
                    'empty_mask':    '请先在 LaMa_Mask 图层上用画笔涂抹要清除的区域',
                    'alpha_lost':    '蒙版通道生成失败，请重试',
                }[res];
                if (errMsg || (res && res.startsWith('exception'))) {
                    hideOverlay();
                    setStatus(errMsg || ('错误: ' + res), 'err');
                    $('btnClean').disabled = false;
                    return;
                }
                runInpaint(imgPath, maskPath, outPath, null);
            });
        });
    } else {
        // ── 选区模式 ──────────────────────────────────
        showOverlay('导出选区...', '');
        cs.evalScript(`exportSelectionAndMask("${imgPath}", "${maskPath}", ${expand})`, (res) => {
            const errMsg = {
                'no_document': '请先打开一个文档',
                'no_selection': '请先创建一个选区',
                'alpha_lost':   '蒙版生成失败',
            }[res];
            if (errMsg || (res && res.startsWith('exception'))) {
                hideOverlay();
                setStatus(errMsg || ('错误: ' + res), 'err');
                $('btnClean').disabled = false;
                return;
            }
            runInpaint(imgPath, maskPath, outPath, null);
        });
    }
});

// ---------- 公共推理流程 ----------
function runInpaint(imgPath, maskPath, outPath, onSuccess) {
    let elapsedSec = 0;
    updateOverlay('AI 处理中', '已用时 0s，请稍候...');
    const timerInterval = setInterval(() => {
        elapsedSec++;
        updateOverlay('AI 处理中', `已用时 ${elapsedSec}s，请稍候...`);
    }, 1000);

    postMultipart(SERVER_URL + '/inpaint',
        { image: imgPath, mask: maskPath },
        (err, data) => {
            clearInterval(timerInterval);
            if (err) {
                hideOverlay();
                setStatus('请求失败: ' + err.message, 'err');
                $('btnClean').disabled = false;
                return;
            }

            try {
                fs.writeFileSync(outPath, data);
            } catch (e) {
                hideOverlay();
                setStatus('写文件失败: ' + e.message, 'err');
                $('btnClean').disabled = false;
                return;
            }

            updateOverlay('放回 Photoshop...', '');
            cs.evalScript(`placeResult("${outPath}")`, (r2) => {
                hideOverlay();
                if (r2 === 'ok') {
                    setStatus('✓ 完成，结果在新图层', 'ok');
                    if (onSuccess) onSuccess();
                    [imgPath, maskPath, outPath].forEach(p => {
                        try { fs.unlinkSync(p); } catch (e) {}
                    });
                } else {
                    setStatus('放回失败: ' + r2, 'err');
                }
                $('btnClean').disabled = false;
            });
        }
    );
}

// ---------- HTTP multipart 上传 ----------
function postMultipart(targetUrl, files, callback) {
    const parsed = url.parse(targetUrl);
    const boundary = '----PSExt' + Date.now();

    const parts = [];
    for (const field in files) {
        const filePath = files[field];
        let fileData;
        try {
            fileData = fs.readFileSync(filePath);
        } catch (e) {
            return callback(new Error('读文件失败: ' + filePath));
        }
        const filename = path.basename(filePath);
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
        parts.push(Buffer.from(header, 'utf8'));
        parts.push(fileData);
        parts.push(Buffer.from('\r\n', 'utf8'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    const body = Buffer.concat(parts);

    const opts = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
        },
        timeout: 300000
    };

    const req = http.request(opts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (res.statusCode === 200) {
                callback(null, buf);
            } else {
                callback(new Error(`HTTP ${res.statusCode}: ${buf.toString().slice(0, 200)}`));
            }
        });
    });

    req.on('error', err => callback(err));
    req.on('timeout', () => { req.destroy(); callback(new Error('请求超时')); });
    req.write(body);
    req.end();
}

// 启动
refreshStatus();
setInterval(refreshStatus, 4000);
