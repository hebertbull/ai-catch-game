// ====================================================================
// 👷 Web Worker: roda o YOLO fora da thread principal
// ====================================================================
// A thread principal manda um print do jogo (ImageBitmap) e recebe de volta
// a lista de objetos encontrados, já com o centro em pixels.
//
//   principal → worker : { type: 'predict', image: ImageBitmap, t }
//   worker → principal : { type: 'status', state: 'loading' | 'ready' | 'error', ... }
//                        { type: 'detections', t, detections: [{ x, y, w, h, score, label }], ms }
//
// `t` é o instante do jogo em que o print foi tirado. Ele volta junto com o
// resultado, porque a inferência leva tempo: a IA precisa saber de quando é a
// posição que ela está vendo.

// versão FIXA do TensorFlow.js (no Duck Hunt era "@latest", que pode mudar sozinho)
const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';

importScripts(TF_URL, 'perception.js');

const MODEL_URL = '/model/model.json';
const LABELS_URL = '/model/labels.json';
const CONFIDENCE_THRESHOLD = 0.4;

let _detector = null;

async function load() {
    try {
        postMessage({ type: 'status', state: 'loading' });
        const labels = await (await fetch(LABELS_URL)).json();
        _detector = await CatchPerception.create(self.tf, {
            modelUrl: MODEL_URL,
            labels,
            threshold: CONFIDENCE_THRESHOLD,
            accept: null,
        });
        postMessage({ type: 'status', state: 'ready', backend: _detector.backend });
    } catch (error) {
        postMessage({ type: 'status', state: 'error', message: String(error && error.message || error) });
    }
}

self.onmessage = async ({ data }) => {
    if (data.type !== 'predict') return;
    if (!_detector) {
        // modelo ainda carregando: devolve vazio para a thread principal não ficar esperando
        if (data.image && data.image.close) data.image.close();
        postMessage({ type: 'detections', t: data.t, detections: [], ms: 0, skipped: true });
        return;
    }

    const startedAt = performance.now();
    const image = self.tf.browser.fromPixels(data.image);
    data.image.close(); // o bitmap já virou tensor: libera a memória dele
    try {
        const detections = await _detector.detect(image);
        postMessage({ type: 'detections', t: data.t, detections, ms: performance.now() - startedAt });
    } catch (error) {
        postMessage({ type: 'status', state: 'error', message: String(error && error.message || error) });
    } finally {
        image.dispose();
    }
};

load();
