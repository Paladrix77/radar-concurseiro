// Radar do Concurseiro — Worker do Cloudflare (arquivo único)
// Bindings: DB (D1). Secrets: TELEGRAM_TOKEN, ADMIN_KEY. Vars: BOT_USERNAME, MONITOR_URL (opcional)

// ---------- Fontes (páginas das bancas) ----------
// Cada fonte lista concursos como links. `padrao` testa o caminho do link.
// Se uma banca mudar o site, é só ajustar aqui. O painel /api/fontes mostra quantos links cada uma achou.
export const FONTES = [
  { id: 'cebraspe-abertas', banca: 'Cebraspe', url: 'https://www.cebraspe.org.br/concursos/inscricoes-abertas', situacao: 'abertas',
    padrao: /^\/concursos\/([a-z0-9_]+)\/?$/i, ignorar: ['inscricoes-abertas', 'em-andamento', 'encerrados', 'previstos'] },
  { id: 'cebraspe-todos', banca: 'Cebraspe', url: 'https://www.cebraspe.org.br/concursos/', situacao: 'andamento',
    padrao: /^\/concursos\/([a-z0-9_]+)\/?$/i, ignorar: ['inscricoes-abertas', 'em-andamento', 'encerrados', 'previstos'] },
  { id: 'fgv', banca: 'FGV', url: 'https://conhecimento.fgv.br/concursos', situacao: 'andamento',
    padrao: /^\/concursos\/([a-z0-9-]+)\/?$/i, ignorar: ['abertos', 'andamento', 'encerrados'] },
  { id: 'fcc', banca: 'FCC', url: 'https://www.concursosfcc.com.br/concursos/', situacao: 'andamento',
    padrao: /^\/concursos\/([a-z0-9]+)\/(?:index\.html?)?$/i, ignorar: ['jsp'] },
  { id: 'vunesp-abertas', banca: 'Vunesp', url: 'https://www.vunesp.com.br/busca/concurso/inscricoes%20abertas', situacao: 'abertas',
    padrao: /^\/([A-Z]{2,}[0-9]{4})\/?$/, ignorar: [] },
  { id: 'vunesp-andamento', banca: 'Vunesp', url: 'https://www.vunesp.com.br/busca/concurso/em%20andamento', situacao: 'andamento',
    padrao: /^\/([A-Z]{2,}[0-9]{4})\/?$/, ignorar: [] },
  { id: 'vunesp', banca: 'Vunesp', url: 'https://www.vunesp.com.br/', situacao: 'andamento',
    padrao: /^\/([A-Z]{2,}[0-9]{4})\/?$/, ignorar: [] },
];

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const ESTADOS = Object.entries({ MS: 'mato grosso do sul', MT: 'mato grosso', RS: 'rio grande do sul', RN: 'rio grande do norte',
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara', DF: 'distrito federal', ES: 'espirito santo',
  GO: 'goias', MA: 'maranhao', MG: 'minas gerais', PA: 'para)', PB: 'paraiba', PR: 'parana', PE: 'pernambuco', PI: 'piaui',
  RJ: 'rio de janeiro', RO: 'rondonia', RR: 'roraima', SC: 'santa catarina', SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins' });
const TEXTOS_GENERICOS = /^(saiba mais|clique aqui|acesse|ver mais|mais|detalhes|\+|inscreva-se|inscri[cç][aã]o)$/i;
const PALAVRAS_DOC = /(edital|retifica|resultado|gabarito|convoca|comunicado|homologa|aviso|cronograma|nomea|prova|recurso|local)/i;
const HEADERS_NAVEGADOR = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

// ---------- utilidades ----------
const agora = () => new Date().toISOString();
const horaBrasilia = (d = new Date()) => (d.getUTCHours() + 21) % 24;
const hojeBrasilia = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const tirarTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export function extrairLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let url;
    try { url = new URL(m[1].trim(), base); } catch { continue; }
    out.push({ url, texto: tirarTags(m[2]) });
  }
  return out;
}

function bonitoDoSlug(slug) {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\d{2}\b$/, (a) => '20' + a).toUpperCase();
}

export function detectarUF(slug, nome) {
  for (const t of slug.split(/[_-]+/)) if (UFS.has(t.toUpperCase())) return t.toUpperCase();
  for (const t of nome.split(/[\s/–-]+/)) if (t.length === 2 && t === t.toUpperCase() && UFS.has(t)) return t;
  const n = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [uf, est] of ESTADOS) if (n.includes(est)) return uf;
  return null;
}

// Lê a página de uma fonte e devolve os concursos achados
export function lerFonte(fonte, html) {
  const host = new URL(fonte.url).host;
  const achados = new Map();
  for (const { url, texto } of extrairLinks(html, fonte.url)) {
    if (url.host !== host) continue;
    const m = url.pathname.match(fonte.padrao);
    if (!m) continue;
    const slug = m[1];
    if (fonte.ignorar.includes(slug.toLowerCase())) continue;
    const id = `${fonte.banca.toLowerCase()}:${slug.toLowerCase()}`;
    const bom = texto && texto.length >= 4 && texto.length <= 160 && !TEXTOS_GENERICOS.test(texto);
    const atual = achados.get(id);
    const nome = bom ? texto : null;
    if (!atual) achados.set(id, { id, banca: fonte.banca, slug, url: url.origin + url.pathname, nome });
    else if (nome && (!atual.nome || nome.length > atual.nome.length)) atual.nome = nome;
  }
  return [...achados.values()].map((c) => {
    const nome = c.nome || bonitoDoSlug(c.slug);
    return { id: c.id, banca: c.banca, url: c.url, nome, uf: detectarUF(c.slug, nome), situacao: fonte.situacao };
  });
}

// Documentos (PDFs, editais, resultados) na página de um concurso
export function lerDocumentos(html, base) {
  const docs = new Map();
  for (const { url, texto } of extrairLinks(html, base)) {
    const href = url.href;
    const ehPdf = /\.pdf($|\?)/i.test(url.pathname) || /download|arquivo|anexo/i.test(url.pathname);
    if (!ehPdf && !PALAVRAS_DOC.test(texto)) continue;
    if (!ehPdf && url.pathname === new URL(base).pathname) continue;
    if (!docs.has(href)) docs.set(href, { url: href, texto: texto || decodeURIComponent(url.pathname.split('/').pop()) });
  }
  return [...docs.values()];
}

// Busca do DOU: a página de consulta traz os resultados num JSON dentro de um <script>
export function urlBuscaDOU(termo) {
  const q = encodeURIComponent(`"${termo}"`);
  return `https://www.in.gov.br/consulta/-/buscar/dou?q=${q}&s=todos&exactDate=dia&sortType=0`;
}
export function lerBuscaDOU(html) {
  const m = html.match(/<script[^>]*id=["'][^"']*params["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null; // null = formato da página mudou
  let dados;
  try { dados = JSON.parse(m[1]); } catch { return null; }
  const lista = dados.jsonArray || [];
  return lista.map((it) => ({
    titulo: tirarTags(it.title || 'Publicação no DOU'),
    url: it.urlTitle ? `https://www.in.gov.br/web/dou/-/${it.urlTitle}` : 'https://www.in.gov.br/',
    trecho: tirarTags(it.content || it.abstract || '').slice(0, 400),
    secao: it.pubName || '',
    orgao: tirarTags(it.hierarchyStr || ''),
    data: it.pubDate || '',
    tipo: it.artType || '',
  }));
}

// ---------- Telegram ----------
async function telegram(env, metodo, corpo) {
  if (!env.TELEGRAM_TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${metodo}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  return r.json().catch(() => null);
}
const enviar = (env, chatId, html) => !env.TELEGRAM_TOKEN ? null : telegram(env, 'sendMessage',
  { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });

// ---------- Robô ----------
// Lê o corpo respeitando o charset (a FCC usa ISO-8859-1)
export async function lerTexto(r) {
  const buf = await r.arrayBuffer();
  const ct = r.headers.get('content-type') || '';
  let cs = (ct.match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) {
    const cabeca = new TextDecoder('latin1').decode(buf.slice(0, 3000));
    cs = (cabeca.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  }
  cs = cs.toLowerCase();
  if (cs === 'iso-8859-1' || cs === 'latin1') cs = 'windows-1252';
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

class Orcamento { // o plano grátis permite ~50 requisições externas por execução
  constructor(n) { this.n = n; }
  pode() { return this.n > 0; }
  async fetch(url, init = {}) {
    this.n--;
    return fetch(url, { ...init, headers: { ...HEADERS_NAVEGADOR, ...(init.headers || {}) }, redirect: 'follow', cf: { cacheTtl: 0 } });
  }
}

async function estado(env, chave, valor) {
  if (valor === undefined) {
    const r = await env.DB.prepare('SELECT valor FROM estado WHERE chave=?').bind(chave).first();
    return r ? r.valor : null;
  }
  await env.DB.prepare('INSERT INTO estado(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor')
    .bind(chave, valor).run();
}

// Guarda um resumo da página baixada, para ajustar as fontes sem precisar abrir o site
async function guardarAmostra(env, fonteId, r, html) {
  try {
    const titulo = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const host = new URL(r.url).host;
    const caminhos = [];
    for (const { url, texto } of extrairLinks(html, r.url)) {
      if (url.host !== host) continue;
      const k = url.pathname + url.search + ' | ' + texto.slice(0, 60);
      if (!caminhos.includes(k)) caminhos.push(k);
      if (caminhos.length >= 150) break;
    }
    const amostra = { status: r.status, url_final: r.url, tamanho: html.length, titulo: tirarTags(titulo),
      inicio: caminhos.length ? undefined : html.slice(0, 1500), links: caminhos };
    await env.DB.prepare('INSERT INTO fontes_log(fonte,quando,links,amostra) VALUES(?,?,0,?) ON CONFLICT(fonte) DO UPDATE SET amostra=excluded.amostra')
      .bind(fonteId, agora(), JSON.stringify(amostra)).run();
  } catch {}
}

// Quando uma página é montada por JavaScript, procura de onde ela puxa os dados (APIs, JSON)
async function espiar(env, orc, id, base, html) {
  try {
    if (orc.n < 8) return;
    const pegar = (re, txt, max) => { const out = []; let m; while ((m = re.exec(txt)) && out.length < max) if (!out.includes(m[1])) out.push(m[1]); return out; };
    const scripts = pegar(/<script[^>]*\bsrc=["']([^"']+)["']/gi, html, 120).map((u) => { try { return new URL(u, base).href; } catch { return null; } }).filter(Boolean);
    const ids = pegar(/<script[^>]*\bid=["']([^"']+)["']/gi, html, 30);
    const trechos = [];
    for (const k of ['jsonArray', 'urlTitle', '/api/', 'api.', '.json', 'ajax', 'fetch(', 'resultado']) {
      let i = html.indexOf(k), n = 0;
      while (i >= 0 && n < 2) { trechos.push(k + ' => ' + html.slice(Math.max(0, i - 200), i + 300)); i = html.indexOf(k, i + 1); n++; }
    }
    const host = new URL(base).host;
    const enfeite = /jquery|layerslider|revslider|gtag|googletag|wp-a11y|qode|plugins|greensock|analytics|recaptcha/i;
    const daMesmaCasa = scripts.filter((u) => (new URL(u).host === host || /cebraspe|in\.gov/.test(u)) && !enfeite.test(u))
      .sort((a, b) => (/static\/js|main|bundle|app|chunk|runtime/i.test(b) ? 1 : 0) - (/static\/js|main|bundle|app|chunk|runtime/i.test(a) ? 1 : 0));
    const apis = [];
    // scripts inline com configuração
    for (const x of pegar(/<script(?![^>]*src)[^>]*>([\s\S]{20,4000}?)<\/script>/gi, html, 20)) if (/api|url|endpoint|config/i.test(x) && !/gtag|uiAutocomplete/.test(x)) trechos.push('inline => ' + x.slice(0, 600));
    for (const u of daMesmaCasa.slice(0, 5)) {
      if (orc.n < 5) break;
      const r = await orc.fetch(u);
      const js = await r.text();
      for (const x of pegar(/["'`](https?:\/\/[^"'`\s]{6,200})["'`]/g, js, 80)) if (/api|json|servic|concurso|busca/i.test(x)) apis.push(x);
      for (const x of pegar(/["'`](\/?[a-zA-Z0-9_\-\/]*(?:api|Api|json|servic|concurso|Concurso)[a-zA-Z0-9_\-\/{}.?=&]*)["'`]/g, js, 120)) apis.push(x);
      for (const k of ['apis.', 'eventos', 'axios', 'fetch(']) {
        let i = js.indexOf(k), n = 0;
        while (i >= 0 && n < 4) { trechos.push('js ' + k + ' => ' + js.slice(Math.max(0, i - 250), i + 450)); i = js.indexOf(k, i + 1); n++; }
      }
    }
    // chama as APIs encontradas e guarda o começo da resposta
    const respostas = [];
    for (const u of [...new Set(apis)].filter((x) => /^https:\/\/apis?\./.test(x)).slice(0, 4)) {
      if (orc.n < 3) break;
      try { const r = await orc.fetch(u, { headers: { accept: 'application/json, text/plain, */*' } }); respostas.push({ u, status: r.status, ct: r.headers.get('content-type'), corpo: (await r.text()).slice(0, 3000) }); }
      catch (e) { respostas.push({ u, erro: String(e.message || e) }); }
    }
    const amostra = { base, scripts: daMesmaCasa, ids, respostas, trechos: trechos.filter((t) => t.startsWith('js ')).slice(0, 16), apis: [...new Set(apis)].slice(0, 150) };
    await env.DB.prepare('INSERT INTO fontes_log(fonte,quando,links,amostra) VALUES(?,?,0,?) ON CONFLICT(fonte) DO UPDATE SET quando=excluded.quando, amostra=excluded.amostra')
      .bind('espiar:' + id, agora(), JSON.stringify(amostra)).run();
  } catch (e) {
    await env.DB.prepare('INSERT INTO fontes_log(fonte,quando,links,erro) VALUES(?,?,0,?) ON CONFLICT(fonte) DO UPDATE SET erro=excluded.erro')
      .bind('espiar:' + id, agora(), String(e.message || e)).run();
  }
}

async function rodarFontes(env, orc, log) {
  const vistosAgora = new Map();
  for (const fonte of FONTES) {
    if (!orc.pode()) break;
    try {
      const r = await orc.fetch(fonte.url);
      const html = await lerTexto(r);
      await guardarAmostra(env, fonte.id, r, html);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lista = lerFonte(fonte, html);
      if (!lista.length) await espiar(env, orc, fonte.id, r.url, html);
      for (const c of lista) {
        const ja = vistosAgora.get(c.id);
        if (!ja || c.situacao === 'abertas') vistosAgora.set(c.id, { ...(ja || {}), ...c, nome: ja && ja.nome.length > c.nome.length ? ja.nome : c.nome });
      }
      await env.DB.prepare('INSERT INTO fontes_log(fonte,quando,links,erro) VALUES(?,?,?,NULL) ON CONFLICT(fonte) DO UPDATE SET quando=excluded.quando,links=excluded.links,erro=NULL')
        .bind(fonte.id, agora(), lista.length).run();
      log.push(`${fonte.id}: ${lista.length} concursos`);
    } catch (e) {
      await env.DB.prepare('INSERT INTO fontes_log(fonte,quando,links,erro) VALUES(?,?,0,?) ON CONFLICT(fonte) DO UPDATE SET quando=excluded.quando,erro=excluded.erro')
        .bind(fonte.id, agora(), String(e.message || e)).run();
      log.push(`${fonte.id}: ERRO ${e.message || e}`);
    }
  }

  const novos = [];
  const t = agora();
  for (const c of vistosAgora.values()) {
    const ex = await env.DB.prepare('SELECT id, situacao FROM concursos WHERE id=?').bind(c.id).first();
    if (!ex) {
      await env.DB.prepare('INSERT INTO concursos(id,banca,nome,url,situacao,uf,primeiro_visto,ultimo_visto) VALUES(?,?,?,?,?,?,?,?)')
        .bind(c.id, c.banca, c.nome, c.url, c.situacao, c.uf, t, t).run();
      novos.push(c);
    } else {
      await env.DB.prepare('UPDATE concursos SET nome=?, situacao=?, uf=COALESCE(?,uf), ultimo_visto=? WHERE id=?')
        .bind(c.nome, c.situacao, c.uf, t, c.id).run();
      if (ex.situacao !== 'abertas' && c.situacao === 'abertas') {
        await avisarConcurso(env, c.id, `📝 Inscrições abertas: <b>${escHtml(c.nome)}</b> (${c.banca})`, c.url, 'inscricoes', orc);
      }
    }
  }

  // Na primeira vez que uma banca é lida, tudo é "novo": só grava, sem avisar.
  const porBanca = {};
  for (const c of novos) (porBanca[c.banca] ||= []).push(c);
  for (const [banca, lista] of Object.entries(porBanca)) {
    if (!(await estado(env, `base:${banca}`))) { await estado(env, `base:${banca}`, t); log.push(`${banca}: base inicial com ${lista.length}`); continue; }
    for (const c of lista) {
      await env.DB.prepare('INSERT INTO eventos(tipo,concurso_id,token,titulo,url,criado) VALUES(?,?,NULL,?,?,?)')
        .bind('novo_concurso', c.id, `Novo concurso na ${c.banca}: ${c.nome}`, c.url, t).run();
      const users = env.TELEGRAM_TOKEN ? await env.DB.prepare('SELECT chat_id FROM usuarios WHERE avisar_novos=1 AND chat_id IS NOT NULL').all() : { results: [] };
      for (const u of users.results) {
        if (!orc.pode()) break;
        orc.n--; await enviar(env, u.chat_id, `🆕 Novo concurso na <b>${c.banca}</b>\n${escHtml(c.nome)}\n${c.url}`);
      }
    }
  }
}

async function avisarConcurso(env, concursoId, html, url, tipo, orc, titulo) {
  const quem = await env.DB.prepare('SELECT a.token, u.chat_id FROM acompanhando a JOIN usuarios u ON u.token=a.token WHERE a.concurso_id=?')
    .bind(concursoId).all();
  for (const u of quem.results) {
    await env.DB.prepare('INSERT INTO eventos(tipo,concurso_id,token,titulo,url,criado) VALUES(?,?,?,?,?,?)')
      .bind(tipo, concursoId, u.token, titulo || tirarTags(html), url, agora()).run();
    if (u.chat_id && env.TELEGRAM_TOKEN && orc.pode()) { orc.n--; await enviar(env, u.chat_id, html + (url ? `\n${url}` : '')); }
  }
}

async function rodarDocumentos(env, orc, log, limite = 20) {
  const lista = await env.DB.prepare(`SELECT c.* FROM concursos c WHERE c.id IN (SELECT DISTINCT concurso_id FROM acompanhando)
    ORDER BY COALESCE(c.docs_checado,'') ASC LIMIT ?`).bind(limite).all();
  for (const c of lista.results) {
    if (orc.n < 3) break;
    try {
      const r = await orc.fetch(c.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const docs = lerDocumentos(await lerTexto(r), c.url);
      const antes = c.docs_json ? JSON.parse(c.docs_json) : null;
      await env.DB.prepare('UPDATE concursos SET docs_json=?, docs_checado=? WHERE id=?').bind(JSON.stringify(docs), agora(), c.id).run();
      if (!antes) { log.push(`${c.id}: base de ${docs.length} documentos`); continue; }
      const conhecidos = new Set(antes.map((d) => d.url));
      const novos = docs.filter((d) => !conhecidos.has(d.url));
      for (const d of novos.slice(0, 5)) {
        await avisarConcurso(env, c.id, `📄 Novo documento em <b>${escHtml(c.nome)}</b>\n${escHtml(d.texto)}`, d.url, 'novo_documento', orc,
          `${c.nome}: ${d.texto}`);
      }
      log.push(`${c.id}: ${novos.length} documentos novos`);
    } catch (e) {
      await env.DB.prepare('UPDATE concursos SET docs_checado=? WHERE id=?').bind(agora(), c.id).run();
      log.push(`${c.id}: ERRO ${e.message || e}`);
    }
  }
}

const TERMO_DESCOBERTA = 'concurso público';
async function rodarDOU(env, orc, log, forcar = false) {
  const h = horaBrasilia();
  const janela = `${hojeBrasilia()}:${Math.floor(h / 4)}`; // no máximo uma vez a cada 4 horas
  if (!forcar && (h < 6 || h > 22 || (await estado(env, 'dou:janela')) === janela)) return;
  await estado(env, 'dou:janela', janela);

  const termos = await env.DB.prepare(`SELECT t.token, t.termo, u.chat_id FROM termos t JOIN usuarios u ON u.token=t.token`).all();
  const porTermo = new Map();
  for (const t of termos.results) {
    const k = t.termo.toLowerCase();
    if (!porTermo.has(k)) porTermo.set(k, { termo: t.termo, gente: [] });
    porTermo.get(k).gente.push(t);
  }
  porTermo.set('*', { termo: TERMO_DESCOBERTA, gente: [{ token: '*', chat_id: null }] });

  for (const { termo, gente } of porTermo.values()) {
    if (orc.n < 2) { log.push('DOU: orçamento acabou, continua na próxima'); break; }
    try {
      const r = await orc.fetch(urlBuscaDOU(termo));
      const html = await lerTexto(r);
      if (gente[0].token === '*') { await guardarAmostra(env, 'dou', r, html); if (!lerBuscaDOU(html)?.length) await espiar(env, orc, 'dou', r.url, html); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const itens = lerBuscaDOU(html);
      if (itens === null) throw new Error('formato da busca do DOU mudou');
      for (const p of gente) {
        for (const it of itens.slice(0, 15)) {
          const ins = await env.DB.prepare('INSERT OR IGNORE INTO dou_vistos(token,url) VALUES(?,?)').bind(p.token, it.url).run();
          if (!ins.meta.changes) continue;
          const tok = p.token === '*' ? null : p.token;
          const tipo = p.token === '*' ? 'dou_concurso' : 'dou';
          await env.DB.prepare('INSERT INTO eventos(tipo,token,titulo,url,trecho,criado) VALUES(?,?,?,?,?,?)')
            .bind(tipo, tok, `${tipo === 'dou' ? `"${termo}" no DOU: ` : ''}${it.titulo}`, it.url, [it.orgao, it.secao, it.trecho].filter(Boolean).join(' · '), agora()).run();
          if (p.chat_id && env.TELEGRAM_TOKEN && orc.pode()) {
            orc.n--;
            await enviar(env, p.chat_id, `🔔 <b>"${escHtml(termo)}"</b> apareceu no Diário Oficial\n<b>${escHtml(it.titulo)}</b>\n${escHtml(it.orgao)} ${escHtml(it.secao)}\n<i>${escHtml(it.trecho.slice(0, 250))}</i>\n${it.url}`);
          }
        }
      }
      log.push(`DOU "${termo}": ${itens.length} resultados`);
    } catch (e) { log.push(`DOU "${termo}": ERRO ${e.message || e}`); }
  }
}

export async function rodarRobo(env, { forcarDOU = false } = {}) {
  const orc = new Orcamento(Number(env.LIMITE_REQUISICOES || 48));
  const log = [];
  await rodarFontes(env, orc, log);
  await rodarDOU(env, orc, log, forcarDOU);
  await rodarDocumentos(env, orc, log);
  await estado(env, 'ultima_execucao', agora());
  log.push(`requisições restantes: ${orc.n}`);
  return log;
}

// ---------- API ----------
async function usuarioDe(env, req) {
  const tok = req.headers.get('x-token');
  if (!tok) return null;
  return env.DB.prepare('SELECT * FROM usuarios WHERE token=?').bind(tok).first();
}

async function api(req, env, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/concursos' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const banca = url.searchParams.get('banca') || '';
    const sit = url.searchParams.get('situacao') || '';
    const uf = url.searchParams.get('uf') || '';
    const tok = req.headers.get('x-token') || '';
    const where = ["c.ultimo_visto > datetime('now','-10 days')"]; const args = [tok];
    if (q) { where.push('c.nome LIKE ?'); args.push(`%${q}%`); }
    if (banca) { where.push('c.banca = ?'); args.push(banca); }
    if (sit) { where.push('c.situacao = ?'); args.push(sit); }
    if (uf) { where.push('c.uf = ?'); args.push(uf); }
    const r = await env.DB.prepare(`SELECT c.id,c.banca,c.nome,c.url,c.situacao,c.uf,c.primeiro_visto,
      EXISTS(SELECT 1 FROM acompanhando a WHERE a.token=? AND a.concurso_id=c.id) AS acompanhando
      FROM concursos c WHERE ${where.join(' AND ')}
      ORDER BY (c.situacao='abertas') DESC, c.primeiro_visto DESC LIMIT 400`).bind(...args).all();
    return json(r.results);
  }

  if (p === '/api/fontes') {
    const r = await env.DB.prepare("SELECT fonte,quando,links,erro FROM fontes_log WHERE fonte NOT LIKE 'espiar:%' ORDER BY fonte").all();
    return json({ fontes: r.results, ultima_execucao: await estado(env, 'ultima_execucao') });
  }

  if (p === '/api/novidades') {
    const r = await env.DB.prepare(`SELECT * FROM eventos WHERE token IS NULL ORDER BY id DESC LIMIT 60`).all();
    return json(r.results);
  }

  if (p === '/api/usuario' && m === 'POST') {
    const token = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare('INSERT INTO usuarios(token,criado) VALUES(?,?)').bind(token, agora()).run();
    return json({ token });
  }

  const u = await usuarioDe(env, req);
  if (!u) return json({ erro: 'sem usuário' }, 401);

  if (p === '/api/me') {
    const [termos, acomp, ev] = await Promise.all([
      env.DB.prepare('SELECT id, termo FROM termos WHERE token=? ORDER BY id').bind(u.token).all(),
      env.DB.prepare('SELECT c.id,c.nome,c.banca,c.url,c.situacao,c.docs_checado FROM acompanhando a JOIN concursos c ON c.id=a.concurso_id WHERE a.token=? ORDER BY a.criado DESC').bind(u.token).all(),
      env.DB.prepare('SELECT * FROM eventos WHERE token=? ORDER BY id DESC LIMIT 60').bind(u.token).all(),
    ]);
    return json({ conectado: !!u.chat_id, avisar_novos: !!u.avisar_novos, bot: (env.TELEGRAM_TOKEN && env.BOT_USERNAME) || null,
      termos: termos.results, acompanhando: acomp.results, eventos: ev.results });
  }

  if (p === '/api/acompanhar' && m === 'POST') {
    const { concurso_id, ativo } = await req.json();
    if (ativo) await env.DB.prepare('INSERT OR IGNORE INTO acompanhando(token,concurso_id,criado) VALUES(?,?,?)').bind(u.token, concurso_id, agora()).run();
    else await env.DB.prepare('DELETE FROM acompanhando WHERE token=? AND concurso_id=?').bind(u.token, concurso_id).run();
    return json({ ok: true });
  }

  if (p === '/api/termos' && m === 'POST') {
    const termo = String((await req.json()).termo || '').trim().replace(/"/g, '');
    if (termo.length < 3 || termo.length > 120) return json({ erro: 'Use entre 3 e 120 letras' }, 400);
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM termos WHERE token=?').bind(u.token).first();
    if (n.n >= 10) return json({ erro: 'Máximo de 10 termos' }, 400);
    await env.DB.prepare('INSERT INTO termos(token,termo,criado) VALUES(?,?,?)').bind(u.token, termo, agora()).run();
    return json({ ok: true });
  }

  const del = p.match(/^\/api\/termos\/(\d+)$/);
  if (del && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM termos WHERE id=? AND token=?').bind(+del[1], u.token).run();
    return json({ ok: true });
  }

  if (p === '/api/config' && m === 'POST') {
    const { avisar_novos } = await req.json();
    await env.DB.prepare('UPDATE usuarios SET avisar_novos=? WHERE token=?').bind(avisar_novos ? 1 : 0, u.token).run();
    return json({ ok: true });
  }

  if (p === '/api/teste-telegram' && m === 'POST') {
    if (!u.chat_id) return json({ erro: 'Telegram não conectado' }, 400);
    await enviar(env, u.chat_id, '✅ Teste do Radar do Concurseiro: os avisos estão chegando!');
    return json({ ok: true });
  }

  return json({ erro: 'não encontrado' }, 404);
}

async function webhookTelegram(req, env) {
  const upd = await req.json().catch(() => ({}));
  const msg = upd.message;
  if (!msg || !msg.text) return new Response('ok');
  const chatId = String(msg.chat.id);
  const m = msg.text.match(/^\/start(?:\s+([a-f0-9]{32}))?/);
  if (m && m[1]) {
    const r = await env.DB.prepare('UPDATE usuarios SET chat_id=? WHERE token=?').bind(chatId, m[1]).run();
    await enviar(env, chatId, r.meta.changes
      ? '✅ Pronto! Seu Radar do Concurseiro está conectado. Os avisos de concursos e do Diário Oficial vão chegar aqui.'
      : 'Não achei esse código. Volte ao site e toque em "Conectar Telegram" de novo.');
  } else {
    await enviar(env, chatId, 'Oi! Para receber avisos, abra o site do Radar do Concurseiro e toque em <b>Conectar Telegram</b>.');
  }
  return new Response('ok');
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) return await api(req, env, url);
      if (p === `/tg/${env.ADMIN_KEY}` && req.method === 'POST') return await webhookTelegram(req, env);
      if (p === '/admin/rodar') {
        if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return json({ erro: 'chave errada' }, 403);
        return json(await rodarRobo(env, { forcarDOU: url.searchParams.has('dou') }));
      }
      if (p === '/admin/telegram') {
        if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return json({ erro: 'chave errada' }, 403);
        return json(await telegram(env, 'setWebhook', { url: `${url.origin}/tg/${env.ADMIN_KEY}`, allowed_updates: ['message'] }));
      }
      if (p === '/' || p === '/index.html') {
        return new Response(PAGINA.replace('__MONITOR__', escHtml(env.MONITOR_URL || '')),
          { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response('Não encontrado', { status: 404 });
    } catch (e) {
      return json({ erro: String(e.message || e) }, 500);
    }
  },
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(rodarRobo(env));
  },
};

// ---------- Página ----------
const PAGINA = /* html */ `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Radar do Concurseiro</title>
<meta name="theme-color" content="#0f3d3e">
<style>
:root{--bg:#f6f4ef;--card:#fff;--tinta:#1d2a2b;--suave:#5f6d6e;--linha:#e3dfd5;--verde:#0f3d3e;--verde2:#1f6f6b;--ouro:#e0a43a;--ok:#2e7d4f;--erro:#b3402f}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--tinta)}
header{background:var(--verde);color:#fff;padding:18px 16px 0}
.topo{max-width:880px;margin:0 auto;display:flex;align-items:center;gap:10px;justify-content:space-between}
.marca{display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px;letter-spacing:-.01em}
.radar{width:30px;height:30px;border-radius:50%;border:2px solid var(--ouro);position:relative;overflow:hidden}
.radar:after{content:"";position:absolute;inset:0;background:conic-gradient(from 0deg,rgba(224,164,58,.85),transparent 30%);animation:gira 3s linear infinite}
@keyframes gira{to{transform:rotate(360deg)}}
.topo a{white-space:nowrap;color:#cfe6e2;font-size:13px;text-decoration:none;border:1px solid #3f6f6c;padding:6px 10px;border-radius:20px}
nav{max-width:880px;margin:14px auto 0;display:flex;gap:4px}
nav button{flex:1;background:none;border:0;color:#b9d6d2;padding:11px 6px;font:600 14px system-ui;border-bottom:3px solid transparent;cursor:pointer}
nav button.ativo{color:#fff;border-color:var(--ouro)}
main{max-width:880px;margin:0 auto;padding:16px}
.filtros{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:12px}
@media(min-width:640px){.filtros{grid-template-columns:2fr 1fr 1fr 1fr}}
input,select{width:100%;padding:11px 12px;border:1px solid var(--linha);border-radius:10px;background:#fff;font:inherit;color:inherit}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{border:1px solid var(--linha);background:#fff;border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer}
.chip.ativo{background:var(--verde2);border-color:var(--verde2);color:#fff}
.lista{display:flex;flex-direction:column;gap:8px}
.card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:13px 14px;display:flex;gap:12px;align-items:flex-start}
.card .meio{flex:1;min-width:0}
.card h3{margin:0 0 4px;font-size:15px;line-height:1.3;word-wrap:break-word}
.card h3 a{color:inherit;text-decoration:none}
.meta{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--suave)}
.tag{background:#eef3f2;color:var(--verde2);padding:2px 8px;border-radius:6px;font-weight:600}
.tag.aberta{background:#fbefd9;color:#8a5a0b}
.estrela{border:1px solid var(--linha);background:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;font-size:13px;white-space:nowrap;color:var(--verde2);font-weight:600}
.estrela.on{background:var(--verde2);color:#fff;border-color:var(--verde2)}
.vazio{text-align:center;color:var(--suave);padding:40px 10px}
.bloco{background:#fff;border:1px solid var(--linha);border-radius:14px;padding:16px;margin-bottom:14px}
.bloco h2{margin:0 0 6px;font-size:16px}.bloco p{margin:0 0 10px;color:var(--suave)}
.btn{display:inline-block;background:var(--verde2);color:#fff;border:0;border-radius:10px;padding:11px 16px;font:600 14px system-ui;cursor:pointer;text-decoration:none}
.btn.leve{background:#eef3f2;color:var(--verde2)}
.linha{display:flex;gap:8px}.linha input{flex:1}
.termo{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--linha)}
.termo button{background:none;border:0;color:var(--erro);cursor:pointer;font-size:13px}
.ev{padding:11px 0;border-top:1px solid var(--linha)}.ev:first-child{border:0}
.ev a{color:var(--tinta);font-weight:600;text-decoration:none}.ev small{color:var(--suave);display:block;margin-top:2px}
.ok{color:var(--ok);font-weight:600}
.rodape{font-size:12px;color:var(--suave);text-align:center;margin:24px 0}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--tinta);color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;opacity:0;transition:.2s;pointer-events:none}
.toast.on{opacity:1}
</style></head><body>
<header><div class="topo"><div class="marca"><div class="radar"></div>Radar do Concurseiro</div>
<a id="lnkMonitor" href="__MONITOR__" style="display:none">Monitor de provas ↗</a></div>
<nav><button data-aba="concursos" class="ativo">Concursos</button><button data-aba="alertas">Meus alertas</button><button data-aba="novidades">Novidades</button></nav></header>
<main>
<section id="aba-concursos">
  <div class="filtros">
    <input id="fBusca" placeholder="Buscar: TRT, polícia, SEFAZ..." autocomplete="off">
    <select id="fBanca"><option value="">Todas as bancas</option></select>
    <select id="fUF"><option value="">Todos os estados</option></select>
    <select id="fSit"><option value="">Qualquer situação</option><option value="abertas">Inscrições abertas</option><option value="andamento">Em andamento</option></select>
  </div>
  <div class="chips"><span class="chip" data-so="acomp">⭐ Só os que acompanho</span></div>
  <div class="lista" id="lista"><div class="vazio">Carregando concursos…</div></div>
</section>
<section id="aba-alertas" hidden>
  <div class="bloco" id="blocoTg"></div>
  <div class="bloco"><h2>Vigiar no Diário Oficial</h2>
    <p>Coloque seu nome completo, um cargo ou um órgão. Se aparecer no Diário Oficial da União, o aviso aparece aqui em Meus avisos.</p>
    <form class="linha" id="formTermo"><input id="novoTermo" placeholder="Ex.: Maria da Silva Souza" maxlength="120"><button class="btn">Adicionar</button></form>
    <div id="termos"></div></div>
  <div class="bloco"><h2>Concursos que acompanho</h2><p>Quando sair edital, retificação, gabarito ou resultado novo na página da banca, o aviso aparece aqui.</p><div id="acomp"></div></div>
  <div class="bloco"><h2>Meus avisos</h2><div id="meusEventos"></div></div>
</section>
<section id="aba-novidades" hidden>
  <div class="bloco"><h2>Novidades</h2><p>Concursos que acabaram de aparecer nas bancas e publicações sobre concurso público no Diário Oficial de hoje.</p><div id="novidades"></div></div>
  <div class="bloco"><h2>Saúde do robô</h2><div id="fontes"></div></div>
</section>
<div class="rodape">Os dados vêm das páginas oficiais das bancas e do Diário Oficial da União. Sempre confira no edital.</div>
</main>
<div class="toast" id="toast"></div>
<script>
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let TOKEN=null;try{TOKEN=localStorage.getItem('radar_token')}catch(e){}
let todos=[],soAcomp=false,me=null;
const UFN={AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'};
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('on');setTimeout(()=>e.classList.remove('on'),2200)}
async function chamar(path,opt={}){opt.headers={...(opt.headers||{}),'content-type':'application/json'};if(TOKEN)opt.headers['x-token']=TOKEN;const r=await fetch(path,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||'Erro');return d}
async function garantirUsuario(){if(TOKEN)return;const d=await chamar('/api/usuario',{method:'POST'});TOKEN=d.token;try{localStorage.setItem('radar_token',TOKEN)}catch(e){}}
const quando=iso=>{if(!iso)return'';const d=new Date(iso.includes('T')?iso:iso.replace(' ','T')+'Z');const dias=Math.floor((Date.now()-d)/864e5);return dias<=0?'hoje':dias===1?'ontem':'há '+dias+' dias'};

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('ativo',x===b));document.querySelectorAll('main section').forEach(s=>s.hidden=s.id!=='aba-'+b.dataset.aba);if(b.dataset.aba==='alertas')carregarMe();if(b.dataset.aba==='novidades')carregarNovidades()});

async function carregarConcursos(){try{todos=await chamar('/api/concursos')}catch(e){$('#lista').innerHTML='<div class="vazio">Não consegui carregar agora.</div>';return}
  const bancas=[...new Set(todos.map(c=>c.banca))].sort(),ufs=[...new Set(todos.map(c=>c.uf).filter(Boolean))].sort();
  $('#fBanca').innerHTML='<option value="">Todas as bancas</option>'+bancas.map(b=>'<option>'+esc(b)+'</option>').join('');
  $('#fUF').innerHTML='<option value="">Todos os estados</option>'+ufs.map(u=>'<option value="'+u+'">'+esc(UFN[u]||u)+'</option>').join('');
  desenhar()}
function desenhar(){const q=$('#fBusca').value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,''),b=$('#fBanca').value,u=$('#fUF').value,s=$('#fSit').value;
  const l=todos.filter(c=>(!q||c.nome.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').includes(q))&&(!b||c.banca===b)&&(!u||c.uf===u)&&(!s||c.situacao===s)&&(!soAcomp||c.acompanhando));
  if(!todos.length){$('#lista').innerHTML='<div class="vazio">O robô ainda não rodou. Os concursos aparecem aqui depois da primeira leitura das bancas.</div>';return}
  if(!l.length){$('#lista').innerHTML='<div class="vazio">Nenhum concurso com esses filtros.</div>';return}
  $('#lista').innerHTML=l.map(c=>'<div class="card"><div class="meio"><h3><a href="'+esc(c.url)+'" target="_blank" rel="noopener">'+esc(c.nome)+'</a></h3><div class="meta"><span class="tag">'+esc(c.banca)+'</span>'+(c.situacao==='abertas'?'<span class="tag aberta">Inscrições abertas</span>':'')+(c.uf?'<span>'+esc(c.uf)+'</span>':'')+'<span>visto '+quando(c.primeiro_visto)+'</span></div></div><button class="estrela'+(c.acompanhando?' on':'')+'" data-id="'+esc(c.id)+'">'+(c.acompanhando?'★ Acompanhando':'☆ Acompanhar')+'</button></div>').join('')}
['#fBusca','#fBanca','#fUF','#fSit'].forEach(s=>$(s).addEventListener('input',desenhar));
document.querySelector('[data-so]').onclick=e=>{soAcomp=!soAcomp;e.target.classList.toggle('ativo',soAcomp);desenhar()};
$('#lista').onclick=async e=>{const b=e.target.closest('.estrela');if(!b)return;const c=todos.find(x=>x.id===b.dataset.id);try{await garantirUsuario();await chamar('/api/acompanhar',{method:'POST',body:JSON.stringify({concurso_id:c.id,ativo:!c.acompanhando})});c.acompanhando=c.acompanhando?0:1;desenhar();toast(c.acompanhando?'Novidades desse concurso vão aparecer em Meus alertas':'Parou de acompanhar')}catch(err){toast(err.message)}};

async function carregarMe(){try{await garantirUsuario();me=await chamar('/api/me')}catch(e){$('#blocoTg').innerHTML='<p>Não consegui carregar.</p>';return}
  const link=me.bot?'https://t.me/'+me.bot+'?start='+TOKEN:null;
  $('#blocoTg').hidden=!me.bot;
  $('#blocoTg').innerHTML=!me.bot?'':me.conectado?'<h2>Telegram <span class="ok">● conectado</span></h2><p>Os avisos chegam no seu Telegram.</p><label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="cNovos" style="width:auto" '+(me.avisar_novos?'checked':'')+'> Avisar também quando surgir qualquer concurso novo</label><button class="btn leve" id="bTeste">Mandar um teste</button>'
   :'<h2>Receber avisos no Telegram</h2><p>Toque no botão, abra o Telegram e aperte <b>Iniciar</b>. Depois volte aqui.</p>'+(link?'<a class="btn" href="'+link+'" target="_blank">Conectar Telegram</a> <button class="btn leve" id="bAtual">Já conectei</button>':'<p>O bot ainda não foi configurado.</p>');
  $('#cNovos')&&($('#cNovos').onchange=e=>chamar('/api/config',{method:'POST',body:JSON.stringify({avisar_novos:e.target.checked})}).then(()=>toast('Salvo')));
  $('#bTeste')&&($('#bTeste').onclick=()=>chamar('/api/teste-telegram',{method:'POST'}).then(()=>toast('Teste enviado')).catch(e=>toast(e.message)));
  $('#bAtual')&&($('#bAtual').onclick=carregarMe);
  $('#termos').innerHTML=me.termos.map(t=>'<div class="termo"><span>'+esc(t.termo)+'</span><button data-del="'+t.id+'">remover</button></div>').join('')||'<p style="margin:10px 0 0">Nenhum termo ainda.</p>';
  $('#acomp').innerHTML=me.acompanhando.map(c=>'<div class="termo"><a href="'+esc(c.url)+'" target="_blank" style="color:inherit">'+esc(c.nome)+' <small style="color:var(--suave)">'+esc(c.banca)+'</small></a><button data-tirar="'+esc(c.id)+'">parar</button></div>').join('')||'<p style="margin:0">Na aba Concursos, toque em ☆ Acompanhar.</p>';
  $('#meusEventos').innerHTML=me.eventos.map(ev).join('')||'<p style="margin:0">Nenhum aviso ainda. Assim que algo aparecer, fica registrado aqui.</p>'}
function ev(e){return '<div class="ev">'+(e.url?'<a href="'+esc(e.url)+'" target="_blank" rel="noopener">'+esc(e.titulo)+'</a>':'<b>'+esc(e.titulo)+'</b>')+'<small>'+(e.trecho?esc(e.trecho.slice(0,220))+' · ':'')+quando(e.criado)+'</small></div>'}
$('#formTermo').onsubmit=async e=>{e.preventDefault();const t=$('#novoTermo').value.trim();if(!t)return;try{await chamar('/api/termos',{method:'POST',body:JSON.stringify({termo:t})});$('#novoTermo').value='';toast('Vou vigiar "'+t+'" no Diário Oficial');carregarMe()}catch(err){toast(err.message)}};
$('#termos').onclick=async e=>{const id=e.target.dataset.del;if(!id)return;await chamar('/api/termos/'+id,{method:'DELETE'});carregarMe()};
$('#acomp').onclick=async e=>{const id=e.target.dataset.tirar;if(!id)return;await chamar('/api/acompanhar',{method:'POST',body:JSON.stringify({concurso_id:id,ativo:false})});const c=todos.find(x=>x.id===id);if(c)c.acompanhando=0;carregarMe()};

async function carregarNovidades(){try{const [n,f]=await Promise.all([chamar('/api/novidades'),chamar('/api/fontes')]);
  $('#novidades').innerHTML=n.map(ev).join('')||'<p style="margin:0">Nada novo ainda.</p>';
  $('#fontes').innerHTML='<p>Última rodada: '+(f.ultima_execucao?new Date(f.ultima_execucao).toLocaleString('pt-BR'):'ainda não rodou')+'</p>'+f.fontes.map(x=>'<div class="termo"><span>'+esc(x.fonte)+'</span><span style="font-size:13px;color:'+(x.erro?'var(--erro)':x.links?'var(--ok)':'var(--ouro)')+'">'+(x.erro?esc(x.erro):x.links+' concursos')+'</span></div>').join('')}catch(e){$('#novidades').innerHTML='<p>Não consegui carregar.</p>'}}

if($('#lnkMonitor').getAttribute('href'))$('#lnkMonitor').style.display='';
carregarConcursos();
</script></body></html>`;
