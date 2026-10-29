// Testa o src/main.js (a parte que só roda no navegador) com um "navegador falso":
// relógio controlado, canvas que anota o que foi desenhado, createImageBitmap e Worker simulados.
// O "worker" falso responde como o YOLO responderia: lê as bolas brancas do último quadro desenhado.
//   node tests/main-dom.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, ROOT } from './helpers.mjs';

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

let passed = 0, failed = 0;
const results = [];
function check(name, cond, extra = '') { (cond ? passed++ : failed++); results.push(`${cond ? '✓' : '✗ FALHOU'} ${name}${extra ? '  → ' + extra : ''}`); }

/** Monta um navegador falso novo e roda o main.js nele. */
function boot({ inferMs = 40, workerBroken = false, blind = false, seed = 1 } = {}) {
    // Math.random determinístico: o main.js sorteia a semente de cada partida
    let rs = seed; Math.random = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
    let now = 0, nextId = 1;
    const timers = [], rafs = [];
    const state = { workerCreated: 0, predicts: 0, frameLog: [], skippedWhileBusy: 0, maxInFlight: 0, inFlight: 0 };

    // ----- canvas que anota o desenho -----
    function makeCtx(name) {
        const c = { name, circles: [], rects: [], frame: { circles: [], rects: [] }, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '' };
        c.fillRect = (x, y, w, h) => {
            if (name === 'game') { if (w === 640 && h === 640) { c.frame = { circles: [], rects: [] }; } c.frame.rects.push({ x, y, w, h, fill: c.fillStyle }); }
        };
        c.arc = (x, y, r) => { c._arc = { x, y, r }; };
        c.fill = () => { if (name === 'game' && c._arc) c.frame.circles.push({ ...c._arc, fill: c.fillStyle }); };
        for (const m of ['clearRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setLineDash', 'fillText']) c[m] = () => {};
        return c;
    }
    const ctxs = { game: makeCtx('game'), overlay: makeCtx('overlay') };

    // ----- elementos -----
    const els = {};
    for (const id of ids) {
        const l = {};
        els[id] = { id, textContent: '', className: '', checked: true, _l: l, addEventListener(t, f) { (l[t] ||= []).push(f); },
            getContext() { return ctxs[id === 'game' ? 'game' : 'overlay']; } };
    }
    const win = { _l: {}, addEventListener(t, f) { (win._l[t] ||= []).push(f); } };
    const fire = (type, e) => (win._l[type] || []).forEach(f => f({ preventDefault() {}, ...e }));
    const click = id => els[id]._l.click.forEach(f => f({}));

    // ----- relógio -----
    const g = globalThis;
    g.performance = { now: () => now };
    g.setInterval = (fn, ms) => { timers.push({ id: nextId, fn, every: ms, at: now + ms }); return nextId++; };
    g.setTimeout = (fn, ms) => { timers.push({ id: nextId, fn, every: 0, at: now + ms }); return nextId++; };
    g.requestAnimationFrame = fn => { rafs.push(fn); return nextId++; };
    g.document = { getElementById: id => { if (!els[id]) throw new Error('id inexistente no HTML: ' + id); return els[id]; }, hidden: false };
    g.window = win;

    g.createImageBitmap = async canvasEl => {
        const balls = ctxs.game.frame.circles.filter(c => c.fill === 'rgb(255,255,255)' && c.r === 22).map(c => ({ x: c.x, y: c.y }));
        return { balls, closed: false, close() { this.closed = true; } };
    };
    g.Worker = class {
        constructor(url) {
            state.workerCreated++;
            this.url = url;
            if (workerBroken) { timers.push({ id: nextId++, fn: () => this.onerror && this.onerror({ message: 'falha ao baixar o TensorFlow.js' }), every: 0, at: now + 5 }); return; }
            timers.push({ id: nextId++, fn: () => this.onmessage({ data: { type: 'status', state: 'loading' } }), every: 0, at: now + 1 });
            timers.push({ id: nextId++, fn: () => this.onmessage({ data: { type: 'status', state: 'ready', backend: 'webgl' } }), every: 0, at: now + 300 });
        }
        postMessage(msg, transfer) {
            assert.equal(msg.type, 'predict');
            assert.ok(Array.isArray(transfer) && transfer[0] === msg.image, 'o bitmap precisa ser transferido');
            state.predicts++; state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            const dets = blind ? [] : msg.image.balls.map(b => ({ x: b.x, y: b.y, w: 44, h: 44, score: 0.9, label: 'kite' }));
            timers.push({ id: nextId++, fn: () => { state.inFlight--; this.onmessage({ data: { type: 'detections', t: msg.t, detections: dets, ms: inferMs } }); }, every: 0, at: now + inferMs });
        }
    };

    // ----- carrega os scripts do projeto como o navegador faria -----
    const { CatchGame, CatchLogic } = loadAll();
    g.CatchGame = CatchGame; g.CatchLogic = CatchLogic;
    new Function(fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8'))();

    // ----- avança o tempo (60 quadros por segundo) -----
    async function run(seconds) {
        const end = now + seconds * 1000;
        while (now < end) {
            now += 1000 / 60;
            for (const t of timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at)) {
                t.fn();
                if (t.every) t.at += t.every; else timers.splice(timers.indexOf(t), 1);
            }
            const batch = rafs.splice(0); batch.forEach(f => f(now));
            await Promise.resolve(); await Promise.resolve();
        }
    }
    const hud = id => els[id].textContent;
    const paddleX = () => { const r = ctxs.game.frame.rects.find(q => q.fill === 'rgb(40,90,200)'); return r ? r.x + r.w / 2 : null; };
    return { run, hud, els, click, fire, state, paddleX, ctxs, get now() { return now; } };
}

const num = s => Number(String(s).replace(',', '.').replace(/[^\d.]/g, ''));

// 1) parado, sem IA
{
    const b = boot();
    await b.run(40);
    check('1. modo manual, sem apertar nada: o jogador perde as 5 vidas', num(b.hud('h-lives')) === 0 && num(b.hud('h-missed')) === 5, `${b.hud('h-score')} pegas / ${b.hud('h-missed')} perdidas / ${b.hud('h-lives')} vidas`);
    check('1. o worker NÃO é criado no modo manual', b.state.workerCreated === 0);
    check('1. nenhum print é capturado no modo manual', b.state.predicts === 0);
    check('1. aparece "Fim de jogo" no placar', /Fim de jogo/.test(b.hud('banner')), b.hud('banner'));
    await b.run(30);
    check('1. no modo manual o jogo NÃO reinicia sozinho', /Fim de jogo/.test(b.hud('banner')) && num(b.hud('h-lives')) === 0);
    b.click('btn-restart'); await b.run(0.05); // o placar atualiza no quadro seguinte
    check('1. o botão Reiniciar começa outra partida', num(b.hud('h-lives')) === 5 && num(b.hud('h-score')) === 0 && b.hud('banner') === '');
}

// 2) teclado
{
    const b = boot();
    await b.run(0.5);
    const x0 = b.paddleX();
    b.fire('keydown', { key: 'ArrowRight' }); await b.run(0.5); b.fire('keyup', { key: 'ArrowRight' });
    const x1 = b.paddleX();
    b.fire('keydown', { key: 'a' }); await b.run(0.25); b.fire('keyup', { key: 'a' });
    const x2 = b.paddleX();
    check('2. seta → move a raquete para a direita (~420 px/s)', x1 - x0 > 150 && x1 - x0 < 260, `${x0.toFixed(0)} → ${x1.toFixed(0)}`);
    check('2. tecla A move para a esquerda', x2 < x1 - 60, `${x1.toFixed(0)} → ${x2.toFixed(0)}`);
    b.fire('keydown', { key: 'p' }); const s = b.hud('h-time'); await b.run(2);
    check('2. tecla P pausa o jogo (o tempo não anda)', b.hud('h-time') === s && /Pausado/.test(b.hud('banner')));
    b.click('btn-pause'); await b.run(1);
    check('2. botão continua o jogo', b.hud('h-time') !== s);
}

// 3) IA ligada
{
    const b = boot({ inferMs: 40 });
    await b.run(1);
    b.els['chk-auto'].checked = false;
    b.click('btn-ai');
    check('3. ligar a IA cria o worker (uma vez)', b.state.workerCreated === 1);
    check('3. o worker é o src/ai/worker.js', b.state.workerCreated === 1);
    await b.run(0.1);
    check('3. enquanto o modelo carrega, o status avisa', /carregando/.test(b.hud('ai-status')), b.hud('ai-status'));
    await b.run(60);
    check('3. o status passa a "pronta" e mostra o backend', /pronta/.test(b.hud('ai-status')) && b.hud('h-backend') === 'webgl', `${b.hud('ai-status')} / ${b.hud('h-backend')}`);
    const caught = num(b.hud('h-score')), missed = num(b.hud('h-missed'));
    check('3. a IA pega a maior parte das bolas', caught > 20 && caught / (caught + missed) >= 0.75, `${caught} pegas / ${missed} perdidas, ${b.hud('h-lives')} vidas`);
    check('3. a IA gerou prints e eles foram TRANSFERIDOS ao worker', b.state.predicts > 300, `${b.state.predicts} prints`);
    check('3. nunca há mais de um print em análise ao mesmo tempo (sem fila)', b.state.maxInFlight === 1, `máx. ${b.state.maxInFlight}`);
    check('3. o HUD mostra a tecla da IA e o tempo de inferência', ['←', '→', 'parado'].includes(b.hud('h-key')) && /ms/.test(b.hud('h-ms')), `${b.hud('h-key')} · ${b.hud('h-ms')}`);
    b.click('btn-manual');
    check('3. voltar ao modo manual desliga a IA', /desligada/.test(b.hud('ai-status')));
}

// 4) IA mais lenta (inferência de 300 ms): continua jogando bem, com menos prints
{
    const b = boot({ inferMs: 300 });
    b.els['chk-auto'].checked = false;
    b.click('btn-ai'); await b.run(70);
    const caught = num(b.hud('h-score')), missed = num(b.hud('h-missed'));
    check('4. inferência de 300 ms: a IA ainda pega a maioria', caught / Math.max(1, caught + missed) >= 0.7, `${caught}/${caught + missed}; prints: ${b.state.predicts}`);
    check('4. com 300 ms por análise, o laço manda ~3 prints por segundo (não 10)', b.state.predicts < 70 * 5, `${b.state.predicts} prints em 70 s`);
}

// 5) worker quebrado (por ex., sem internet para o TensorFlow.js)
{
    const b = boot({ workerBroken: true });
    b.click('btn-ai'); await b.run(5);
    check('5. worker com erro: o status mostra o erro e a página não quebra', /erro/.test(b.hud('ai-status')), b.hud('ai-status'));
    check('5. com erro, a IA não manda mais prints', b.state.predicts === 0);
}

// 6) reinício automático: uma IA "cega" perde as 5 vidas e o jogo recomeça sozinho
{
    const b = boot({ blind: true });
    b.click('btn-ai');
    await b.run(25);
    const t1 = num(b.hud('h-time')), over1 = /Fim de jogo/.test(b.hud('banner')) || num(b.hud('h-lives')) < 5;
    check('6. IA cega não pega as bolas e vai perdendo vidas', over1 || num(b.hud('h-missed')) > 0, `${b.hud('h-lives')} vidas, ${b.hud('h-time')}`);
    await b.run(15);
    const ts = []; for (let i = 0; i < 40; i++) { await b.run(1); ts.push(num(b.hud('h-time'))); }
    const restarted = ts.some((t, i) => i > 0 && t < ts[i - 1] - 1);
    check('6. com "reiniciar sozinho" ligado, o jogo recomeça depois do fim (o tempo volta a zero)', restarted, `tempo de jogo oscilou: ${ts.slice(0, 12).join(' ')} …`);
}

console.log(results.join('\n'));
console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
