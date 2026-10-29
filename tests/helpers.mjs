// Utilitários de teste: carregar os scripts do navegador em Node, desenhar pixels
// e achar o TensorFlow.js para Node.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Executa um script "clássico" (como os de src/) e devolve o objeto global que ele preencheu. */
export function loadClassic(relativePath) {
    const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    const fakeSelf = {};
    new Function('self', code)(fakeSelf);
    return fakeSelf;
}

export function loadAll() {
    const { CatchGame } = loadClassic('src/game.js');
    const { CatchLogic } = loadClassic('src/ai/logic.js');
    const { CatchPerception } = loadClassic('src/ai/perception.js');
    return { CatchGame, CatchLogic, CatchPerception };
}

/** Desenhista de pixels em Node: a mesma interface do canvas (clear, rect, circle). Sem suavização de bordas. */
export class RasterDraw {
    constructor(size = 640) {
        this.size = size;
        this.data = new Uint8Array(size * size * 3);
    }
    clear(c) { for (let i = 0; i < this.size * this.size; i++) this.data.set(c, i * 3); }
    rect(x, y, w, h, c) {
        const S = this.size;
        for (let j = Math.max(0, Math.round(y)); j < Math.min(S, Math.round(y + h)); j++)
            for (let i = Math.max(0, Math.round(x)); i < Math.min(S, Math.round(x + w)); i++) this.data.set(c, (j * S + i) * 3);
    }
    circle(cx, cy, r, c) {
        const S = this.size;
        for (let j = Math.max(0, Math.floor(cy - r)); j <= Math.min(S - 1, Math.ceil(cy + r)); j++)
            for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(S - 1, Math.ceil(cx + r)); i++)
                if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) this.data.set(c, (j * S + i) * 3);
    }
}

/**
 * Igual ao RasterDraw, mas SUAVIZA as bordas como o canvas do navegador:
 * desenha em resolução `k` vezes maior e depois tira a média de cada bloco k × k.
 */
export class SuperSampledDraw {
    constructor(size = 640, k = 4) {
        this.size = size; this.k = k;
        this.big = new RasterDraw(size * k);
    }
    clear(c) { this.big.clear(c); }
    rect(x, y, w, h, c) { const k = this.k; this.big.rect(x * k, y * k, w * k, h * k, c); }
    circle(cx, cy, r, c) { const k = this.k; this.big.circle(cx * k, cy * k, r * k, c); }
    get data() {
        const { size, k } = this, out = new Uint8Array(size * size * 3), big = this.big.data, B = size * k, n = k * k;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let r = 0, g = 0, b = 0;
            for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const o = ((y * k + j) * B + x * k + i) * 3; r += big[o]; g += big[o + 1]; b += big[o + 2]; }
            const o = (y * size + x) * 3; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
        }
        return out;
    }
}

/** TensorFlow.js para Node (só o teste com o YOLO precisa). Procura em TFJS_NODE_DIR ou no exemplo-00. */
export function loadTfNode() {
    const candidates = [process.env.TFJS_NODE_DIR, ROOT + '/', path.resolve(ROOT, '../exemplo-00') + '/'].filter(Boolean);
    for (const dir of candidates) {
        try { return createRequire(dir)('@tensorflow/tfjs-node'); } catch { /* tenta o próximo */ }
    }
    throw new Error('@tensorflow/tfjs-node não encontrado. Rode "npm i --no-save @tensorflow/tfjs-node" ou use TFJS_NODE_DIR=/pasta/que/tem/node_modules');
}
