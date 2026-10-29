// Ciclo fechado com o YOLO de verdade, sem navegador:
//   jogo → desenha o quadro → YOLO → centros → cérebro → teclas → jogo
// Compara 3 jogadores nas mesmas partidas (mesma semente):
//   • IA com YOLO      (vê só os pixels, como no navegador)
//   • "oráculo"        (recebe as posições exatas, com um pouco de ruído: o teto do cérebro)
//   • parado           (a raquete não se mexe: o piso)
//
//   npm run test:e2e                         (precisa do @tensorflow/tfjs-node)
//   SECONDS=60 SEEDS=3 LATENCY_STEPS=6 npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, loadTfNode, RasterDraw, SuperSampledDraw, ROOT } from './helpers.mjs';

const SECONDS = Number(process.env.SECONDS) || 45;
const SEEDS = Number(process.env.SEEDS) || 3;
const LATENCY_STEPS = Number(process.env.LATENCY_STEPS ?? 6);   // 6 passos = 100 ms entre o print e a decisão
// ACCEPT=person → controle negativo: só aceita a classe "person", que nunca aparece. A IA fica cega e deve cair para o nível de "parado".
const ACCEPT = process.env.ACCEPT ? process.env.ACCEPT.split(',') : null;
// AA=1 → desenha com bordas suavizadas (como o canvas do navegador), em vez de pixels "duros"
const AA = process.env.AA === '1';
const CAPTURE_EVERY = 6;                                        // 10 prints por segundo, como no navegador

const tf = loadTfNode();
const { CatchGame, CatchLogic, CatchPerception } = loadAll();
const { Game, render, SIZE, BALL_RADIUS } = CatchGame;
const { Brain } = CatchLogic;
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, 'model/labels.json'), 'utf8'));
const perception = await CatchPerception.create(tf, { modelUrl: 'file://' + path.join(ROOT, 'model/model.json'), labels, threshold: 0.4, accept: ACCEPT });
const world = { width: SIZE, ballRadius: BALL_RADIUS };

function noise(rng, amount) { return (rng() - 0.5) * 2 * amount; }

async function play(seed, player) {
    const game = new Game({ seed, infiniteLives: true });
    const brain = new Brain();
    const raster = AA ? new SuperSampledDraw(SIZE, 4) : new RasterDraw(SIZE);
    const queue = [];
    let r = seed * 7919 + 1; const rng = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    const stats = { frames: 0, truth: 0, found: 0, err: 0, falsePos: 0, ms: 0, labels: {} };

    for (let step = 0; step < SECONDS * 60; step++) {
        if (player !== 'idle' && step % CAPTURE_EVERY === 0) {
            let dets;
            if (player === 'oracle') {
                dets = game.balls.filter(b => b.y > 8).map(b => ({ x: b.x + noise(rng, 1.5), y: b.y + noise(rng, 1.5), score: 0.9 }));
            } else {
                render(game, raster);                                           // o quadro, em pixels
                const image = tf.tensor3d(raster.data, [SIZE, SIZE, 3], 'int32');
                const t0 = performance.now();
                dets = await perception.detect(image);                          // YOLO
                stats.ms += performance.now() - t0;
                image.dispose();
                // quão boa foi a percepção neste quadro?
                const visible = game.balls.filter(b => b.y >= BALL_RADIUS && b.y <= SIZE);
                stats.frames++; stats.truth += visible.length;
                const claimed = new Set();
                for (const b of visible) {
                    let best = null, bd = 20;
                    for (const d of dets) { const dist = Math.hypot(d.x - b.x, d.y - b.y); if (dist < bd && !claimed.has(d)) { best = d; bd = dist; } }
                    if (best) { claimed.add(best); stats.found++; stats.err += bd; stats.labels[best.label] = (stats.labels[best.label] || 0) + 1; }
                }
                stats.falsePos += dets.filter(d => !claimed.has(d)).length;
            }
            queue.push({ at: step + LATENCY_STEPS, t: game.time, dets });
        }
        while (queue.length && queue[0].at <= step) { const q = queue.shift(); brain.update(q.dets, q.t); }
        game.setKeys(player === 'idle' ? {} : brain.control(game.time, game.paddle, world));
        game.step(1 / 60);
    }
    return { game, stats };
}

console.log(`Ciclo fechado · ${SEEDS} partidas de ${SECONDS} s por jogador · atraso do print até a decisão: ${LATENCY_STEPS} passos (${Math.round(LATENCY_STEPS / 60 * 1000)} ms) · backend ${tf.getBackend()}${ACCEPT ? ' · CONTROLE NEGATIVO: aceita só ' + ACCEPT.join(',') : ''}${AA ? ' · bordas suavizadas (antialiasing 4×)' : ''}\n`);
const total = { yolo: [0, 0], oracle: [0, 0], idle: [0, 0] };
const agg = { frames: 0, truth: 0, found: 0, err: 0, falsePos: 0, ms: 0, labels: {} };
console.log('semente |  IA com YOLO (pegas/perdidas)  |  oráculo  |  parado');
for (let seed = 1; seed <= SEEDS; seed++) {
    const row = {};
    for (const player of ['yolo', 'oracle', 'idle']) {
        const { game, stats } = await play(seed, player);
        row[player] = game; total[player][0] += game.score; total[player][1] += game.missed;
        if (player === 'yolo') { for (const k of ['frames', 'truth', 'found', 'err', 'falsePos', 'ms']) agg[k] += stats[k]; for (const [l, c] of Object.entries(stats.labels)) agg.labels[l] = (agg.labels[l] || 0) + c; }
    }
    const f = g => `${g.score}/${g.missed} (${Math.round(g.score / Math.max(1, g.score + g.missed) * 100)}%)`;
    console.log(`  ${String(seed).padStart(3)}   |  ${f(row.yolo).padEnd(28)}  |  ${f(row.oracle).padEnd(11)}|  ${f(row.idle)}`);
}
const pct = ([c, m]) => `${Math.round(c / Math.max(1, c + m) * 100)}% (${c} de ${c + m})`;
console.log(`\nTOTAL   IA com YOLO: ${pct(total.yolo)} · oráculo: ${pct(total.oracle)} · parado: ${pct(total.idle)}`);
console.log(`\nPercepção do YOLO nos quadros do jogo (${agg.frames} quadros):`);
console.log(`  bolas inteiramente visíveis que o YOLO achou: ${agg.found} de ${agg.truth} (${Math.round(agg.found / Math.max(1, agg.truth) * 100)}%)`);
console.log(`  erro médio de posição: ${(agg.err / Math.max(1, agg.found)).toFixed(2)} px · detecções falsas por quadro: ${(agg.falsePos / Math.max(1, agg.frames)).toFixed(3)}`);
console.log(`  nomes que o YOLO deu à bola: ${Object.entries(agg.labels).sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l}×${c}`).join(', ') || '—'}`);
console.log(`  tempo médio por inferência em Node: ${(agg.ms / Math.max(1, agg.frames)).toFixed(1)} ms (no navegador varia com a GPU)`);
process.exit(0);
