// Radar do Concurseiro — Worker do Cloudflare (arquivo único)
// Bindings: DB (D1). Secrets: TELEGRAM_TOKEN, ADMIN_KEY. Vars: BOT_USERNAME, MONITOR_URL (opcional)

// ---------- Fontes (páginas das bancas) ----------
// Cada fonte lista concursos como links. `padrao` testa o caminho do link.
// Se uma banca mudar o site, é só ajustar aqui. O painel /api/fontes mostra quantos links cada uma achou.
export const FONTES = [
  // A Cebraspe monta a página com JavaScript; os dados vêm desta API
  { id: 'cebraspe', banca: 'Cebraspe', tipo: 'json', situacao: 'andamento',
    url: 'https://apis.cebraspe.org.br/cebraspe/eventos/tipo/concursos/', linkBase: 'https://www.cebraspe.org.br/concursos/' },
  // FGV: a página tem "em andamento" e "realizados"; só interessa o primeiro bloco
  ...[0, 1, 2].map((pg) => ({ id: pg ? `fgv-${pg + 1}` : 'fgv', banca: 'FGV', url: `https://conhecimento.fgv.br/concursos?page=${pg}`, situacao: 'andamento',
    recorte: ['view-concursos-em-andamento', 'view-concursos-realizados'],
    padrao: /^\/(?:(?:concursos?|processoseletivo)\/)?([a-z0-9-]+)\/?$/i,
    ignorar: ['concursos', 'concurso', 'exames', 'quem-somos', 'avaliacoes-educacionais', 'seguros', 'centro-de-pesquisa', 'publicacoes', 'eventos', 'videos', 'contatos'] })),
  { id: 'fcc', banca: 'FCC', url: 'https://www.concursosfcc.com.br/concursos/', situacao: 'andamento',
    padrao: /^\/concursos\/([a-z0-9]+)\/(?:index\.html?)?$/i, ignorar: ['jsp'] },
  { id: 'fcc-abertas', banca: 'FCC', url: 'https://www.concursosfcc.com.br/concursoInscricaoAberta.html', situacao: 'abertas', primeiroTexto: true,
    padrao: /^\/concursos\/([a-z0-9]+)\/(?:index\.html?)?$/i, ignorar: ['jsp'] },
  { id: 'fcc-destaques', banca: 'FCC', url: 'https://www.concursosfcc.com.br/concursos/bannersConcurso.js', situacao: 'andamento', tipo: 'urls',
    padrao: /^\/concursos\/([a-z0-9]+)\/(?:index\.html?)?$/i, ignorar: ['jsp'] },
  ...['inscricoes%20abertas', 'em%20andamento', 'proximo'].flatMap((sit) => (sit === 'em%20andamento' ? [1, 2, 3, 4, 5] : [1, 2]).map((pg) => ({
    id: `vunesp-${sit.replace(/%20/g, '-')}${pg > 1 ? '-' + pg : ''}`, banca: 'Vunesp', situacao: sit.startsWith('insc') ? 'abertas' : sit === 'proximo' ? 'novo' : 'andamento',
    url: pg === 1 ? `https://www.vunesp.com.br/busca/concurso/${sit}` : `https://www.vunesp.com.br/CarregarMais/${pg}/concurso/${sit}?httproute=True`,
    padrao: /^\/([A-Z]{2,}[0-9]{4})\/?$/, ignorar: [] }))),
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
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "psicólogos" -> "psicolog": assim a busca acha psicólogo, psicóloga e psicologia
export function raizes(q) {
  return norm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).map((w) => {
    if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
    if (w.length > 6 && w.endsWith('ia')) w = w.slice(0, -2);
    else if (w.length > 5 && /[aeo]$/.test(w)) w = w.slice(0, -1);
    return w;
  }).slice(0, 5);
}
const HEADERS_API = { accept: 'application/json, text/plain, */*', referer: 'https://www.cebraspe.org.br/concursos/', origin: 'https://www.cebraspe.org.br' };
const EH_CODIGO = /^[A-Z]{2,}\d{4}$/;
const horaBrasilia = (d = new Date()) => (d.getUTCHours() + 21) % 24;
const hojeBrasilia = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const ENT = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', ccedil: 'ç',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Agrave: 'À', Ccedil: 'Ç',
  ordm: 'º', ordf: 'ª', ndash: '–', mdash: '—', deg: '°', uuml: 'ü', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const tirarTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
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
  if (fonte.tipo === 'urls') html = (html.match(/https?:\/\/[^'"\s<>]+/g) || []).map((u) => `<a href="${u}"></a>`).join('');
  if (fonte.recorte) {
    const i = html.indexOf(fonte.recorte[0]);
    const f = i >= 0 ? html.indexOf(fonte.recorte[1], i + 1) : -1;
    html = i >= 0 ? html.slice(i, f > i ? f : undefined) : '';
  }
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
    else if (nome && (!atual.nome || (!fonte.primeiroTexto && nome.length > atual.nome.length))) atual.nome = nome;
  }
  return [...achados.values()].map((c) => {
    const nome = c.nome || bonitoDoSlug(c.slug);
    return { id: c.id, banca: c.banca, url: c.url, nome, uf: detectarUF(c.slug, nome), situacao: fonte.situacao };
  });
}

// Lê respostas JSON de API (formato descoberto em tempo de execução: procura os campos mais prováveis)
export function lerFonteJSON(fonte, texto) {
  let dados = JSON.parse(texto);
  // Formato da Cebraspe: [{ faseEvento, eventos: [{ eventoNomeAbreviado, eventoURL, eventoTotalVagas, strEventoSalarioMaximo, eventoStatus }] }]
  if (Array.isArray(dados) && dados.some((g) => g && Array.isArray(g.eventos))) {
    const out = [];
    for (const g of dados) for (const e of g.eventos || []) {
      if (!e || !e.eventoURL) continue;
      if (!['novos', 'inscricoes-abertas', 'em-andamento'].includes(e.eventoStatus)) continue; // pula encerrados
      const slug = String(e.eventoURL).trim();
      const nome = tirarTags(e.eventoNomeCompleto || e.eventoNomeAbreviado || bonitoDoSlug(slug));
      const sal = e.eventoSalarioMaximo > 0 ? e.strEventoSalarioMaximo : null;
      out.push({ id: `${fonte.banca.toLowerCase()}:${slug.toLowerCase()}`, banca: fonte.banca, url: fonte.linkBase + slug, nome,
        uf: detectarUF(slug, nome), situacao: e.eventoStatus === 'inscricoes-abertas' ? 'abertas' : e.eventoStatus === 'novos' ? 'novo' : 'andamento',
        vagas: e.eventoTotalVagas || null, salario: sal, salarioNum: e.eventoSalarioMaximo > 0 ? e.eventoSalarioMaximo : null });
    }
    return out;
  }
  if (!Array.isArray(dados)) dados = dados.data || dados.eventos || dados.itens || dados.items || dados.result || dados.value || Object.values(dados).find(Array.isArray) || [];
  const pegarCampo = (o, nomes) => { for (const n of nomes) for (const k of Object.keys(o)) if (k.toLowerCase() === n && o[k] != null && o[k] !== '') return o[k]; return null; };
  const out = [];
  for (const it of dados) {
    if (!it || typeof it !== 'object') continue;
    const slug = String(pegarCampo(it, ['identificador', 'sigla', 'slug', 'codigo', 'code', 'chave', 'url', 'link', 'id']) || '').replace(/^.*\/concursos\//, '').replace(/\/$/, '');
    const nome = tirarTags(String(pegarCampo(it, ['nome', 'titulo', 'title', 'descricao', 'nomeevento', 'name']) || slug));
    if (!slug) continue;
    const url = /^https?:/.test(slug) ? slug : fonte.linkBase + slug;
    out.push({ id: `${fonte.banca.toLowerCase()}:${slug.toLowerCase()}`, banca: fonte.banca, url, nome: nome || bonitoDoSlug(slug),
      uf: detectarUF(slug, nome), situacao: fonte.situacao });
  }
  return out;
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
export function urlBuscaDOU(termo, periodo = 'dia') {
  const q = encodeURIComponent(`"${termo}"`);
  return `https://www.in.gov.br/consulta/-/buscar/dou?q=${q}&s=todos&exactDate=${periodo}&sortType=0`;
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
      const r = await orc.fetch(fonte.url, fonte.tipo === 'json' ? { headers: { accept: 'application/json, text/plain, */*', referer: 'https://www.cebraspe.org.br/concursos/' } } : {});
      const html = await lerTexto(r);
      if (fonte.tipo === 'json') await env.DB.prepare('INSERT INTO fontes_log(fonte,quando,links,amostra) VALUES(?,?,0,?) ON CONFLICT(fonte) DO UPDATE SET amostra=excluded.amostra')
        .bind(fonte.id, agora(), JSON.stringify({ status: r.status, corpo: html.slice(0, 4000) })).run();
      else await guardarAmostra(env, fonte.id, r, html);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lista = fonte.tipo === 'json' ? lerFonteJSON(fonte, html) : lerFonte(fonte, html);
      for (const c of lista) {
        const ja = vistosAgora.get(c.id);
        const peso = { abertas: 3, novo: 2, andamento: 1 };
        if (!ja || (peso[c.situacao] || 0) > (peso[ja.situacao] || 0)) vistosAgora.set(c.id, { ...(ja || {}), ...c, vagas: c.vagas || ja?.vagas, salario: c.salario || ja?.salario, nome: ja && ja.nome.length > c.nome.length ? ja.nome : c.nome });
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
  const abriram = [];
  const t = agora();
  const existentes = new Map((await env.DB.prepare('SELECT id, situacao FROM concursos').all()).results.map((x) => [x.id, x.situacao]));
  const lote = [];
  for (const c of vistosAgora.values()) {
    if (!existentes.has(c.id)) {
      lote.push(env.DB.prepare('INSERT INTO concursos(id,banca,nome,url,situacao,uf,primeiro_visto,ultimo_visto,vagas,salario,busca) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .bind(c.id, c.banca, c.nome, c.url, c.situacao, c.uf, t, t, c.vagas || null, c.salario || null, norm(c.nome)));
      if (c.salarioNum) lote.push(env.DB.prepare('UPDATE concursos SET salario_num=? WHERE id=?').bind(c.salarioNum, c.id));
      novos.push(c);
    } else {
      lote.push(env.DB.prepare('UPDATE concursos SET nome=COALESCE(?,nome), url=?, situacao=?, uf=COALESCE(?,uf), ultimo_visto=?, vagas=COALESCE(?,vagas), salario=COALESCE(?,salario), salario_num=COALESCE(?,salario_num) WHERE id=?')
        .bind(EH_CODIGO.test(c.nome) ? null : c.nome, c.url, c.situacao, c.uf, t, c.vagas || null, c.salario || null, c.salarioNum || null, c.id));
      if (existentes.get(c.id) !== 'abertas' && c.situacao === 'abertas') abriram.push(c);
    }
  }
  for (let i = 0; i < lote.length; i += 40) await env.DB.batch(lote.slice(i, i + 40));
  for (const c of abriram) await avisarConcurso(env, c.id, `📝 Inscrições abertas: <b>${escHtml(c.nome)}</b> (${c.banca})`, c.url, 'inscricoes', orc);

  // Na primeira vez que uma banca é lida, tudo é "novo": só grava, sem avisar.
  const porBanca = {};
  for (const c of novos) (porBanca[c.banca] ||= []).push(c);
  for (const [banca, lista] of Object.entries(porBanca)) {
    if (!(await estado(env, `base:${banca}`))) { await estado(env, `base:${banca}`, t); log.push(`${banca}: base inicial com ${lista.length}`); continue; }
    for (const c of lista.slice(0, 30)) {
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

// Detalhe de um concurso da Cebraspe (API): cargos, período de inscrição e arquivos
export function detalheCebraspe(d, slug) {
  const cargos = (d.eventoCargos || []).map((x) => tirarTags(String((x && x.area) || '')).replace(/^Cargo\s*\d+\s*:\s*/i, '')).filter(Boolean);
  const docs = [];
  for (const a of [...(d.arquivosEdital || []), ...(d.arquivosGabarito || [])]) {
    if (!a || !a.nomeArquivo || /vlibras/i.test(a.descricaoArquivo || '')) continue;
    const url = a.isGuid ? `https://cdn.cebraspe.org.br/${a.nomeArquivo}` : `https://cdn.cebraspe.org.br/concursos/${slug}/arquivos/${a.nomeArquivo}`;
    docs.push({ url, texto: tirarTags(a.descricaoArquivo || a.nomeArquivo).slice(0, 200) });
  }
  const insc = d.periodoInscricao ? tirarTags(d.periodoInscricao).replace(/,?\s*hor[aá]rio oficial.*$/i, '') : null;
  return { cargos, docs, inscricoes: insc, texto: '', nome: null, vagas: null, salario: null, salarioNum: null, nivel: nivelDoTexto(cargos.join(' ')) };
}
// Detalhe pela página HTML do concurso (FCC, Vunesp): texto para busca, documentos e, na Vunesp, o nome
export function detalheHtml(c, html) {
  let texto = tirarTags(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' '));
  const titulo = tirarTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const out = { cargos: [], docs: lerDocumentos(html, c.url), inscricoes: null, nome: null, vagas: null };
  if (c.banca === 'FCC' && /^[A-Z0-9]+$/.test(c.nome) && titulo) out.nome = titulo.replace(/^FCC\s*-\s*/i, '').slice(0, 160) || null;
  if (c.banca === 'Vunesp') {
    const cod = c.id.split(':')[1].toUpperCase();
    const i = texto.lastIndexOf(cod); if (i > 0) texto = texto.slice(i);
    const f = texto.indexOf('Home Quem Somos'); if (f > 0) texto = texto.slice(0, f);
    if (titulo && !/^Funda..o Vunesp/i.test(titulo)) {
      const [tipo, org] = titulo.split('|').map((x) => x.trim());
      out.nome = (org ? `${org} – ${tipo}` : titulo).slice(0, 160);
    }
    const m = texto.match(/Inscri..es:\s*(\d{2}\/\d{2})\s*(?:a\s*)?(\d{2}\/\d{2})/i); if (m) out.inscricoes = `De ${m[1]} a ${m[2]}`;
    const v = texto.match(/Vagas:?\s*([\d.]+)/i); if (v) out.vagas = v[1];
  }
  let maior = 0, maiorTxt = null;
  for (const m of texto.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g)) {
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (v >= 900 && v <= 60000 && v > maior) { maior = v; maiorTxt = 'R$ ' + m[1]; }
  }
  out.salarioNum = maior || null; out.salario = maiorTxt;
  out.nivel = nivelDoTexto(texto);
  out.texto = texto.slice(0, 6000);
  return out;
}
export function nivelDoTexto(t) {
  const n = norm(t), out = [];
  if (/(ensino|nivel) fundamental/.test(n)) out.push('F');
  if (/(ensino|nivel) medio/.test(n)) out.push('M');
  if (/(ensino|nivel|curso) superior|graduacao|bacharel/.test(n)) out.push('S');
  return out.length ? out.join(',') : null;
}
function termoBate(termo, busca) {
  const t = norm(termo).trim();
  if (/\s/.test(t)) return busca.includes(t);
  const rz = raizes(t);
  return rz.length > 0 && busca.includes(rz[0]);
}

async function rodarDetalhes(env, orc, log, limite, soNuncaVistos) {
  const lista = await env.DB.prepare(`SELECT c.*, EXISTS(SELECT 1 FROM acompanhando a WHERE a.concurso_id=c.id) AS seguido FROM concursos c
    WHERE c.banca<>'FGV' AND c.ultimo_visto > datetime('now','-3 days') ${soNuncaVistos ? 'AND c.docs_checado IS NULL' : ''}
    ORDER BY (c.docs_checado IS NULL) DESC, seguido DESC, c.docs_checado ASC LIMIT ?`).bind(limite).all();
  if (!lista.results.length) return 0;
  const termos = (await env.DB.prepare('SELECT t.token, t.termo, u.chat_id FROM termos t JOIN usuarios u ON u.token=t.token').all()).results;
  let feitos = 0;
  for (const c of lista.results) {
    if (orc.n < 2) break;
    try {
      let det;
      if (c.banca === 'Cebraspe') {
        const slug = c.url.replace(/\/$/, '').split('/').pop();
        const r = await orc.fetch(`https://apis.cebraspe.org.br/cebraspe/eventos/${slug}`, { headers: HEADERS_API });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const txt = await r.text();
        if (!txt) throw new Error('sem detalhe');
        det = detalheCebraspe(JSON.parse(txt), slug);
      } else {
        const r = await orc.fetch(c.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        det = detalheHtml(c, await lerTexto(r));
      }
      const nome = det.nome || c.nome;
      const busca = norm([nome, det.cargos.join(' '), det.texto].join(' ')).slice(0, 7000);
      const antes = c.docs_json ? JSON.parse(c.docs_json) : null;
      await env.DB.prepare('UPDATE concursos SET nome=?, cargos=?, inscricoes=COALESCE(?,inscricoes), vagas=COALESCE(vagas,?), salario=COALESCE(salario,?), salario_num=COALESCE(salario_num,?), nivel=COALESCE(?,nivel), busca=?, docs_json=?, docs_checado=? WHERE id=?')
        .bind(nome, JSON.stringify(det.cargos.slice(0, 120)), det.inscricoes, det.vagas, det.salario || null, det.salarioNum || null, det.nivel || null, busca, JSON.stringify(det.docs.slice(0, 80)), agora(), c.id).run();
      feitos++;
      if (antes) {
        const conhecidos = new Set(antes.map((d) => d.url));
        const novos = det.docs.filter((d) => !conhecidos.has(d.url));
        for (const d of novos.slice(0, 5)) {
          await avisarConcurso(env, c.id, `📄 Novo documento em <b>${escHtml(nome)}</b>\n${escHtml(d.texto)}`, d.url, 'novo_documento', orc, `${nome}: ${d.texto}`);
        }
        if (novos.length) log.push(`${c.id}: ${novos.length} documentos novos`);
      }
      for (const t of termos) {
        if (!termoBate(t.termo, busca)) continue;
        const ins = await env.DB.prepare('INSERT OR IGNORE INTO dou_vistos(token,url) VALUES(?,?)').bind(t.token, `cargo:${t.termo.toLowerCase()}:${c.id}`).run();
        if (!ins.meta.changes) continue;
        await env.DB.prepare('INSERT INTO eventos(tipo,concurso_id,token,titulo,url,trecho,criado) VALUES(?,?,?,?,?,?,?)')
          .bind('cargo', c.id, t.token, `"${t.termo}" aparece no concurso ${nome}`, c.url, [c.banca, det.inscricoes].filter(Boolean).join(' · '), agora()).run();
        if (t.chat_id && env.TELEGRAM_TOKEN && orc.pode()) { orc.n--; await enviar(env, t.chat_id, `🎯 <b>"${escHtml(t.termo)}"</b> aparece no concurso <b>${escHtml(nome)}</b> (${c.banca})\n${c.url}`); }
      }
    } catch (e) {
      await env.DB.prepare('UPDATE concursos SET docs_checado=? WHERE id=?').bind(agora(), c.id).run();
      log.push(`${c.id}: ERRO ${e.message || e}`);
    }
  }
  log.push(`detalhes: ${feitos} concursos lidos`);
  return feitos;
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
  porTermo.set('*p', { termo: 'autoriza a realização de concurso público', periodo: 'mes', gente: [{ token: '*p', chat_id: null }] });

  for (const { termo, gente, periodo } of porTermo.values()) {
    if (orc.n < 2) { log.push('DOU: orçamento acabou, continua na próxima'); break; }
    try {
      const r = await orc.fetch(urlBuscaDOU(termo, periodo));
      const html = await lerTexto(r);
      if (gente[0].token === '*') { await guardarAmostra(env, 'dou', r, html); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const itens = lerBuscaDOU(html);
      if (itens === null) throw new Error('formato da busca do DOU mudou');
      for (const p of gente) {
        for (const it of itens.slice(0, 15)) {
          const ins = await env.DB.prepare('INSERT OR IGNORE INTO dou_vistos(token,url) VALUES(?,?)').bind(p.token, it.url).run();
          if (!ins.meta.changes) continue;
          const tok = p.token[0] === '*' ? null : p.token;
          const tipo = p.token === '*' ? 'dou_concurso' : p.token === '*p' ? 'dou_previsto' : 'dou';
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

// ---------- Sondas: pedidos de investigação gravados no banco (tabela sondas) ----------
function resumirSonda(txt, modo, base) {
  modo = modo || 'bruto:0';
  if (modo.startsWith('linksf:')) {
    const re = new RegExp(modo.slice(7), 'i'); const out = [];
    for (const { url, texto } of extrairLinks(txt, base)) { const k = url.host.replace('www.', '') + url.pathname + url.search + ' | ' + texto.slice(0, 70); if (re.test(k) && !out.includes(k)) out.push(k); if (out.length >= 45) break; }
    return `(${txt.length} chars)\n` + out.join('\n');
  }
  if (modo === 'links') {
    const out = [];
    for (const { url, texto } of extrairLinks(txt, base)) { const k = url.pathname + url.search + ' | ' + texto.slice(0, 90); if (!out.includes(k)) out.push(k); if (out.length >= 300) break; }
    return out.join('\n');
  }
  if (modo.startsWith('busca:')) {
    const re = new RegExp(modo.slice(6), 'gi'); const out = []; let m;
    while ((m = re.exec(txt)) && out.length < 10) { out.push(txt.slice(Math.max(0, m.index - 300), m.index + 600)); re.lastIndex = m.index + 600; }
    return `(${txt.length} chars)\n` + out.join('\n-----\n');
  }
  if (modo.startsWith('texto:')) {
    const limpo = tirarTags(txt.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '));
    const o = Number(modo.slice(6)) || 0; return `(${limpo.length} chars)\n` + limpo.slice(o, o + 6000);
  }
  const o = Number(modo.split(':')[1]) || 0;
  return `(${txt.length} chars)\n` + txt.slice(o, o + 6000);
}
async function rodarSondas(env, orc) {
  let r;
  try { r = await env.DB.prepare('SELECT * FROM sondas WHERE feito IS NULL ORDER BY id LIMIT 8').all(); } catch { return 0; }
  for (const sd of r.results) {
    let status = 0, ct = '', corpo = '';
    try {
      const api = /\/\/apis?\./.test(sd.url);
      const resp = await orc.fetch(sd.url, { headers: api ? { accept: 'application/json, text/plain, */*', referer: 'https://www.cebraspe.org.br/concursos/', origin: 'https://www.cebraspe.org.br' } : {} });
      status = resp.status; ct = resp.headers.get('content-type') || '';
      corpo = resumirSonda(await lerTexto(resp), sd.modo, resp.url);
    } catch (e) { corpo = 'ERRO ' + (e.message || e); }
    await env.DB.prepare('UPDATE sondas SET feito=?, status=?, ct=?, corpo=? WHERE id=?').bind(agora(), status, ct, corpo, sd.id).run();
  }
  return r.results.length;
}

export async function rodarRobo(env, { forcarDOU = false } = {}) {
  const orc = new Orcamento(Number(env.LIMITE_REQUISICOES || 48));
  const log = [];
  await rodarFontes(env, orc, log);
  await rodarDOU(env, orc, log, forcarDOU);
  await rodarDetalhes(env, orc, log, 30, false);
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
    for (const w of raizes(q)) { where.push("(COALESCE(c.busca,'') LIKE ? OR lower(c.nome) LIKE ?)"); args.push(`%${w}%`, `%${w}%`); }
    if (banca) { where.push('c.banca = ?'); args.push(banca); }
    if (sit) { where.push('c.situacao = ?'); args.push(sit); }
    if (uf) { where.push('c.uf = ?'); args.push(uf); }
    const r = await env.DB.prepare(`SELECT c.id,c.banca,c.nome,c.url,c.situacao,c.uf,c.primeiro_visto,c.vagas,c.salario,c.salario_num,c.nivel,c.cargos,c.inscricoes,
      EXISTS(SELECT 1 FROM acompanhando a WHERE a.token=? AND a.concurso_id=c.id) AS acompanhando
      FROM concursos c WHERE ${where.join(' AND ')}
      ORDER BY (c.situacao='abertas') DESC, (c.situacao='novo') DESC, c.primeiro_visto DESC LIMIT 400`).bind(...args).all();
    return json(r.results);
  }

  if (p === '/api/concurso' && m === 'GET') {
    const c = await env.DB.prepare('SELECT id,banca,nome,url,cargos,docs_json,inscricoes,docs_checado FROM concursos WHERE id=?').bind(url.searchParams.get('id') || '').first();
    if (!c) return json({ erro: 'não encontrado' }, 404);
    let cargos = [], docs = [];
    try { cargos = JSON.parse(c.cargos || '[]'); docs = JSON.parse(c.docs_json || '[]'); } catch {}
    return json({ id: c.id, cargos, docs: docs.slice(0, 60), inscricoes: c.inscricoes, lido: !!c.docs_checado });
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

// Atende sondas pendentes e pedidos de rodada (estado 'pedir_rodada' = '1')
async function tique(env, rodadaCheia) {
  const n = await rodarSondas(env, new Orcamento(20));
  const pedido = await estado(env, 'pedir_rodada');
  if (pedido === '1') await estado(env, 'pedir_rodada', '0');
  if (pedido === '1' || rodadaCheia) await rodarRobo(env);
  else await rodarDetalhes(env, new Orcamento(10), [], 8, true); // adianta a leitura dos concursos que ainda não têm cargos
  return n;
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
      if (p === '/manifest.webmanifest') return new Response(JSON.stringify({ name: 'Radar do Concurseiro', short_name: 'Radar', start_url: '/', display: 'standalone',
        background_color: '#0f3d3e', theme_color: '#0f3d3e', lang: 'pt-BR', description: 'Concursos das bancas, busca por cargo e alertas do Diário Oficial',
        icons: [{ src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }),
        { headers: { 'content-type': 'application/manifest+json; charset=utf-8' } });
      if (p === '/icone-192.png' || p === '/icone-512.png') {
        const bin = atob(p.includes('192') ? ICONE_192 : ICONE_512);
        return new Response(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' } });
      }
      if (p === '/sw.js') return new Response(SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
      if (p === '/' && url.searchParams.has('tique')) await tique(env, false);
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
    ctx.waitUntil(tique(env, new Date(evento.scheduledTime).getUTCMinutes() === 7));
  },
};

// ---------- App instalável ----------
const SW = `const C='radar-v1';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.add('/')))});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  if(r.mode==='navigate')e.respondWith(fetch(r).then(x=>{const k=x.clone();caches.open(C).then(c=>c.put('/',k));return x}).catch(()=>caches.match('/')))});`;
const ICONE_192 = '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';
const ICONE_512 = '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';

// ---------- Página ----------
const PAGINA = /* html */ `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Radar do Concurseiro</title>
<meta name="theme-color" content="#0f3d3e">
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icone-192.png"><link rel="icon" href="/icone-192.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Radar">
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
.filtros{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.filtros input{grid-column:1/-1}.filtros select{padding:10px 8px;font-size:14px}
@media(min-width:640px){.filtros{grid-template-columns:repeat(3,1fr)}.filtros input{grid-column:1/-1}}
input,select{width:100%;padding:11px 12px;border:1px solid var(--linha);border-radius:10px;background:#fff;font:inherit;color:inherit}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{border:1px solid var(--linha);background:#fff;border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer}
.chip.ativo{background:var(--verde2);border-color:var(--verde2);color:#fff}
.lista{display:flex;flex-direction:column;gap:8px}
.card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:13px 14px;display:flex;gap:12px;align-items:flex-start}
.card .meio{flex:1;min-width:0}
.card h3{margin:0 0 4px;font-size:15px;line-height:1.3;word-wrap:break-word}
.card h3 a{color:inherit;text-decoration:none}
.acoes{margin-top:8px}.lk{background:none;border:0;color:var(--verde2);font:600 13px system-ui;cursor:pointer;padding:0}
.det{margin-top:10px;border-top:1px solid var(--linha);padding-top:10px;font-size:13px}.det h4{margin:10px 0 4px;font-size:13px}.det h4:first-child{margin-top:0}
.det a{color:var(--verde2);display:block;padding:3px 0;text-decoration:none}.det ul{margin:0;padding-left:18px;color:var(--suave)}
#instalar{display:none}
.cargos{font-size:13px;color:var(--suave);margin-top:6px}.cargos b{color:var(--tinta);background:#fbefd9;padding:0 3px;border-radius:4px}
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
<a id="instalar" href="#">Instalar app</a><a id="lnkMonitor" href="__MONITOR__" style="display:none">Monitor de provas ↗</a></div>
<nav><button data-aba="concursos" class="ativo">Concursos</button><button data-aba="alertas">Meus alertas</button><button data-aba="novidades">Novidades</button></nav></header>
<main>
<section id="aba-concursos">
  <div class="filtros">
    <input id="fBusca" placeholder="Cargo ou órgão: psicólogo, TRT, polícia..." autocomplete="off">
    <select id="fBanca"><option value="">Todas as bancas</option></select>
    <select id="fUF"><option value="">Todos os estados</option></select>
    <select id="fSit"><option value="">Qualquer situação</option><option value="abertas">Inscrições abertas</option><option value="novo">Novos / edital em breve</option><option value="andamento">Em andamento</option></select>
    <select id="fNivel"><option value="">Qualquer escolaridade</option><option value="F">Nível fundamental</option><option value="M">Nível médio</option><option value="S">Nível superior</option></select>
    <select id="fSal"><option value="">Qualquer salário</option><option value="3000">A partir de R$ 3 mil</option><option value="5000">A partir de R$ 5 mil</option><option value="8000">A partir de R$ 8 mil</option><option value="12000">A partir de R$ 12 mil</option><option value="20000">A partir de R$ 20 mil</option></select>
  </div>
  <div class="chips"><span class="chip" data-so="acomp">⭐ Só os que acompanho</span><span class="chip" data-area="psicólogo">Psicologia</span><span class="chip" data-area="enferm">Enfermagem</span><span class="chip" data-area="médico">Medicina</span><span class="chip" data-area="direito">Direito</span><span class="chip" data-area="tecnologia da informação">TI</span><span class="chip" data-area="contabilidade">Contabilidade</span><span class="chip" data-area="engenharia">Engenharia</span><span class="chip" data-area="professor">Educação</span><span class="chip" data-area="polícia">Polícia</span><span class="chip" data-area="administrativa">Administrativo</span></div>
  <div class="lista" id="lista"><div class="vazio">Carregando concursos…</div></div>
</section>
<section id="aba-alertas" hidden>
  <div class="bloco" id="blocoTg"></div>
  <div class="bloco"><h2>Vigiar nome, cargo ou órgão</h2>
    <p>Coloque seu nome completo, um cargo (ex.: psicólogo) ou um órgão. Você é avisado quando aparecer no Diário Oficial da União ou entre os cargos de um concurso das bancas.</p>
    <form class="linha" id="formTermo"><input id="novoTermo" placeholder="Ex.: Maria da Silva Souza" maxlength="120"><button class="btn">Adicionar</button></form>
    <div id="termos"></div></div>
  <div class="bloco"><h2>Concursos que acompanho</h2><p>Quando sair edital, retificação, gabarito ou resultado novo na página da banca, o aviso aparece aqui.</p><div id="acomp"></div></div>
  <div class="bloco"><h2>Meus avisos</h2><div id="meusEventos"></div></div>
</section>
<section id="aba-novidades" hidden>
  <div class="bloco"><h2>Novidades</h2><p>Concursos que acabaram de aparecer nas bancas, autorizações de concursos previstos e publicações sobre concurso público no Diário Oficial.</p><div id="novidades"></div></div>
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

const semAcento=t=>String(t||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
function raizes(q){return semAcento(q).split(/[^a-z0-9]+/).filter(w=>w.length>=2).map(w=>{if(w.length>4&&w.endsWith('s'))w=w.slice(0,-1);if(w.length>6&&w.endsWith('ia'))w=w.slice(0,-2);else if(w.length>5&&/[aeo]$/.test(w))w=w.slice(0,-1);return w}).slice(0,5)}
let primeira=true,pedido=0;
async function carregarConcursos(){const q=$('#fBusca').value.trim(),meu=++pedido;let l;try{l=await chamar('/api/concursos'+(q?'?q='+encodeURIComponent(q):''))}catch(e){$('#lista').innerHTML='<div class="vazio">Não consegui carregar agora.</div>';return}
  if(meu!==pedido)return;todos=l;
  if(primeira&&!q){primeira=false;const bancas=[...new Set(todos.map(c=>c.banca))].sort(),ufs=[...new Set(todos.map(c=>c.uf).filter(Boolean))].sort();
  $('#fBanca').innerHTML='<option value="">Todas as bancas</option>'+bancas.map(b=>'<option>'+esc(b)+'</option>').join('');
  $('#fUF').innerHTML='<option value="">Todos os estados</option>'+ufs.map(u=>'<option value="'+u+'">'+esc(UFN[u]||u)+'</option>').join('')}
  desenhar()}
function nivelTag(c){if(!c.nivel)return '';const n={F:'fundamental',M:'médio',S:'superior'};return '<div class="cargos">Escolaridade: '+c.nivel.split(',').map(x=>n[x]).join(', ')+'</div>'}
async function abrirDetalhe(bt){const box=bt.closest('.meio').querySelector('.det');if(!box.hidden){box.hidden=true;bt.textContent='Ver detalhes ▾';return}
  box.hidden=false;bt.textContent='Fechar ▴';box.innerHTML='Carregando…';const c=todos.find(x=>x.id===bt.dataset.det);let d;try{d=await chamar('/api/concurso?id='+encodeURIComponent(c.id))}catch(e){box.innerHTML='Não consegui carregar.';return}
  const conc=d.docs.filter(x=>/estat.stica|concorr.ncia|candidatos? por vaga|demanda|inscritos/i.test(x.texto)),outros=d.docs.filter(x=>!conc.includes(x));
  const g='https://www.google.com/search?q='+encodeURIComponent('provas anteriores '+c.nome+' '+c.banca+' pdf');
  box.innerHTML=(d.inscricoes?'<h4>Inscrições</h4><div>'+esc(d.inscricoes)+'</div>':'')
   +(d.cargos.length?'<h4>Cargos ('+d.cargos.length+')</h4><ul>'+d.cargos.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')
   +(conc.length?'<h4>Concorrência (inscritos por cargo)</h4>'+conc.slice(0,6).map(x=>'<a href="'+esc(x.url)+'" target="_blank" rel="noopener">📊 '+esc(x.texto)+'</a>').join(''):'')
   +(outros.length?'<h4>Editais e documentos</h4>'+outros.slice(0,12).map(x=>'<a href="'+esc(x.url)+'" target="_blank" rel="noopener">📄 '+esc(x.texto)+'</a>').join('')+(outros.length>12?'<div style="color:var(--suave)">e mais '+(outros.length-12)+' na página da banca</div>':''):'')
   +'<h4>Mais</h4><a href="'+esc(c.url)+'" target="_blank" rel="noopener">Abrir a página na '+esc(c.banca)+' ↗</a><a href="'+g+'" target="_blank" rel="noopener">Buscar provas anteriores ↗</a>'
   +(!d.lido?'<div style="color:var(--suave);margin-top:6px">O robô ainda não leu os detalhes desse concurso.</div>':'')}
function insc(c){if(!c.inscricoes)return '';const t=c.inscricoes.replace(/^De /,''),ds=t.match(/\\d{2}\\/\\d{2}\\/\\d{4}/g);
  if(ds){const p=ds[ds.length-1].split('/'),fim=new Date(+p[2],+p[1]-1,+p[0],23,59);if(fim<new Date())return '<span>Inscrições encerradas em '+ds[ds.length-1]+'</span>';return '<span class="tag aberta">Inscrições até '+ds[ds.length-1]+'</span>'}
  return '<span>Inscrições: '+esc(t)+'</span>'}
function linhaCargos(c,rz){let cg=[];try{cg=JSON.parse(c.cargos||'[]')}catch(e){}
  if(rz.length){const bate=cg.filter(x=>{const n=semAcento(x);return rz.every(w=>n.includes(w))});
    if(bate.length)return '<div class="cargos">Cargos: '+bate.slice(0,4).map(x=>'<b>'+esc(x)+'</b>').join(' · ')+(bate.length>4?' e mais '+(bate.length-4):'')+'</div>';
    if(!rz.every(w=>semAcento(c.nome).includes(w)))return '<div class="cargos">✓ Citado na página do concurso</div>'}
  if(!cg.length)return '';return '<div class="cargos">Cargos: '+cg.slice(0,3).map(esc).join(' · ')+(cg.length>3?' e mais '+(cg.length-3):'')+'</div>'}
function desenhar(){const q=$('#fBusca').value.trim(),rz=raizes(q),b=$('#fBanca').value,u=$('#fUF').value,s=$('#fSit').value;
  const nv=$('#fNivel').value,sl=+$('#fSal').value;
  const l=todos.filter(c=>(!b||c.banca===b)&&(!u||c.uf===u)&&(!s||c.situacao===s)&&(!soAcomp||c.acompanhando)&&(!nv||(c.nivel||'').includes(nv))&&(!sl||(c.salario_num||0)>=sl));
  if(!todos.length&&!q){$('#lista').innerHTML='<div class="vazio">O robô ainda não rodou. Os concursos aparecem aqui depois da primeira leitura das bancas.</div>';return}
  if(!l.length){$('#lista').innerHTML='<div class="vazio">Nenhum concurso encontrado'+(q?' para "'+esc(q)+'". Você pode cadastrar esse termo em Meus alertas para ser avisado quando aparecer.':' com esses filtros.')+'</div>';return}
  $('#lista').innerHTML=l.map(c=>'<div class="card"><div class="meio"><h3><a href="'+esc(c.url)+'" target="_blank" rel="noopener">'+esc(c.nome)+'</a></h3><div class="meta"><span class="tag">'+esc(c.banca)+'</span>'+(c.situacao==='abertas'?'<span class="tag aberta">Inscrições abertas</span>':c.situacao==='novo'?'<span class="tag aberta">Novo</span>':'')+(c.uf?'<span>'+esc(c.uf)+'</span>':'')+(c.vagas?'<span>'+esc(c.vagas)+' vagas</span>':'')+(c.salario?'<span><b>até '+esc(c.salario)+'</b></span>':'')+insc(c)+'</div>'+nivelTag(c)+linhaCargos(c,rz)+'<div class="acoes"><button class="lk" data-det="'+esc(c.id)+'">Ver detalhes ▾</button></div><div class="det" hidden></div></div><button class="estrela'+(c.acompanhando?' on':'')+'" data-id="'+esc(c.id)+'">'+(c.acompanhando?'★ Acompanhando':'☆ Acompanhar')+'</button></div>').join('')}
let espera;$('#fBusca').addEventListener('input',()=>{clearTimeout(espera);espera=setTimeout(carregarConcursos,350)});
document.querySelectorAll('[data-area]').forEach(ch=>ch.onclick=()=>{const on=ch.classList.contains('ativo');document.querySelectorAll('[data-area]').forEach(x=>x.classList.remove('ativo'));$('#fBusca').value=on?'':ch.dataset.area;if(!on)ch.classList.add('ativo');carregarConcursos()});
['#fBanca','#fUF','#fSit','#fNivel','#fSal'].forEach(s=>$(s).addEventListener('input',desenhar));
document.querySelector('[data-so]').onclick=e=>{soAcomp=!soAcomp;e.target.classList.toggle('ativo',soAcomp);desenhar()};
$('#lista').onclick=async e=>{const dt=e.target.closest('[data-det]');if(dt){abrirDetalhe(dt);return}const b=e.target.closest('.estrela');if(!b)return;const c=todos.find(x=>x.id===b.dataset.id);try{await garantirUsuario();await chamar('/api/acompanhar',{method:'POST',body:JSON.stringify({concurso_id:c.id,ativo:!c.acompanhando})});c.acompanhando=c.acompanhando?0:1;desenhar();toast(c.acompanhando?'Novidades desse concurso vão aparecer em Meus alertas':'Parou de acompanhar')}catch(err){toast(err.message)}};

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
function ev(e){return '<div class="ev">'+(e.tipo==='dou_previsto'?'<span class="tag aberta">Previsto</span> ':e.tipo==='novo_concurso'?'<span class="tag">Novo</span> ':'')+(e.url?'<a href="'+esc(e.url)+'" target="_blank" rel="noopener">'+esc(e.titulo)+'</a>':'<b>'+esc(e.titulo)+'</b>')+'<small>'+(e.trecho?esc(e.trecho.slice(0,220))+' · ':'')+quando(e.criado)+'</small></div>'}
$('#formTermo').onsubmit=async e=>{e.preventDefault();const t=$('#novoTermo').value.trim();if(!t)return;try{await chamar('/api/termos',{method:'POST',body:JSON.stringify({termo:t})});$('#novoTermo').value='';toast('Vou vigiar "'+t+'" no Diário Oficial');carregarMe()}catch(err){toast(err.message)}};
$('#termos').onclick=async e=>{const id=e.target.dataset.del;if(!id)return;await chamar('/api/termos/'+id,{method:'DELETE'});carregarMe()};
$('#acomp').onclick=async e=>{const id=e.target.dataset.tirar;if(!id)return;await chamar('/api/acompanhar',{method:'POST',body:JSON.stringify({concurso_id:id,ativo:false})});const c=todos.find(x=>x.id===id);if(c)c.acompanhando=0;carregarMe()};

async function carregarNovidades(){try{const [n,f]=await Promise.all([chamar('/api/novidades'),chamar('/api/fontes')]);
  $('#novidades').innerHTML=n.map(ev).join('')||'<p style="margin:0">Nada novo ainda.</p>';
  $('#fontes').innerHTML='<p>Última rodada: '+(f.ultima_execucao?new Date(f.ultima_execucao).toLocaleString('pt-BR'):'ainda não rodou')+'</p>'+f.fontes.map(x=>'<div class="termo"><span>'+esc(x.fonte)+'</span><span style="font-size:13px;color:'+(x.erro?'var(--erro)':x.links?'var(--ok)':'var(--ouro)')+'">'+(x.erro?esc(x.erro):x.links+' concursos')+'</span></div>').join('')}catch(e){$('#novidades').innerHTML='<p>Não consegui carregar.</p>'}}

if($('#lnkMonitor').getAttribute('href'))$('#lnkMonitor').style.display='';
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
let convite;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();convite=e;$('#instalar').style.display='inline-block'});
$('#instalar').onclick=e=>{e.preventDefault();if(convite){convite.prompt();convite=null;$('#instalar').style.display='none'}};
carregarConcursos();
</script></body></html>`;
