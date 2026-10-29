// ====================================================================
// 🧠 Percepção: imagem → tensor → YOLO → centros dos objetos
// ====================================================================
// Script clássico (sem import/export), carregado com importScripts() no worker
// e lido pelos testes em Node. Não depende de nada do navegador: quem usa passa
// o `tf` (TensorFlow.js) e os labels. É o mesmo caminho do Duck Hunt:
//   preprocessImage → runInference → processPrediction
(function (root) {
    'use strict';

    /**
     * Filtra as predições (igual ao processPrediction do Duck Hunt, generalizado):
     *  - descarta score abaixo do limiar de confiança
     *  - se `accept` existir, só deixa passar os nomes de classe da lista
     *  - converte as coordenadas normalizadas (0 a 1) para pixels
     *  - devolve o CENTRO de cada caixa
     *
     * `accept = null` aceita qualquer classe. Isso é proposital: o YOLO do projeto é o
     * COCO genérico e chama a bola do jogo de "kite" ou "frisbee" (o nome é "errado",
     * mas a posição é precisa). Como só existem bolas na área do jogo, o nome não importa.
     */
    function* processPredictions({ boxes, scores, classes }, width, height, labels, threshold, accept) {
        for (let index = 0; index < scores.length; index++) {
            if (scores[index] < threshold) continue;

            const label = labels[classes[index]];
            if (accept && !accept.includes(label)) continue;

            let [x1, y1, x2, y2] = boxes.slice(index * 4, (index + 1) * 4);
            x1 *= width;
            x2 *= width;
            y1 *= height;
            y2 *= height;

            yield {
                x: x1 + (x2 - x1) / 2,
                y: y1 + (y2 - y1) / 2,
                w: x2 - x1,
                h: y2 - y1,
                score: scores[index],
                label,
            };
        }
    }

    /**
     * Carrega o modelo e devolve { detect(image3d) }.
     *  - tf: o TensorFlow.js (no navegador, `self.tf`; em Node, tfjs-node)
     *  - modelUrl: caminho do model.json
     *  - labels: array com os 80 nomes de classe
     */
    async function create(tf, { modelUrl, labels, threshold = 0.4, accept = null, inputSize = 640 }) {
        await tf.ready();
        const model = await tf.loadGraphModel(modelUrl);

        // aquecimento: uma inferência de mentira para as seguintes ficarem mais rápidas
        const dummy = tf.ones(model.inputs[0].shape);
        const warm = await model.executeAsync(dummy);
        [].concat(warm).forEach(t => t.dispose());
        tf.dispose(dummy);

        // tensor [H, W, 3] → [1, 640, 640, 3] com valores de 0 a 1
        // (tf.tidy descarta sozinho os tensores temporários)
        function preprocessImage(image3d) {
            return tf.tidy(() => tf.image
                .resizeBilinear(image3d, [inputSize, inputSize])
                .div(255)
                .expandDims(0));
        }

        async function runInference(tensor) {
            const output = await model.executeAsync(tensor);
            tf.dispose(tensor);
            // o modelo tem 4 saídas; as 3 primeiras são caixas, scores e classes
            const [boxes, scores, classes] = output.slice(0, 3);
            const [boxesData, scoresData, classesData] = await Promise.all([boxes.data(), scores.data(), classes.data()]);
            output.forEach(t => t.dispose());
            return { boxes: boxesData, scores: scoresData, classes: classesData };
        }

        // image3d: tensor [altura, largura, 3]. Quem chama é dono do tensor (e o descarta).
        async function detect(image3d) {
            const [height, width] = image3d.shape;
            const results = await runInference(preprocessImage(image3d));
            return [...processPredictions(results, width, height, labels, threshold, accept)];
        }

        return { detect, backend: tf.getBackend() };
    }

    root.CatchPerception = { create, processPredictions };
})(typeof self !== 'undefined' ? self : globalThis);
