// ====================================================================
// 🎯 Cérebro: das detecções do YOLO para "esquerda, direita ou parado"
// ====================================================================
// Script clássico (sem import/export), usado no navegador e nos testes.
//
// O YOLO só diz ONDE as bolas estão em cada print. Este arquivo faz o resto:
//  1. Rastreia cada bola de um print para o outro (qual é a mesma?)
//  2. Estima a velocidade (reta de mínimos quadrados nas últimas posições)
//  3. Prevê onde a bola vai estar quando chegar na raquete (inclusive os quiques
//     nas paredes) e já corrige o ATRASO: o print é de alguns milissegundos atrás
//  4. Escolhe a bola mais urgente e decide que "tecla" apertar
(function (root) {
    'use strict';

    // dobra x para dentro de [lo, hi], como uma bola quicando nas paredes
    function reflect(x, lo, hi) {
        const span = hi - lo;
        if (span <= 0) return lo;
        let u = (x - lo) % (2 * span);
        if (u < 0) u += 2 * span;
        return lo + (u <= span ? u : 2 * span - u);
    }

    // inclinação (velocidade) da reta que melhor passa pelos pontos { t, v }
    function slope(points) {
        const n = points.length;
        if (n < 2) return null;
        let mt = 0, mv = 0;
        for (const p of points) { mt += p.t; mv += p.v; }
        mt /= n; mv /= n;
        let num = 0, den = 0;
        for (const p of points) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) * (p.t - mt); }
        return den > 1e-9 ? num / den : null;
    }

    class Brain {
        constructor({
            gate = 70,          // distância máxima (px) para considerar que é a mesma bola
            maxAge = 0.5,       // segundos sem ver a bola até esquecê-la
            history = 5,        // quantas posições usar para estimar a velocidade
            fallGuess = 200,    // velocidade de queda (px/s) assumida para uma bola recém-vista
            deadband = 8,       // folga (px) para não ficar tremendo em volta do alvo
        } = {}) {
            Object.assign(this, { gate, maxAge, history, fallGuess, deadband });
            this.reset();
        }

        reset() {
            this.tracks = [];
            this.nextId = 1;
        }

        /** Chame a cada resultado do YOLO. `t` = instante do jogo em que o print foi tirado. */
        update(detections, t) {
            const used = new Set();
            const ordered = [...detections].sort((a, b) => b.score - a.score);
            for (const d of ordered) {
                let best = null, bestDist = Infinity;
                for (const tr of this.tracks) {
                    if (used.has(tr)) continue;
                    const dt = t - tr.last.t;
                    if (dt <= 0) continue; // resultado velho ou repetido
                    const px = tr.last.x + tr.vx * dt, py = tr.last.y + tr.vy * dt;
                    const dist = Math.hypot(d.x - px, d.y - py);
                    const limit = this.gate + Math.hypot(tr.vx, tr.vy) * dt * 0.5;
                    if (dist < limit && dist < bestDist) { best = tr; bestDist = dist; }
                }
                if (best) {
                    used.add(best);
                    best.obs.push({ t, x: d.x, y: d.y });
                    if (best.obs.length > this.history) best.obs.shift();
                    best.last = { t, x: d.x, y: d.y };
                    const vx = slope(best.obs.map(o => ({ t: o.t, v: o.x })));
                    const vy = slope(best.obs.map(o => ({ t: o.t, v: o.y })));
                    if (vx !== null) best.vx = Math.max(-800, Math.min(800, vx));
                    if (vy !== null) best.vy = Math.max(20, Math.min(900, vy)); // as bolas só caem
                    best.seen++;
                } else {
                    // bola nova na tela: começa a ser rastreada, supondo que cai a `fallGuess` px/s
                    const tr = { id: this.nextId++, obs: [{ t, x: d.x, y: d.y }], last: { t, x: d.x, y: d.y }, vx: 0, vy: this.fallGuess, seen: 1 };
                    used.add(tr);
                    this.tracks.push(tr);
                }
            }
            this.tracks = this.tracks.filter(tr => t - tr.last.t <= this.maxAge);
        }

        /**
         * Decide as "teclas" para o instante `now`.
         * paddle = { x (centro), y (topo), w }, world = { width, ballRadius }
         * Devolve { left, right, target } onde target = { x, tHit, id } ou null.
         */
        control(now, paddle, world) {
            const R = world.ballRadius;
            const catchY = paddle.y - R; // altura do centro da bola quando ela toca a raquete
            let target = null;
            for (const tr of this.tracks) {
                const dt = now - tr.last.t;
                const y = tr.last.y + tr.vy * dt;
                const x = tr.last.x + tr.vx * dt;
                const tHit = (catchY - y) / tr.vy;
                if (tHit < -0.12) continue; // já passou da raquete
                const wait = Math.max(0, tHit);
                const landX = reflect(x + tr.vx * wait, R, world.width - R);
                if (!target || wait < target.tHit) target = { x: landX, tHit: wait, id: tr.id };
            }
            if (!target) return { left: false, right: false, target: null };
            const dx = target.x - paddle.x;
            return { left: dx < -this.deadband, right: dx > this.deadband, target };
        }

        /** Cópia simples do que o cérebro "acredita", para desenhar na tela. */
        snapshot(now) {
            return this.tracks.map(tr => ({
                id: tr.id, seen: tr.seen, vx: tr.vx, vy: tr.vy,
                x: tr.last.x + tr.vx * (now - tr.last.t), y: tr.last.y + tr.vy * (now - tr.last.t),
            }));
        }
    }

    root.CatchLogic = { Brain, reflect, slope };
})(typeof self !== 'undefined' ? self : globalThis);
