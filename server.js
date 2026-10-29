// Servidor estático mínimo (sem dependências) para o Pega-bola.
//   npm start  →  http://localhost:3000
// Só serve index.html, src/ e model/. Escuta apenas na própria máquina.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_TOP = new Set(['index.html', 'src', 'model']);
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.bin': 'application/octet-stream',
    '.css': 'text/css; charset=utf-8',
};

/**
 * Converte o caminho da URL em um arquivo do disco, ou diz por que não pode.
 * Exportada para ser testada sem abrir porta.
 */
export function resolveStaticPath(pathname, root = ROOT) {
    let relative;
    try { relative = decodeURIComponent(pathname); } catch { return { status: 400 }; }
    if (relative.includes('\0')) return { status: 400 };
    if (relative === '/' ) relative = '/index.html';

    const absolute = path.resolve(root, '.' + relative);
    const fromRoot = path.relative(root, absolute);
    if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return { status: 404 };

    const parts = fromRoot.split(path.sep);
    if (!ALLOWED_TOP.has(parts[0]) || parts.some(p => p.startsWith('.'))) return { status: 404 };

    let stat;
    try { stat = fs.statSync(absolute); } catch { return { status: 404 }; }
    if (!stat.isFile()) return { status: 404 };
    return { status: 200, file: absolute, size: stat.size, type: MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream' };
}

export function createServer(root = ROOT) {
    return http.createServer((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD' });
            return res.end();
        }
        const { pathname } = new URL(req.url, 'http://localhost');
        const found = resolveStaticPath(pathname, root);
        if (found.status !== 200) {
            res.writeHead(found.status, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(found.status === 400 ? 'Pedido inválido' : 'Não encontrado');
        }
        res.writeHead(200, { 'Content-Type': found.type, 'Content-Length': found.size, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(found.file).pipe(res);
    });
}

// só sobe o servidor quando este arquivo é executado direto (e não quando é importado pelos testes)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const PORT = Number(process.env.PORT) || 3000;
    const server = createServer();
    server.on('error', error => {
        console.error(error.code === 'EADDRINUSE'
            ? `A porta ${PORT} já está em uso. Pare o outro servidor ou use: PORT=3001 npm start`
            : `Não foi possível iniciar o servidor: ${error.message}`);
        process.exit(1);
    });
    server.listen(PORT, '127.0.0.1', () => console.log(`Pega-bola em http://localhost:${PORT}`));
}
