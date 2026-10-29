# Pega-bola: uma IA que joga vendo a tela

Solução do **desafio da Aula 5 da Unidade 4** ("hackeie outro jogo"): um jogo de navegador
simples e uma IA que o joga sozinha, aplicando os mesmos conceitos do Duck Hunt.

Bolas de futebol caem do céu e você move a raquete azul com `←` `→` (ou `A` `D`) para pegá-las.
Ou aperte **🤖 IA** e deixe que ela jogue, enxergando só os pixels da tela.

## Como rodar

```
npm start          # servidor estático, sem dependências  →  http://localhost:3000
```

- Precisa de **internet**: o TensorFlow.js (versão fixa 4.22.0) vem de um CDN dentro do worker.
- Sirva a pasta por HTTP; não abra o `index.html` com duplo clique (o worker e o modelo são carregados por URL).
- Se a porta 3000 estiver ocupada: `PORT=3001 npm start`.
- O botão **IA** mostra o status do modelo, o backend do TensorFlow.js (`webgl`, no ideal), o tempo de inferência e, em
  cima do jogo, o que ela vê: caixas laranja com o nome que o YOLO deu, círculos brancos nas bolas rastreadas e a
  linha verde onde ela pretende pegar a bola. Essa camada fica **fora** do print que o YOLO analisa.

## Os 4 passos do desafio

| Passo | Onde |
|---|---|
| **a.** captura da tela com `createImageBitmap` | `src/main.js` (`captureTick`) |
| **b.** processamento com o modelo YOLO | `src/ai/worker.js` + `src/ai/perception.js` (`preprocessImage`, `runInference`) |
| **c.** conversão das predições em coordenadas | `processPredictions` em `src/ai/perception.js` (centro de cada caixa) |
| **d.** geração de ações automáticas | `src/ai/logic.js` (`Brain.control`) → `game.setKeys`, as mesmas "teclas" do jogador |

O que a IA faz além do Duck Hunt:

- **Só manda um print novo quando o anterior foi respondido** (sem fila de prints).
- **Cada resultado volta com o instante do print.** A inferência leva tempo, então a posição já está velha quando chega.
  O cérebro estima a velocidade de cada bola (reta de mínimos quadrados nas últimas posições), prevê onde ela
  chega à raquete (inclusive os quiques nas paredes) e já desconta o atraso.
- **Rastreia as bolas** de um print para o outro, então um quadro em que o YOLO não vê a bola não derruba a IA.
- O worker usa o TensorFlow.js com **versão fixa**, libera o `ImageBitmap` com `close()` e descarta os tensores.

## Por que uma bola de futebol? (o ponto mais importante)

O modelo é o **YOLOv5n do COCO, genérico (80 classes)**. Ele não conhece o seu jogo: só enxerga o que se parece com
alguma dessas classes. Testei o modelo real com sprites desenhados:

- Ele acha a **posição** com erro de ~1 px, mas erra o **nome**: a bola vira `kite` (como os patos do Duck Hunt),
  outras formas viram `frisbee` ou `airplane`. Para o jogo basta posição + rótulo estável, por isso o worker aceita
  qualquer classe (`accept: null`); a tela só tem bolas.
- A bola **branca com manchas pretas** foi a mais confiável (87 a 100% de detecção, de raio 14 a 48 px). Bolas lisas
  vermelhas ou laranja falham bastante quando pequenas. Uma garrafa retangular não foi detectada.
- Por isso jogos de cactos, canos ou blocos retangulares (Dino do Chrome, Flappy Bird) **não funcionariam** com este
  modelo sem treiná-lo com classes novas. Esse é o "estendendo o modelo" da Aula 5.

Para adaptar a outro jogo: desenhe os alvos de forma que o YOLO os veja, ajuste `accept` se houver mais de um tipo de
objeto, e troque o `Brain` pela lógica de ação do seu jogo.

## Testes

```
npm test           # 43 verificações, sem YOLO: regras do jogo, cérebro, servidor e o main.js num "navegador falso"
npm run test:e2e   # ciclo fechado com o YOLO de verdade, em Node
```

O `test:e2e` precisa do `@tensorflow/tfjs-node` (`npm i --no-save @tensorflow/tfjs-node`, ou
`TFJS_NODE_DIR=/pasta/com/node_modules`). Ele joga partidas inteiras: desenha o quadro, roda o YOLO, decide, aperta a
tecla e compara com um "oráculo" (que recebe as posições exatas) e com "ficar parado". Variáveis: `SECONDS`, `SEEDS`,
`LATENCY_STEPS` (6 = 100 ms), `AA=1` (bordas suavizadas como no canvas do navegador), `ACCEPT=person` (controle
negativo: a IA fica cega).

Resultados medidos (4 partidas de 60 s, 10 prints por segundo, atraso de 100 ms):

| Jogador | Bolas pegas |
|---|---|
| IA com YOLO (pixels duros) | 92% (236 de 257) |
| IA com YOLO (bordas suavizadas) | 91% (229 de 252) |
| Oráculo (posições exatas) | 92% |
| Parado | 26% |
| IA cega (controle negativo) | 26%, igual a parado |

Nos quadros do jogo, o YOLO achou 85% das bolas (68% com bordas suavizadas) com erro médio de ~0,8 px e menos de 0,06
detecção falsa por quadro. Mesmo com atraso de 500 ms a IA pegou 95%. As ~8% de bolas perdidas vêm de duas bolas chegando
juntas em pontos distantes, não da percepção.

## Medido no navegador

Numa partida de ~26 s com a IA (backend `webgl`): inferência de **80 ms** por print, ~9 prints por segundo e
**17 bolas pegas de 19 (89%)**, dentro da faixa dos testes em Node (91 a 92%). É uma partida só, então o número varia
bastante de jogo para jogo.

Dá para ver a compensação do atraso no próprio jogo: a caixa laranja (a última detecção do YOLO) fica uns 45 px atrás da
bola, porque vem de um print de ~180 ms antes (espera pelo próximo print + inferência), enquanto o círculo branco (a
posição estimada pelo cérebro) fica em cima da bola.

## O que NÃO foi verificado

- Só uma partida curta no navegador; as taxas acima (~92%) vêm das simulações em Node.
- Os quadros do teste em Node são desenhados por mim (cores chapadas, 640 × 640). O canvas real pode diferir um pouco;
  por isso simulei a suavização de bordas, mas não é igual.
- Nenhum jogo de terceiros foi testado.

## Limite conhecido

O cérebro escolhe a bola **mais urgente**, mesmo quando não dá tempo de chegar nela (a raquete anda 420 px/s). Quando duas
bolas chegam juntas em pontos distantes, ele pode correr atrás da errada. Uma melhoria possível é escolher a mais urgente
**entre as alcançáveis**.

## Estrutura

```
index.html            página (placar fora do canvas, para não aparecer no print da IA)
server.js             servidor estático sem dependências (só serve index.html, src/ e model/)
src/game.js           regras e desenho do jogo (a mesma lógica no navegador e nos testes)
src/main.js           laço do jogo, teclado, captura de tela e ligação com o worker
src/ai/worker.js      Web Worker: carrega o YOLO e responde aos prints
src/ai/perception.js  imagem → tensor → YOLO → centros das caixas
src/ai/logic.js       rastreamento, previsão e decisão (esquerda, direita, parado)
model/                YOLOv5n convertido para TensorFlow.js (cópia do projeto Duck Hunt)
tests/                testes
```

O modelo (`model/`, ~7,5 MB) veio do template do Duck Hunt do curso. É um YOLOv5, então confira a licença do
YOLOv5/Ultralytics antes de redistribuí-lo.
