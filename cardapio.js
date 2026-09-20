// /api/cardapio  —  Vercel Serverless Function
// GET  -> devolve o cardápio salvo (público)
// POST -> salva o cardápio (exige senha do painel)
//
// Variáveis de ambiente necessárias no Vercel:
//   ADMIN_PASSWORD                       (você escolhe a senha do painel)
//   KV_REST_API_URL + KV_REST_API_TOKEN  (criadas automaticamente ao conectar o Upstash Redis ao projeto)

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'dapaz:cardapio';

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis_error');
  return j.result;
}

function txt(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function numero(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function limpar(lista) {
  if (!Array.isArray(lista)) return null;
  const out = [];
  for (const i of lista.slice(0, 120)) {
    const nome = txt(i && i.nome, 80);
    if (!nome) continue;
    let foto = txt(i.foto, 200);
    if (foto && !/^(img\/|\/img\/|https?:\/\/)/i.test(foto)) foto = '';
    const q = numero(i.quantidade, 0, 9999);
    out.push({
      tipo: i.tipo === 'bolo' ? 'bolo' : 'pote',
      nome,
      descricao: txt(i.descricao, 300),
      preco: numero(i.preco, 0, 10000),
      quantidade: q === null ? null : Math.floor(q),
      foto,
      selo: txt(i.selo, 30),
      ativo: i.ativo !== false,
    });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      if (!REDIS_URL || !REDIS_TOKEN) return res.status(200).json({ itens: null, configurado: false });
      const raw = await redis(['GET', KEY]);
      let d = null;
      try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
      return res.status(200).json({
        itens: d && Array.isArray(d.itens) ? d.itens : null,
        atualizadoEm: d ? d.atualizadoEm : null,
        configurado: true,
      });
    }

    if (req.method === 'POST') {
      const senha = process.env.ADMIN_PASSWORD;
      if (!senha) return res.status(503).json({ erro: 'senha_nao_configurada' });
      if ((req.headers['x-admin-password'] || '') !== senha) return res.status(401).json({ erro: 'senha_incorreta' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};

      if (body.acao === 'login') return res.status(200).json({ ok: true });

      if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ erro: 'banco_nao_configurado' });
      const itens = limpar(body.itens);
      if (!itens) return res.status(400).json({ erro: 'dados_invalidos' });

      const atualizadoEm = new Date().toISOString();
      await redis(['SET', KEY, JSON.stringify({ itens, atualizadoEm })]);
      return res.status(200).json({ ok: true, atualizadoEm, total: itens.length });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ erro: 'metodo_nao_permitido' });
  } catch (e) {
    return res.status(500).json({ erro: 'falha_interna' });
  }
};
