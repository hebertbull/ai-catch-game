// ====================================================================
// 🎮 Pega-bola: regras do jogo e desenho
// ====================================================================
// Este arquivo é um script "clássico" (sem import/export) para rodar igual:
//  - no navegador (<script src="src/game.js">)
//  - em Node, nos testes (tests/helpers.mjs lê o texto e executa)
//
// O jogo NÃO desenha direto no canvas. Ele chama uma interface mínima:
//   draw.clear(cor) · draw.rect(x, y, w, h, cor) · draw.circle(x, y, r, cor)
// com cor = [r, g, b]. No navegador a interface usa o canvas; nos testes,
// um desenhista de pixels em Node. Assim dá para testar a IA com o modelo
// YOLO de verdade sem abrir um navegador.
//
// Importante para a IA: a tela só tem bolas (brancas, com manchas pretas),
// a raquete azul, o céu e a grama. Nada de texto na área do jogo: placar e
// vidas ficam no HTML, fora do canvas que a IA enxerga.
(function (root) {
    'use strict';

    const SIZE = 640; // 640 x 640 = o tamanho que o YOLO espera (sem distorcer)
    const GRASS_Y = 470;
    const COLORS = {
        sky: [135, 190, 235],
        grass: [110, 170, 100],
        paddle: [40, 90, 200],
        white: [255, 255, 255],
        ink: [20, 20, 20],
    };
    const BALL_RADIUS = 22;
    const PADDLE = { w: 110, h: 18, y: 560, speed: 420 };
    const MAX_BALLS = 4;
    const LIVES = 5;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // gerador pseudoaleatório com semente: o mesmo jogo pode ser repetido nos testes
    function makeRng(seed) {
        let a = (seed >>> 0) || 1;
        return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
    }

    class Game {
        constructor({ seed = 1, infiniteLives = false } = {}) {
            this.seed = seed;
            this.infiniteLives = infiniteLives;
            this.reset();
        }

        reset() {
            this.rng = makeRng(this.seed);
            this.time = 0;          // segundos de jogo
            this.score = 0;         // bolas pegas
            this.missed = 0;        // bolas perdidas
            this.lives = LIVES;
            this.over = false;
            this.balls = [];
            this.nextId = 1;
            this.spawnIn = 0.6;
            this.paddleX = SIZE / 2;
            this.keys = { left: false, right: false };
        }

        // As "teclas" são o único jeito de mexer na raquete, para a pessoa e para a IA
        setKeys({ left = false, right = false } = {}) {
            this.keys = { left: !!left, right: !!right };
        }

        get paddle() {
            return { x: this.paddleX, y: PADDLE.y, w: PADDLE.w, h: PADDLE.h };
        }

        spawn() {
            const r = this.rng;
            const speedUp = Math.min(220, 6 * this.score);
            this.balls.push({
                id: this.nextId++,
                x: BALL_RADIUS + 10 + r() * (SIZE - 2 * (BALL_RADIUS + 10)),
                y: -BALL_RADIUS,
                vx: (r() * 2 - 1) * Math.min(70, 20 + 2 * this.score),
                vy: (160 + speedUp) * (0.9 + 0.2 * r()),
            });
        }

        step(dt) {
            if (this.over) return;
            this.time += dt;

            // raquete
            const dir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
            this.paddleX = clamp(this.paddleX + dir * PADDLE.speed * dt, PADDLE.w / 2, SIZE - PADDLE.w / 2);

            // novas bolas
            this.spawnIn -= dt;
            if (this.spawnIn <= 0 && this.balls.length < MAX_BALLS) {
                this.spawn();
                this.spawnIn = Math.max(0.7, 1.5 - 0.03 * this.score) * (0.8 + 0.4 * this.rng());
            }

            // movimento (as bolas quicam nas paredes laterais)
            for (const b of this.balls) {
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                if (b.x < BALL_RADIUS) { b.x = BALL_RADIUS; b.vx = Math.abs(b.vx); }
                if (b.x > SIZE - BALL_RADIUS) { b.x = SIZE - BALL_RADIUS; b.vx = -Math.abs(b.vx); }
            }

            // pegou ou perdeu?
            for (const b of this.balls) {
                const touchesBand = b.y + BALL_RADIUS >= PADDLE.y && b.y - BALL_RADIUS <= PADDLE.y + PADDLE.h;
                if (touchesBand && Math.abs(b.x - this.paddleX) <= PADDLE.w / 2 + 6) {
                    b.done = 'caught';
                    this.score++;
                } else if (b.y - BALL_RADIUS > PADDLE.y + PADDLE.h) {
                    b.done = 'missed';
                    this.missed++;
                    if (!this.infiniteLives) this.lives--;
                }
            }
            this.balls = this.balls.filter(b => !b.done);
            if (this.lives <= 0) this.over = true;
        }
    }

    function drawBall(draw, x, y, r) {
        draw.circle(x, y, r, COLORS.white);
        // as manchas pretas fazem a bola parecer de futebol, e o YOLO a enxerga bem assim
        for (const [dx, dy] of [[0, 0], [-0.65, -0.4], [0.65, -0.4], [-0.45, 0.6], [0.45, 0.6]]) {
            draw.circle(x + dx * r, y + dy * r, Math.max(2, r * 0.24), COLORS.ink);
        }
    }

    function render(game, draw) {
        draw.clear(COLORS.sky);
        draw.rect(0, GRASS_Y, SIZE, SIZE - GRASS_Y, COLORS.grass);
        const p = game.paddle;
        draw.rect(p.x - p.w / 2, p.y, p.w, p.h, COLORS.paddle);
        for (const b of game.balls) drawBall(draw, b.x, b.y, BALL_RADIUS);
    }

    root.CatchGame = { Game, render, SIZE, BALL_RADIUS, PADDLE, COLORS, LIVES };
})(typeof self !== 'undefined' ? self : globalThis);
