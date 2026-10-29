// ====================================================================
// 🕹️ Thread principal: liga o jogo, a tela, o teclado e a IA
// ====================================================================
// Ciclo da IA (igual ao do Duck Hunt, com 2 melhorias):
//   a. createImageBitmap(canvas)          → print do jogo
//   b. worker.postMessage(bitmap)         → o YOLO roda no worker
//   c. worker devolve os centros          → brain.update(...)
//   d. brain.control(...)                 → "aperta ← ou →" (game.setKeys)
// Melhorias em relação ao Duck Hunt:
//   - só manda um print novo quando o anterior já foi respondido (sem fila)
//   - cada resultado volta com o instante `t` do print, e o cérebro corrige o atraso
(function () {
    'use strict';

    const { Game, render, SIZE, BALL_RADIUS } = CatchGame;
    const { Brain } = CatchLogic;
    const $ = id => document.getElementById(id);

    const canvas = $('game');
    const ctx = canvas.getContext('2d');
    const overlay = $('overlay');
    const octx = overlay.getContext('2d');

    // interface de desenho que o jogo usa (no teste em Node, é outra)
    const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
    const draw = {
        clear(c) { ctx.fillStyle = css(c); ctx.fillRect(0, 0, SIZE, SIZE); },
        rect(x, y, w, h, c) { ctx.fillStyle = css(c); ctx.fillRect(x, y, w, h); },
        circle(x, y, r, c) { ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); },
    };

    const STEP = 1 / 60;       // o jogo avança em passos fixos de 1/60 s
    const CAPTURE_MS = 100;    // a IA tenta tirar 10 prints por segundo
    const newSeed = () => (Math.random() * 1e9) | 0;

    const game = new Game({ seed: newSeed() });
    const brain = new Brain();
    const world = { width: SIZE, ballRadius: BALL_RADIUS };

    const state = {
        mode: 'manual',
        paused: false,
        keys: { left: false, right: false },
        renderedTime: 0,       // instante do jogo que está desenhado no canvas
        overAt: null,
        ai: { worker: null, state: 'off', message: '', backend: null, busy: false, busySince: 0,
              frames: 0, ms: null, dets: [], control: { left: false, right: false, target: null } },
    };

    // ---------- worker da IA ----------
    function startWorker() {
        if (state.ai.worker) return;
        setAiStatus('loading', 'carregando o modelo YOLO…');
        let worker;
        try {
            worker = new Worker('src/ai/worker.js');
        } catch (error) {
            setAiStatus('error', `não foi possível criar o worker: ${error.message}`);
            return;
        }
        state.ai.worker = worker;
        worker.onmessage = ({ data }) => {
            const ai = state.ai;
            if (data.type === 'status') {
                if (data.backend) ai.backend = data.backend;
                setAiStatus(data.state, data.state === 'ready' ? 'pronta: vendo a tela' : data.state === 'error' ? `erro: ${data.message}` : 'carregando o modelo YOLO…');
                if (data.state === 'error') ai.busy = false;
            } else if (data.type === 'detections') {
                ai.busy = false;
                if (data.skipped) return; // modelo ainda não estava pronto
                ai.frames++;
                ai.ms = ai.ms === null ? data.ms : 0.8 * ai.ms + 0.2 * data.ms;
                ai.dets = data.detections;
                brain.update(data.detections, data.t);
            }
        };
        worker.onerror = event => {
            state.ai.busy = false;
            setAiStatus('error', `erro no worker: ${event.message || 'veja o console'} (precisa de internet para baixar o TensorFlow.js)`);
        };
    }

    function setAiStatus(s, message) {
        state.ai.state = s;
        state.ai.message = message;
        $('ai-status').textContent = message;
        $('ai-status').className = 'status' + (s === 'error' ? ' err' : '');
    }

    async function captureTick() {
        const ai = state.ai;
        if (state.mode !== 'ai' || state.paused || game.over || document.hidden || !ai.worker) return;
        if (ai.state === 'error') return;
        if (ai.busy && performance.now() - ai.busySince < 3000) return; // ainda esperando o YOLO
        ai.busy = true;
        ai.busySince = performance.now();
        try {
            const t = state.renderedTime; // o instante que está desenhado agora
            const bitmap = await createImageBitmap(canvas);               // (a) print
            ai.worker.postMessage({ type: 'predict', image: bitmap, t }, [bitmap]); // (b) manda ao worker
        } catch (error) {
            ai.busy = false;
            setAiStatus('error', `falha ao capturar a tela: ${error.message}`);
        }
    }
    setInterval(captureTick, CAPTURE_MS);

    // ---------- modos e controles ----------
    function setMode(mode) {
        state.mode = mode;
        $('btn-manual').className = mode === 'manual' ? 'on' : '';
        $('btn-ai').className = mode === 'ai' ? 'on' : '';
        brain.reset();
        state.ai.dets = [];
        game.setKeys();
        if (mode === 'ai') {
            startWorker();
            if (state.ai.state === 'off') setAiStatus('loading', 'carregando o modelo YOLO…');
        } else {
            $('ai-status').textContent = 'IA desligada';
            $('ai-status').className = 'status';
        }
    }

    function restart() {
        game.seed = newSeed();
        game.reset();
        brain.reset();
        state.ai.dets = [];
        state.overAt = null;
    }

    function setPaused(p) {
        state.paused = p;
        $('btn-pause').textContent = p ? '▶ Continuar' : '⏸ Pausar';
    }

    $('btn-manual').addEventListener('click', () => setMode('manual'));
    $('btn-ai').addEventListener('click', () => setMode('ai'));
    $('btn-restart').addEventListener('click', restart);
    $('btn-pause').addEventListener('click', () => setPaused(!state.paused));

    const KEY_LEFT = new Set(['ArrowLeft', 'a', 'A']);
    const KEY_RIGHT = new Set(['ArrowRight', 'd', 'D']);
    window.addEventListener('keydown', e => {
        if (KEY_LEFT.has(e.key)) { state.keys.left = true; e.preventDefault(); }
        else if (KEY_RIGHT.has(e.key)) { state.keys.right = true; e.preventDefault(); }
        else if (e.key === 'p' || e.key === 'P') setPaused(!state.paused);
    });
    window.addEventListener('keyup', e => {
        if (KEY_LEFT.has(e.key)) state.keys.left = false;
        else if (KEY_RIGHT.has(e.key)) state.keys.right = false;
    });

    // ---------- (d) ação: quem aperta as "teclas" ----------
    function applyControls() {
        if (state.mode === 'ai') {
            const out = brain.control(game.time, game.paddle, world);
            state.ai.control = out;
            game.setKeys(out);
        } else {
            game.setKeys(state.keys);
        }
    }

    // ---------- o que a IA vê (camada separada: NÃO entra no print que o YOLO analisa) ----------
    function drawOverlay() {
        octx.clearRect(0, 0, SIZE, SIZE);
        if (state.mode !== 'ai' || !$('chk-vision').checked) return;
        octx.lineWidth = 2;
        octx.font = '13px system-ui, sans-serif';
        for (const d of state.ai.dets) {
            octx.strokeStyle = '#ff8a00';
            octx.strokeRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
            octx.beginPath();
            octx.moveTo(d.x - 7, d.y); octx.lineTo(d.x + 7, d.y);
            octx.moveTo(d.x, d.y - 7); octx.lineTo(d.x, d.y + 7);
            octx.stroke();
            octx.fillStyle = '#ff8a00';
            octx.fillText(`${d.label} ${Math.round(d.score * 100)}%`, d.x - d.w / 2, d.y - d.h / 2 - 4);
        }
        octx.strokeStyle = '#ffffff';
        for (const tr of brain.snapshot(game.time)) {
            octx.beginPath();
            octx.arc(tr.x, tr.y, BALL_RADIUS + 5, 0, Math.PI * 2);
            octx.stroke();
        }
        const target = state.ai.control.target;
        if (target) {
            const p = game.paddle;
            octx.setLineDash([6, 5]);
            octx.strokeStyle = '#00d084';
            octx.beginPath();
            octx.moveTo(target.x, 0); octx.lineTo(target.x, p.y);
            octx.stroke();
            octx.setLineDash([]);
            octx.fillStyle = '#00d084';
            octx.fillRect(target.x - 4, p.y - 6, 8, 6);
        }
    }

    function updateHud() {
        $('h-score').textContent = game.score;
        $('h-missed').textContent = game.missed;
        $('h-lives').textContent = game.lives;
        $('h-time').textContent = game.time.toFixed(1).replace('.', ',') + ' s';
        const ai = state.ai, on = state.mode === 'ai';
        $('h-backend').textContent = ai.backend || '–';
        $('h-frames').textContent = on ? ai.frames : '–';
        $('h-ms').textContent = on && ai.ms !== null ? Math.round(ai.ms) + ' ms' : '–';
        $('h-dets').textContent = on ? ai.dets.length : '–';
        $('h-tracks').textContent = on ? brain.tracks.length : '–';
        $('h-key').textContent = !on ? '–' : ai.control.left ? '←' : ai.control.right ? '→' : 'parado';
        $('banner').textContent = game.over ? `Fim de jogo · ${game.score} bolas pegas` : state.paused ? 'Pausado' : '';
    }

    // ---------- laço principal ----------
    let last = performance.now(), acc = 0;
    function frame(now) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!state.paused) {
            acc += dt;
            while (acc >= STEP) { applyControls(); game.step(STEP); acc -= STEP; }
        }
        render(game, draw);
        state.renderedTime = game.time;
        drawOverlay();
        updateHud();

        if (game.over) {
            if (state.overAt === null) state.overAt = now;
            if (state.mode === 'ai' && $('chk-auto').checked && now - state.overAt > 2000) restart();
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
