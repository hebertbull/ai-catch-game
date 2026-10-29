// Testes rápidos (sem o YOLO): regras do jogo, cérebro e servidor.
//   npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, ROOT, RasterDraw } from './helpers.mjs';
import { resolveStaticPath } from '../server.js';

const { CatchGame, CatchLogic, CatchPerception } = loadAll();
const { Game, render, SIZE, BALL_RADIUS, PADDLE } = CatchGame;
const { Brain, reflect, slope } = CatchLogic;

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (error) { failed++; console.log(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`); }
}

// ---------------------------------------------------------------- jogo
test('mesma semente → mesmo jogo', () => {
    const run = seed => { const g = new Game({ seed, infiniteLives: true }); for (let i = 0; i < 600; i++) g.step(1 / 60); return JSON.stringify([g.balls, g.score, g.missed]); };
    assert.equal(run(5), run(5));
    assert.notEqual(run(5), run(6));
});

test('a raquete obedece às teclas e não sai da tela', () => {
    const g = new Game({ seed: 1 });
    g.setKeys({ left: true });
    for (let i = 0; i < 600; i++) g.step(1 / 60);
    assert.equal(g.paddleX, PADDLE.w / 2);
    g.setKeys({ right: true });
    for (let i = 0; i < 600; i++) g.step(1 / 60);
    assert.equal(g.paddleX, SIZE - PADDLE.w / 2);
    g.setKeys({});
    const x = g.paddleX; g.step(1 / 60);
    assert.equal(g.paddleX, x);
});

test('bola sobre a raquete é pega', () => {
    const g = new Game({ seed: 1 });
    g.spawnIn = 999;
    g.balls.push({ id: 1, x: g.paddleX, y: PADDLE.y - 60, vx: 0, vy: 300 });
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    assert.equal(g.score, 1); assert.equal(g.missed, 0); assert.equal(g.balls.length, 0);
});

test('bola fora da raquete é perdida e custa uma vida', () => {
    const g = new Game({ seed: 1 });
    g.spawnIn = 999;
    g.balls.push({ id: 1, x: 40, y: PADDLE.y - 60, vx: 0, vy: 300 });
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    assert.equal(g.score, 0); assert.equal(g.missed, 1); assert.equal(g.lives, 4);
});

test('o jogo acaba sem vidas; com vidas infinitas, não', () => {
    const g = new Game({ seed: 2 });
    for (let i = 0; i < 60 * 120 && !g.over; i++) g.step(1 / 60);
    assert.ok(g.over && g.lives === 0 && g.missed >= 5, 'parado, o jogador perde');
    const h = new Game({ seed: 2, infiniteLives: true });
    for (let i = 0; i < 60 * 120; i++) h.step(1 / 60);
    assert.ok(!h.over && h.lives === 5);
});

test('bolas quicam nas paredes e nunca saem pelos lados', () => {
    const g = new Game({ seed: 3, infiniteLives: true });
    for (let i = 0; i < 60 * 60; i++) { g.step(1 / 60); for (const b of g.balls) assert.ok(b.x >= BALL_RADIUS - 1e-9 && b.x <= SIZE - BALL_RADIUS + 1e-9); }
});

test('a tela só tem céu, grama, raquete e bolas (nada de texto/HUD no que a IA enxerga)', () => {
    const g = new Game({ seed: 1 }); g.spawn(); g.balls[0].y = 200;
    const d = new RasterDraw(); render(g, d);
    const seen = new Set(); for (let i = 0; i < d.data.length; i += 3) seen.add(`${d.data[i]},${d.data[i + 1]},${d.data[i + 2]}`);
    assert.deepEqual([...seen].sort(), ['110,170,100', '135,190,235', '20,20,20', '255,255,255', '40,90,200']);
});

// ---------------------------------------------------------------- cérebro
test('reflect: dobra x como uma bola quicando', () => {
    assert.equal(reflect(50, 22, 618), 50);
    assert.equal(reflect(20, 22, 618), 24);      // passou 2 px da parede esquerda
    assert.equal(reflect(620, 22, 618), 616);    // passou 2 px da direita
    assert.ok(Math.abs(reflect(1300, 22, 618) - 1300 + 2 * 596) < 596 * 2);
});

test('slope: velocidade pela reta de mínimos quadrados', () => {
    const pts = [0, 0.1, 0.2, 0.3, 0.4].map(t => ({ t, v: 100 + 250 * t }));
    assert.ok(Math.abs(slope(pts) - 250) < 1e-9);
    assert.equal(slope([{ t: 0, v: 1 }]), null);
});

test('rastreador: junta detecções da mesma bola e estima a velocidade', () => {
    const b = new Brain();
    for (let k = 0; k < 6; k++) b.update([{ x: 100 + 40 * k * 0.1, y: 50 + 220 * k * 0.1, score: 0.9 }], k * 0.1);
    assert.equal(b.tracks.length, 1);
    assert.ok(Math.abs(b.tracks[0].vy - 220) < 1 && Math.abs(b.tracks[0].vx - 40) < 1);
});

test('rastreador: duas bolas ficam separadas e a esquecida some', () => {
    const b = new Brain();
    for (let k = 0; k < 4; k++) b.update([{ x: 100, y: 50 + 200 * k * 0.1, score: 0.9 }, { x: 500, y: 20 + 180 * k * 0.1, score: 0.8 }], k * 0.1);
    assert.equal(b.tracks.length, 2);
    b.update([], 0.3 + 0.7);
    assert.equal(b.tracks.length, 0);
});

test('cérebro: vai para onde a bola vai cair, já descontando o atraso', () => {
    const b = new Brain();
    // bola caindo a 200 px/s, indo 50 px/s para a direita; visto em t=0 e t=0.1
    b.update([{ x: 100, y: 100, score: 1 }], 0); b.update([{ x: 105, y: 120, score: 1 }], 0.1);
    const paddle = { x: 320, y: PADDLE.y, w: PADDLE.w };
    const out = b.control(0.2, paddle, { width: SIZE, ballRadius: BALL_RADIUS });
    // chega à raquete quando y = 560 - 22 = 538 → t = 0.1 + (538-120)/200 = 2.19 s → x = 105 + 50*2.09 ≈ 209.5
    assert.ok(Math.abs(out.target.x - 209.5) < 2, `alvo em ${out.target.x}`);
    assert.ok(out.left && !out.right, 'deve ir para a esquerda');
});

test('cérebro: sem bolas, fica parado', () => {
    const out = new Brain().control(1, { x: 320, y: PADDLE.y, w: PADDLE.w }, { width: SIZE, ballRadius: BALL_RADIUS });
    assert.deepEqual([out.left, out.right, out.target], [false, false, null]);
});

/** Joga com detecções "sintéticas" (verdade + ruído + falhas + atraso). Devolve a taxa de bolas pegas. */
function simulate({ seed, seconds = 60, noise = 1.5, dropout = 0.05, latencySteps = 3, brain = new Brain(), oracle = true, idle = false }) {
    const g = new Game({ seed, infiniteLives: true });
    let r = 1; const rng = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    const world = { width: SIZE, ballRadius: BALL_RADIUS }, queue = [];
    for (let step = 0; step < seconds * 60; step++) {
        if (!idle && step % 6 === 0) {
            const dets = g.balls.filter(b => b.y > 8 && rng() > dropout).map(b => ({ x: b.x + (rng() - 0.5) * 2 * noise, y: b.y + (rng() - 0.5) * 2 * noise, score: 0.9 }));
            queue.push({ at: step + latencySteps, t: g.time, dets });
        }
        while (queue.length && queue[0].at <= step) { const q = queue.shift(); brain.update(q.dets, q.t); }
        g.setKeys(idle ? {} : brain.control(g.time, g.paddle, world));
        g.step(1 / 60);
    }
    return { rate: g.score / Math.max(1, g.score + g.missed), score: g.score, missed: g.missed };
}

test('cérebro com percepção quase perfeita pega a grande maioria das bolas (e muito mais que ficar parado)', () => {
    const seeds = [1, 2, 3, 4];
    const ai = seeds.map(seed => simulate({ seed }));
    const idle = seeds.map(seed => simulate({ seed, idle: true }));
    const mean = a => a.reduce((s, x) => s + x.rate, 0) / a.length;
    console.log(`    IA ${(mean(ai) * 100).toFixed(0)}% das bolas × parada ${(mean(idle) * 100).toFixed(0)}% (4 jogos de 60 s)`);
    assert.ok(mean(ai) >= 0.85, `IA: ${mean(ai)}`);
    assert.ok(mean(ai) > mean(idle) + 0.5, 'a IA precisa ser muito melhor que ficar parada');
});

test('cérebro aguenta ruído maior, atraso maior e mais falhas de detecção', () => {
    const r = [1, 2, 3].map(seed => simulate({ seed, noise: 6, dropout: 0.25, latencySteps: 8 }));
    const rate = r.reduce((s, x) => s + x.rate, 0) / r.length;
    console.log(`    ruído 6 px, 25% de falhas, atraso 133 ms → ${(rate * 100).toFixed(0)}% das bolas`);
    assert.ok(rate >= 0.6, `taxa ${rate}`);
});

// ---------------------------------------------------------------- percepção (parte sem TensorFlow)
test('processPredictions: limiar, classe e centro da caixa', () => {
    const labels = Array.from({ length: 80 }, (_, i) => (i === 33 ? 'kite' : i === 0 ? 'person' : 'x' + i));
    const boxes = Float32Array.from([0.4, 0.3, 0.6, 0.5,   0.1, 0.1, 0.2, 0.2,   0.7, 0.7, 0.9, 0.9]);
    const scores = Float32Array.from([0.9, 0.3, 0.8]);
    const classes = Float32Array.from([33, 33, 0]);
    const all = [...CatchPerception.processPredictions({ boxes, scores, classes }, 640, 640, labels, 0.4, null)];
    assert.equal(all.length, 2);                                       // o de 30% cai fora
    assert.ok(Math.abs(all[0].x - 320) < 1e-3 && Math.abs(all[0].y - 256) < 1e-3, 'centro (0,5 × 640, 0,4 × 640)');
    assert.ok(Math.abs(all[0].w - 128) < 1e-3 && Math.abs(all[0].h - 128) < 1e-3);
    const kites = [...CatchPerception.processPredictions({ boxes, scores, classes }, 640, 640, labels, 0.4, ['kite'])];
    assert.equal(kites.length, 1);
    const low = [...CatchPerception.processPredictions({ boxes, scores, classes }, 640, 640, labels, 0.0, null)];
    assert.equal(low.length, 3);
});

test('processPredictions: mesmo resultado do processPrediction original do Duck Hunt', () => {
    const file = path.resolve(ROOT, '../exemplo-02/DuckHunt-JS-parte02/machine-learning/worker.js');
    if (!fs.existsSync(file)) { console.log('    (arquivo do Duck Hunt não encontrado: pulado)'); return; }
    const m = fs.readFileSync(file, 'utf8').match(/function\* processPrediction[\s\S]*?\n}\n/);
    const labels = JSON.parse(fs.readFileSync(path.join(ROOT, 'model/labels.json'), 'utf8'));
    const original = new Function('_labels', 'CLASS_THRESHOLD', m[0] + '\nreturn processPrediction;')(labels, 0.4);
    let seed = 9; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 500; n++) {
        const N = Math.floor(rnd() * 7), boxes = new Float32Array(N * 4), scores = new Float32Array(N), classes = new Float32Array(N);
        for (let i = 0; i < N; i++) { const x1 = rnd() * 0.8, y1 = rnd() * 0.8; boxes.set([x1, y1, x1 + rnd() * 0.2, y1 + rnd() * 0.2], i * 4); scores[i] = rnd(); classes[i] = rnd() < 0.5 ? 33 : Math.floor(rnd() * 80); }
        const W = 100 + Math.floor(rnd() * 1000), H = 100 + Math.floor(rnd() * 800);
        const a = [...original({ boxes, scores, classes }, W, H)].map(({ x, y }) => [x, y]);
        const b = [...CatchPerception.processPredictions({ boxes, scores, classes }, W, H, labels, 0.4, ['kite'])].map(({ x, y }) => [x, y]);
        assert.deepEqual(b, a);
    }
});

// ---------------------------------------------------------------- servidor
test('servidor: serve só o que deve e bloqueia tentativas de sair da pasta', () => {
    const ok = ['/', '/index.html', '/src/main.js', '/src/game.js', '/src/ai/worker.js', '/model/model.json', '/model/group1-shard1of2.bin',
        '/src/%2e/main.js' /* = /src/./main.js = o próprio src/main.js: pode */];
    for (const p of ok) assert.equal(resolveStaticPath(p).status, 200, p);
    const blocked = ['/server.js', '/package.json', '/tests/unit.mjs', '/.gitignore', '/node_modules/x', '/src/', '/src',
        '/../package.json', '/..%2fpackage.json', '/%2e%2e%2fpackage.json', '/src/..%2f..%2fserver.js', '/src/../server.js',
        '/model/../server.js', '//etc/passwd', '/nao-existe.js', '/..%2f..%2f..%2f..%2fetc%2fhosts', '/src%2f..%2fserver.js'];
    for (const p of blocked) assert.notEqual(resolveStaticPath(p).status, 200, `não deveria servir ${p}`);
    assert.equal(resolveStaticPath('/%zz').status, 400);
    assert.equal(resolveStaticPath('/src/main.js%00.png').status, 400);
    assert.equal(resolveStaticPath('/src/main.js').type, 'text/javascript; charset=utf-8');
    assert.equal(resolveStaticPath('/model/model.json').type, 'application/json; charset=utf-8');
});

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
