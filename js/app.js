/* Catálogo digital (white label)
 * Gera as páginas A4 dos catálogos a partir da lista de produtos, permite
 * cadastrar/editar produtos e exporta o PDF (html2canvas + jsPDF).
 * Dados: API da Netlify (Functions + Blobs) ou localStorage (modo
 * demonstração), conforme js/config.js. Recursos, marca, cores e catálogos
 * também vêm do config.js.
 */
(() => {
'use strict';

const CFG = Object.assign({ backend: 'netlify', demonstracao: false, whatsapp: '', marcaPrevia: false, plano: 'completo' }, window.CATALOGO_CONFIG || {});

/* ---------- versão de demonstração: só abre no computador ---------- */
const H = location.hostname;
const LOCAL = location.protocol === 'file:' || !H || H === 'localhost' || H.endsWith('.localhost') || H.endsWith('.local') || H === '[::1]' || H === '::1'
  || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/.test(H);
if (CFG.demonstracao && !LOCAL) {
  document.title = 'Versão de demonstração';
  document.body.innerHTML = '<div class="bloqueio"><div><h1>Versão de demonstração</h1><p>Esta cópia do catálogo é só para apresentação e não pode ser publicada.</p><p>Para colocar o catálogo de um cliente no ar, use uma cópia com <code>demonstracao: false</code> em <code>js/config.js</code> (veja o README).</p></div></div>';
  return;
}

/* ---------- planos e recursos ---------- */
const BASE = { pdf: true, precos: true, selos: true, edicao: true, busca: false, carrinho: false, lancamentos: false };
const PLANOS = {
  essencial: BASE,
  completo: BASE,
  vendas: Object.assign({}, BASE, { busca: true, carrinho: true, lancamentos: true })
};
const R = Object.assign({}, PLANOS[String(CFG.plano).toLowerCase()] || BASE, CFG.recursos || {});
Object.keys(R).forEach(k => { R[k] = !!R[k]; });

/* ---------- empresa, contatos e cores ---------- */
const EMP = Object.assign({ nome: 'Sua Marca', ramo: 'Distribuidora de materiais para chaveiro', sobre: '', destaque: null }, CFG.empresa || {});
const WA = String(CFG.whatsapp || '').replace(/\D/g, '');
const CONTATO = Object.assign({ whats: '', tele: '', site: '', instagram: '' }, CFG.contato || {});
const SITE_URL = 'https://' + String(CONTATO.site || '').replace(/^https?:\/\//, '');
const siteLink = () => `<a href="${SITE_URL}" target="_blank" rel="noopener">${esc(CONTATO.site)}</a>`;
const IG = String(CONTATO.instagram || '').replace(/^@/, '');
const igLink = () => IG ? `<a href="https://www.instagram.com/${encodeURIComponent(IG)}/" target="_blank" rel="noopener">@${esc(IG)}</a>` : '';
const MARCA_PREVIA = !!CFG.marcaPrevia;
const ONLINE = CFG.backend !== 'demo';
const MM = 96 / 25.4;
const LIBS = {
  h2c: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
};
let QR = ''; // QR code do WhatsApp, gerado no navegador a partir do número (js/lib/qrcode.js)

// cores: as variáveis do CSS são calculadas a partir de config.cores
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgbHex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const COR = { principal: '#0F3D3E', destaque: '#FF7A1A' };
function aplicarCores() {
  const p = hexRgb((CFG.cores || {}).principal) || hexRgb(COR.principal);
  const d = hexRgb((CFG.cores || {}).destaque) || hexRgb(COR.destaque);
  COR.principal = rgbHex(p); COR.destaque = rgbHex(d);
  const W = [255, 255, 255], K = [0, 0, 0];
  const v = {
    '--brand': rgbHex(p), '--p-navy': rgbHex(p), '--p-navy-2': rgbHex(mix(p, K, .28)), '--accent': rgbHex(d), '--p-yellow': rgbHex(d),
    '--accent-fg': rgbHex(p), '--p-soft': rgbHex(mix(p, W, .76)), '--p-soft-2': rgbHex(mix(p, W, .6)), '--p-navy-rgb': p.join(','), '--accent-rgb': d.join(',')
  };
  Object.entries(v).forEach(([k, x]) => document.documentElement.style.setProperty(k, x));
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute('content', rgbHex(p));
}

/* ---------- catálogos e seções ---------- */
// Partes fixas de cada catálogo; nomes, chamada, destaques e legenda vêm do config.js.
const CATDEF = {
  geral: { id: 'geral', nome: 'Catálogo Geral', capa: 'navy', grupos: true, kick: 'Catálogo de produtos', exemplo: 'GV4301',
    marcaLbl: 'Montadora ou linha', marcaEx: 'Ex.: GM / Chevrolet', rowH: 56, hdrH: 15.5 },
  chaves: { id: 'chaves', nome: 'Catálogo de Chaves', capa: 'yellow', grupos: false, kick: 'Chaves para copiar', exemplo: 'Y2101',
    marcaLbl: 'Fabricante', marcaEx: 'Ex.: Fortex', rowH: 50, hdrH: 0,
    // no PDF, 3 chaves por linha e maiores (no site continuam 4 por linha)
    pdf: { cols: 3, rowH: 59 } },
  // catálogo "virtual": junta os produtos marcados como NOVO dos outros catálogos
  novos: { id: 'novos', nome: 'Lançamentos', capa: 'navy', grupos: true, kick: 'Novidades do catálogo', virtual: true, rowH: 56, hdrH: 15.5 }
};
const slugArq = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
// título da capa: "Catálogo" em cima e o resto embaixo; nome comprido vira duas linhas menores
function capaTitulo(nome) {
  const m = /^cat[aá]logo\s+(.+)$/i.exec(nome.trim());
  const a = m ? 'Catálogo' : 'Catálogo de', b = m ? m[1] : nome.trim();
  if (b.length <= 9) return { a, b, longo: false };
  const w = b.split(/\s+/);
  // uma palavra comprida (ex.: "Lançamentos") ou nome médio: uma linha um pouco menor
  if (w.length < 2 || b.length <= 13) return { a, b, longo: false, medio: true };
  let best = 1, dist = Infinity;
  for (let i = 1; i < w.length; i++) { const d = Math.abs(w.slice(0, i).join(' ').length - b.length / 2); if (d < dist) { dist = d; best = i; } }
  return { a, b: w.slice(0, best).join(' ') + '|' + w.slice(best).join(' '), longo: true };
}
function mkCat(id) {
  const def = CATDEF[id], cc = ((CFG.catalogos || {})[id === 'novos' ? 'lancamentos' : id]) || {};
  const c = Object.assign({}, def, { ativo: cc.ativo !== false, nome: cc.nome || def.nome, kick: cc.chamada || def.kick,
    destaques: Array.isArray(cc.destaques) ? cc.destaques : [], legenda: Array.isArray(cc.legenda) && cc.legenda.length ? cc.legenda : null });
  Object.assign(c, capaTitulo(c.nome));
  const arq = n => slugArq(/^cat[aá]logo/i.test(n) ? n : 'Catálogo de ' + n) + '.pdf';
  c.arquivo = arq(c.nome);
  if (cc.nomePdf && cc.nomePdf !== c.nome) {
    const t = capaTitulo(cc.nomePdf);
    c.pdfNome = { nome: cc.nomePdf, a: t.a, b: t.b, longo: t.longo, medio: !!t.medio, arquivo: arq(cc.nomePdf) };
  }
  return c;
}
const CAT = { geral: mkCat('geral'), chaves: mkCat('chaves'), novos: mkCat('novos') };
// catálogos de verdade que este cliente usa (no mínimo um)
const CATS = ['geral', 'chaves'].filter(c => CAT[c].ativo);
if (!CATS.length) CATS.push('geral');
const TABS = CATS.concat(R.lancamentos ? ['novos'] : []);
const realCat = c => CATS.includes(c) ? c : CATS[0];
// No PDF, alguns catálogos usam outro nome (config.catalogos.*.nomePdf)
const catConf = (c, pdf) => Object.assign({}, CAT[c], pdf && CAT[c].pdfNome ? CAT[c].pdfNome : {});
// Catálogo completo (produtos, fotos e seções tirados dos PDFs originais) fica em
// data/seed.json e só é carregado quando precisa: modo demonstração ou administrador logado.
let seedP = null;
function loadSeed() {
  if (!seedP) seedP = fetch('data/seed.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('não encontrei o catálogo completo (data/seed.json)'); return r.json(); })
    .catch(e => { seedP = null; throw e; });
  return seedP;
}
const CONFIG0 = () => ({ precos: { geral: true, chaves: true }, seedVersao: 0 });
// Altura útil (mm) da área de produtos na 1ª página de uma seção e nas seguintes
const CAP_FIRST = 239, CAP_CONT = 251;

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const hoje = () => new Date().toLocaleDateString('pt-BR');
const ano = () => new Date().getFullYear();
const clone = o => JSON.parse(JSON.stringify(o));
const errMsg = e => (e && (e.message || e.error_description || e.msg)) || 'erro desconhecido';

async function seedData() {
  const sd = await loadSeed();
  const produtos = sd.produtos.map((p, i) => Object.assign({}, p, { ordem: (i + 1) * 10 }));
  return { produtos, cats: clone(sd.cats), config: Object.assign(CONFIG0(), { seedVersao: sd.versao }) };
}

/* ---------- preços ---------- */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPreco = v => BRL.format(v).replace(/\u00a0/g, ' ');
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v)) ? null : +v;
// aceita "8", "8,5", "8.50", "R$ 1.234,56"; vazio = sem preço
function parsePreco(s) {
  let t = String(s ?? '').replace(/[^\d,.]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\.(?=.*\.)/g, '');
  const n = Math.round(parseFloat(t) * 100) / 100;
  return Number.isFinite(n) ? n : null;
}
const precoTxt = v => v === null || v === undefined ? '' : String(v.toFixed(2)).replace('.', ',');
const precosOn = c => R.precos && (c === 'novos' ? CATS.some(x => precosOn(x)) : !!(state.config && state.config.precos && state.config.precos[c]));
// selos só aparecem com o recurso "selos" ligado
const selo = (p, s) => R.selos && !!p[s];
function secPreco(c, nome) { const s = (state.cats[c] || []).find(x => x.nome === nome); return s ? num(s.preco) : null; }
// preço de cada versão: o da versão, senão o do produto, senão o preço único da seção
function precoInfo(p) {
  const base = num(p.preco) ?? secPreco(p.cat, p.categoria);
  const vs = (p.codigos || []).filter(x => x.c).map(x => num(x.preco) ?? base);
  const vals = vs.filter(v => v !== null);
  if (!vals.length) return null;
  return { min: Math.min(...vals), varia: new Set(vals).size > 1 || vals.length < vs.length, vs };
}

/* =========================================================
   Camada de dados
   ========================================================= */
function LocalStore() {
  const KEY = 'catalogo-demo-v1';
  // na demonstração não há senha: "Entrar" só troca a visão de cliente pela de quem edita
  let adm = false;
  try { adm = sessionStorage.getItem('catalogo-demo-adm') === '1'; } catch (e) {}
  const subs = [];
  const setAdm = v => { adm = v; try { sessionStorage.setItem('catalogo-demo-adm', v ? '1' : '0'); } catch (e) {} subs.forEach(f => f()); };
  return {
    online: false,
    async load() {
      try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.produtos) && s.cats) return Object.assign({ config: CONFIG0() }, s); } catch (e) {}
      return seedData();
    },
    async saveProduto(p, isNew) { return isNew ? Object.assign({}, p, { id: 'u' + Date.now().toString(36) }) : p; },
    async deleteProduto() {},
    async ensureSecao() {},
    async uploadFoto(blob, cat, dataUrl) { return dataUrl; },
    async saveConfig() {}, async saveSecoes() {}, async reorder() {},
    afterChange(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { return false; } },
    reset() { try { localStorage.removeItem(KEY); } catch (e) {} },
    canEdit: () => adm, user: () => null,
    async signIn() { setAdm(true); },
    async signOut() { setAdm(false); },
    onAuth(f) { subs.push(f); }
  };
}

function ApiStore() {
  const KEY = 'catalogo-token';
  let tok = null;
  try { tok = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!tok || !tok.token || !(tok.exp > Date.now())) tok = null;
  const subs = [];
  const notify = () => subs.forEach(f => f());
  const setTok = t => { tok = t; try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch (e) {} notify(); };
  async function call(method, path, body, headers) {
    const h = Object.assign({}, headers || {});
    if (tok) h.authorization = 'Bearer ' + tok.token;
    let payload = body;
    if (body !== undefined && !(body instanceof Blob)) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let r;
    try { r = await fetch(path, { method, headers: h, body: payload }); }
    catch (e) { throw new Error('sem conexão com o servidor'); }
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (r.status === 401 && path !== '/api/login') { setTok(null); throw new Error('sua sessão expirou. Toque em Entrar e digite a senha de novo'); }
    if (!r.ok) throw new Error((data && data.erro) || ('erro ' + r.status));
    return data;
  }
  return {
    online: true,
    async load() {
      const d = await call('GET', '/api/catalogo' + (tok ? '?fresh=' + Date.now() : ''));
      return { produtos: Array.isArray(d && d.produtos) ? d.produtos : [], cats: Object.assign({ geral: [], chaves: [] }, (d && d.cats) || {}),
        config: Object.assign(CONFIG0(), (d && d.config) || {}) };
    },
    saveProduto: (p, isNew) => isNew ? call('POST', '/api/produtos', p) : call('PUT', '/api/produtos/' + encodeURIComponent(p.id), p),
    deleteProduto: id => call('DELETE', '/api/produtos/' + encodeURIComponent(id)),
    ensureSecao: (cat, nome, ordem) => call('POST', '/api/secoes', { cat, nome, desc: '', ordem }),
    async uploadFoto(blob, cat) { const d = await call('POST', '/api/fotos?cat=' + encodeURIComponent(cat), blob, { 'content-type': blob.type || 'image/jpeg' }); return d.url; },
    importar: (produtos, cats) => call('POST', '/api/importar', { produtos, cats: cats || {} }),
    saveConfig: cfg => call('PUT', '/api/config', cfg),
    saveSecoes: secoes => call('PUT', '/api/secoes', { secoes }),
    reorder: itens => call('PUT', '/api/ordem', { itens }),
    afterChange() { return true; },
    canEdit: () => !!(tok && tok.exp > Date.now()),
    user: () => null,
    async signIn(senha) { const d = await call('POST', '/api/login', { senha }); setTok(d); },
    // se a senha (ADMIN_SENHA) mudou, o acesso salvo deixa de valer: sai do modo de edição
    async checarSessao() { if (!tok) return true; try { await call('GET', '/api/sessao'); return true; } catch (e) { return !!tok; } },
    async signOut() { setTok(null); },
    onAuth(f) { subs.push(f); }
  };
}

let store = null;
let state = { produtos: [], cats: { geral: [], chaves: [] }, config: CONFIG0() };
let curCat = CATS[0];
let ready = false;
let upd = null; // { novos, secoes }: catálogo completo ainda não importado (só para o administrador)
const canEdit = () => R.edicao && !!(store && store.canEdit());

/* =========================================================
   Paginação
   ========================================================= */
// Lançamentos: produtos marcados como NOVO nos catálogos ativos. Cada catálogo de origem vira
// uma seção ("Catálogo Geral", "Catálogo de Chaves") e as seções originais viram grupos.
const isNovo = p => !!p.novo && CATS.includes(p.cat);
const prodsOf = c => c === 'novos' ? state.produtos.filter(isNovo) : state.produtos.filter(p => p.cat === c);
const novoSrc = nome => CATS.find(s => CAT[s].nome === nome) || CATS[0];
// catálogo de origem de uma seção (para o tipo de cartão e o tamanho das linhas)
const srcOf = (c, nome) => c === 'novos' ? novoSrc(nome) : c;
function catsOf(c) {
  if (c === 'novos') return CATS.filter(s => state.produtos.some(p => p.cat === s && p.novo)).map(s => CAT[s].nome);
  const list = (state.cats[c] || []).map(x => x.nome);
  state.produtos.filter(p => p.cat === c).forEach(p => { if (!list.includes(p.categoria)) list.push(p.categoria); });
  return list.filter(n => state.produtos.some(p => p.cat === c && p.categoria === n));
}
function allCatsOf(c) {
  const list = (state.cats[c] || []).map(x => x.nome);
  state.produtos.filter(p => p.cat === c).forEach(p => { if (!list.includes(p.categoria)) list.push(p.categoria); });
  return list;
}
function descOf(c, nome) {
  if (c === 'novos') return `Produtos novos do ${nome}`;
  const m = (state.cats[c] || []).find(x => x.nome === nome); return m ? m.desc : '';
}
function groupsOf(c, nome) {
  const out = []; const idx = {};
  if (c === 'novos') {
    const src = novoSrc(nome);
    const ordem = allCatsOf(src);
    const itens = state.produtos.filter(p => p.cat === src && p.novo);
    ordem.forEach(cat => { const g = itens.filter(p => p.categoria === cat); if (g.length) out.push({ marca: cat, itens: g }); });
    return out;
  }
  state.produtos.filter(p => p.cat === c && p.categoria === nome).forEach(p => {
    const k = (p.marca || '').trim() || 'Outros';
    if (!(k in idx)) { idx[k] = out.length; out.push({ marca: k, itens: [] }); }
    out[idx[k]].itens.push(p);
  });
  return out;
}
function buildPages(c, pdf) {
  const conf = CAT[c];
  const pages = [{ t: 'capa' }, { t: 'intro' }];
  const sec = [];
  catsOf(c).forEach((nome, si) => {
    const src = srcOf(c, nome), sc = CAT[src];
    const cols = (pdf && sc.pdf && sc.pdf.cols) || 4;
    const rowH = (pdf && sc.pdf && sc.pdf.rowH) || sc.rowH;
    const hdrH = conf.virtual ? conf.hdrH : sc.hdrH;
    const blocks = [];
    const groups = groupsOf(c, nome);
    if (conf.grupos && !(groups.length === 1 && groups[0].marca === 'Outros')) {
      groups.forEach(g => {
        blocks.push({ t: 'grp', g, h: hdrH });
        for (let i = 0; i < g.itens.length; i += cols) blocks.push({ t: 'row', itens: g.itens.slice(i, i + cols), h: rowH });
      });
    } else {
      const all = groups.flatMap(g => g.itens);
      for (let i = 0; i < all.length; i += cols) blocks.push({ t: 'row', itens: all.slice(i, i + cols), h: rowH });
    }
    let cur = { t: 'sec', nome, si, src, cols, first: true, blocks: [], used: 0, cap: CAP_FIRST, groups };
    const start = pages.length + 1;
    blocks.forEach((b, i) => {
      // o título de um grupo nunca fica sozinho no fim da página
      const need = b.t === 'grp' ? b.h + (blocks[i + 1] ? blocks[i + 1].h : 0) : b.h;
      if (cur.used + need > cur.cap + 4 && cur.blocks.length) {
        pages.push(cur);
        cur = { t: 'sec', nome, si, src, cols, first: false, blocks: [], used: 0, cap: CAP_CONT, groups };
      }
      cur.blocks.push(b); cur.used += b.h;
    });
    pages.push(cur);
    sec.push({ nome, si, src, start, groups });
  });
  pages.push({ t: 'contra' });
  return { pages, sec };
}

/* =========================================================
   Modelos das páginas
   ========================================================= */
const lock = v => `<div class="lock"><img class="logo" src="img/logo-${v ? 'v' : 'h'}.png" alt="${esc(EMP.nome)}"></div>`;
const imgTag = (src, lazy) => `<img src="${esc(src)}" alt=""${lazy ? ' loading="lazy" decoding="async"' : ''}${/^https?:/i.test(src) ? ' crossorigin="anonymous"' : ''}>`;
const waLink = t => `https://wa.me/${WA}?text=${encodeURIComponent(t)}`;
const prodTxt = (p, cods) => `${cods} – ${p.nome}${p.marca ? ' (' + p.marca + ')' : ''}`;
function waHref(p) {
  const cods = p.codigos.map(x => x.c).filter(Boolean).join(' / ');
  const pi = precosOn(p.cat) ? precoInfo(p) : null;
  const pr = pi ? ` – ${pi.varia ? 'a partir de ' : ''}${fmtPreco(pi.min)}` : '';
  const prod = prodTxt(p, cods);
  const t = selo(p, 'esgotado')
    ? `Olá! Tenho interesse no produto ${prod}, do ${CAT[p.cat].nome} ${EMP.nome}. No catálogo ele aparece como *ESGOTADO*: vai ter reposição?`
    : `Olá! Tenho interesse no produto ${prod}${pr}, do ${CAT[p.cat].nome} ${EMP.nome}.${selo(p, 'oferta') ? ' (vi a oferta no catálogo)' : ''}`;
  return waLink(t);
}
function cardHTML(p) {
  const k = p.cat === 'chaves';
  const cods = (p.codigos || []).filter(x => x.c);
  const multi = cods.length > 1 || cods.some(x => x.obs);
  const pi = precosOn(p.cat) ? precoInfo(p) : null;
  const vp = i => (pi && pi.varia && pi.vs[i] !== null) ? `<em>${esc(fmtPreco(pi.vs[i]))}</em>` : '';
  const codes = multi
    ? `<div class="vchips">${cods.map((x, i) => `<span class="vchip">${esc(x.c)}${x.obs ? `<i>${esc(x.obs)}</i>` : ''}${vp(i)}</span>`).join('')}</div>`
    : `<div class="code">${esc(cods[0] ? cods[0].c : '—')}</div>`;
  const img = p.foto ? imgTag(p.foto, true) : `<span class="nofoto">Sem foto</span>`;
  const price = pi ? `<span class="preco">${pi.varia ? '<small>a partir de</small>' : ''}${esc(fmtPreco(pi.min))}</span>` : '';
  const meta = k ? `<div class="eq">${p.equiv ? 'Equiv. ' + esc(p.equiv) : ''}</div>`
    : `<div class="mt">${p.aplicacao ? `<span class="apl">${esc(p.aplicacao)}</span>` : ''}${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  const novo = selo(p, 'novo'), oferta = selo(p, 'oferta'), esg = selo(p, 'esgotado');
  const selos = (novo || oferta) ? `<span class="selos">${novo ? '<span class="novo">NOVO</span>' : ''}${oferta ? '<span class="oferta">OFERTA</span>' : ''}</span>` : '';
  return `<a class="card${k ? ' k' : ''}${cods.length > 1 ? ' mc' : ''}${esg ? ' esg' : ''}" href="${waHref(p)}" target="_blank" rel="noopener" data-id="${esc(p.id)}">
    <div class="well">${img}${k ? '' : price}${esg ? '<span class="esgotado">ESGOTADO</span>' : ''}</div>
    <div class="bd">${k ? `<div class="eb"><span>${esc(p.marca)}</span>${price}</div>` : ''}${codes}<div class="nm">${esc(p.nome)}</div>${meta}</div>
    ${selos}
  </a>`;
}
function stripHTML(c, pdf) { return `<div class="strip">${lock()}<div class="ed">${esc(catConf(c, pdf).nome)} · <b>Edição ${ano()}</b></div></div>`; }
function footHTML(n, total, c) {
  return `<div class="foot"><div class="l">Pedidos pelo WhatsApp <b>${esc(CONTATO.whats)}</b>${CONTATO.tele ? ` · Televendas <b>${esc(CONTATO.tele)}</b>` : ''}${CONTATO.site ? ' · ' + siteLink() : ''}<br><span>Toque no produto para pedir pelo WhatsApp · ${c && precosOn(c) ? 'Preços sujeitos a alteração · ' : ''}Consulte disponibilidade em estoque</span></div>
    <div class="r">${MARCA_PREVIA ? '<span class="prevtag">Prévia</span>' : ''}<div class="pn">${pad2(n)}<small>/ ${pad2(total)}</small></div></div></div>`;
}
function tabHTML(nome, si) { return `<div class="tab" style="top:${44 + (si % 6) * 38}mm"><span>${esc(nome)}</span></div>`; }

function capaHTML(c, info, pdf) {
  const conf = catConf(c, pdf);
  const pool = prodsOf(c);
  const prods = conf.destaques.map(id => pool.find(p => p.id === id)).filter(p => p && p.foto);
  while (prods.length < 4) { const x = pool.find(p => p.foto && !prods.includes(p) && !selo(p, 'esgotado')) || pool.find(p => p.foto && !prods.includes(p)); if (!x) break; prods.push(x); }
  const tiles = prods.slice(0, 4).map(p => `<div class="tile"><div class="w">${imgTag(p.foto)}</div><div class="c">${esc(p.codigos[0] ? p.codigos[0].c : '')}</div></div>`).join('');
  const toc = info.sec.map((s, i) => `<div><i>${pad2(i + 1)}</i>${esc(s.nome)}</div>`).join('');
  const tocCls = info.sec.length > 7 ? 'toc two' : 'toc';
  const meta = `<div class="meta">${MARCA_PREVIA ? '<span class="prevpill">Prévia de layout</span>' : ''}<span class="ed">Edição ${ano()} · atualizado em ${hoje()}</span></div>`;
  const band = `<div class="band"><div><div class="k">WhatsApp da empresa</div><div class="v">${esc(CONTATO.whats)}</div></div>${CONTATO.tele ? `<div><div class="k">Televendas</div><div class="v">${esc(CONTATO.tele)}</div></div>` : ''}${CONTATO.site ? `<div><div class="k">Catálogo online</div><div class="v">${siteLink()}</div></div>` : ''}${IG ? `<div><div class="k">Instagram</div><div class="v">${igLink()}</div></div>` : ''}</div>`;
  const ttl = `<div class="ttl"><div class="kick">${esc(conf.kick)}</div><h1${conf.longo ? ' class="longo"' : conf.medio ? ' class="medio"' : ''}><span class="a">${esc(conf.a)}</span><span class="b">${conf.b.split('|').map(t => `<span>${esc(t)}</span>`).join('')}</span></h1><div class="${tocCls}">${toc}</div></div>`;
  if (conf.capa === 'yellow') {
    const rep = conf.representa ? `<div class="rep"><span>Representante</span><img src="${esc(conf.representa.logo)}" alt="${esc(conf.representa.nome)}"></div>` : '';
    return `<div class="page cover y" id="p-1"><div class="rings"></div><div class="head"><div class="top">${lock()}${meta}</div></div>${ttl}${rep}<div class="tiles">${tiles}</div>${band}</div>`;
  }
  return `<div class="page cover" id="p-1"><img class="motif" src="img/emblema.png" alt=""><div class="top">${lock()}${meta}</div>${ttl}<div class="tiles">${tiles}</div>${band}</div>`;
}
function introHTML(c, info, total, pdf) {
  const conf = CAT[c];
  const pool = prodsOf(c);
  const idx = info.sec.map((s, i) => {
    const marcas = s.groups.map(g => g.marca).filter(m => m !== 'Outros').join(' · ');
    const n = s.groups.reduce((a, g) => a + g.itens.length, 0);
    const lp = precosOn(c) ? secPreco(c, s.nome) : null;
    const sub = `${n} ${n === 1 ? 'item' : 'itens'}${lp !== null ? ' · preço único ' + fmtPreco(lp) : ''}${marcas ? ' · ' + marcas : ''}`;
    return `<a href="#p-${s.start}"><span class="n">${pad2(i + 1)}</span><span class="t"><b>${esc(s.nome)}</b><span>${esc(sub)}</span></span><span class="p"><small>pág.</small>${pad2(s.start)}</span></a>`;
  }).join('');
  const many = info.sec.length > 6;
  const sample = pool.find(p => p.id === conf.exemplo) || pool.find(p => p.foto && (p.cat === 'geral' ? p.aplicacao : p.equiv)) || pool.find(p => p.foto) || pool[0];
  const k = sample ? sample.cat === 'chaves' : c === 'chaves';
  const marks = k
    ? [['1', '19.7mm'], ['2', '25.5mm'], ['3', '30.7mm'], ['4', '39.9mm']]
    : [['1', '28.4mm'], ['2', '33.8mm'], ['3', '45.2mm']];
  const steps = k
    ? `<li><i>1</i><span><b>Fabricante</b> da fechadura ou do cadeado.</span></li><li><i>2</i><span><b>Código</b>: use este número no pedido.</span></li><li><i>3</i><span><b>Descrição</b> da chave e do modelo.</span></li><li><i>4</i><span><b>Equivalências</b> em outras tabelas de código, para conferência.</span></li>`
    : `<li><i>1</i><span><b>Código</b> para o pedido. Quando há versões (2BT, 3BT), cada uma tem o seu código.</span></li><li><i>2</i><span><b>Descrição</b> do produto.</span></li><li><i>3</i><span><b>Aplicação</b> (modelo do veículo) e características, como transponder e frequência.</span></li>`;
  const legend = conf.legenda && !k ? `<div><div class="ih">Como ler os códigos</div><div class="legend">${conf.legenda.map(([a, b]) => `<div><b>${a}</b>${b}</div>`).join('')}</div></div>` : '';
  const selosLi = R.selos ? `<li class="sl"><i>★</i><span><b class="s-novo">NOVO</b> lançamento · <b class="s-oferta">OFERTA</b> condição especial · <b class="s-esg">ESGOTADO</b> sem estoque no momento</span></li>` : '';
  const demo = sample ? `<div class="howto"><div class="demo">${cardHTML(Object.assign({}, sample, { novo: false, oferta: false, esgotado: false }))}${marks.map(m => `<span class="mk" style="left:2mm;top:${m[1]}">${m[0]}</span>`).join('')}</div><ol>${steps}<li><i>✓</i><span>No PDF, <b>toque no produto</b> e o WhatsApp abre com a mensagem pronta.</span></li>${selosLi}</ol></div>` : '';
  const dst = Array.isArray(EMP.destaque) && EMP.destaque[0] ? `<div class="stat"><b>${esc(EMP.destaque[0])}</b><span>${esc(EMP.destaque[1] || '')}</span></div>` : '';
  return `<div class="page intro" id="p-2">${stripHTML(c, pdf)}<div class="content">
    <div class="about${many ? ' sm' : ''}${dst ? '' : ' nostat'}"><div><div class="ih">Sobre a empresa</div><h3>${esc(EMP.ramo)}</h3>${EMP.sobre ? `<p>${esc(EMP.sobre)}</p>` : ''}</div>${dst}</div>
    <div><div class="ih">Neste catálogo</div><div class="idx${many ? ' two' : ''}">${idx}</div></div>
    ${conf.legenda ? legend : ''}
    ${demo ? `<div><div class="ih">Como ler cada produto</div>${demo}</div>` : ''}
    <div class="order"><div><h4>Como pedir</h4><p>Fale conosco pelo WhatsApp da empresa <b>${esc(CONTATO.whats)}</b>${CONTATO.tele ? ` ou pela televendas <b>${esc(CONTATO.tele)}</b>` : ''}. Consulte disponibilidade em estoque.</p></div>${QR ? `<img src="${QR}" alt="QR code do WhatsApp">` : ''}</div>
  </div>${footHTML(2, total, c)}</div>`;
}
function secHTML(c, pg, n, total, count, pdf) {
  const cols = pg.cols;
  const lp = precosOn(c) ? secPreco(c, pg.nome) : null;
  const lote = lp !== null ? `<div class="lote"><span>Preço único</span><b>${esc(fmtPreco(lp))}</b></div>` : '';
  const gl = pg.groups.map(g => g.marca).filter(m => m !== 'Outros');
  const marcas = gl.length > 6 ? `${gl.length} ${c === 'chaves' ? 'fabricantes' : (c === 'novos' ? 'seções' : 'grupos')}: ${gl.slice(0, 5).join(' · ')} e outros` : gl.join(' · ');
  const head = pg.first
    ? `<div class="chead"><div class="secn">${pad2(pg.si + 1)}</div><div class="tt"><h2>${esc(pg.nome)}</h2><div class="ds">${esc(descOf(c, pg.nome))}</div></div>${lote || `<div class="ct"><b>${count} ${count === 1 ? 'item' : 'itens'}</b>${esc(marcas)}</div>`}</div>`
    : `<div class="chead cont"><div class="secn">${pad2(pg.si + 1)}</div><div class="tt"><h2>${esc(pg.nome)}<small>continuação</small></h2></div>${lp !== null ? `<div class="lote sm"><span>Preço único</span><b>${esc(fmtPreco(lp))}</b></div>` : ''}</div>`;
  const rc = (pg.src === 'chaves' ? 'k' : 'g') + (cols === 3 ? ' c3' : '');
  const body = pg.blocks.map(b => b.t === 'grp'
    ? `<div class="grp"><b>${esc(b.g.marca)}</b><span>${b.g.itens.length} ${b.g.itens.length === 1 ? 'item' : 'itens'}</span></div>`
    : `<div class="row ${rc}">${b.itens.map(cardHTML).join('')}</div>`).join('');
  return `<div class="page sec" id="p-${n}">${stripHTML(c, pdf)}${head}<div class="content">${body}</div>${footHTML(n, total, c)}${tabHTML(pg.nome, pg.si)}</div>`;
}
function contraHTML(c, n, pdf) {
  return `<div class="page back" id="p-${n}"><img class="motif" src="img/emblema.png" alt=""><div class="in">
    <div class="kick">Pedidos e orçamentos</div><h2>Fale com<br>a gente</h2>
    <div class="ctc"><div><span>WhatsApp da empresa</span><b>${esc(CONTATO.whats)}</b></div>${CONTATO.tele ? `<div><span>Televendas</span><b>${esc(CONTATO.tele)}</b></div>` : ''}${CONTATO.site ? `<div><span>Catálogo online</span><b>${siteLink()}</b></div>` : ''}${IG ? `<div><span>Instagram</span><b>${igLink()}</b></div>` : ''}</div>
    ${QR ? `<div class="qr"><img src="${QR}" alt="QR code do WhatsApp"><p>Aponte a câmera do celular para abrir o nosso WhatsApp.</p></div>` : ''}
    <div class="bot"><p>Imagens ilustrativas. Consulte disponibilidade em estoque.<br>${esc(catConf(c, pdf).nome)} · atualizado em ${hoje()}.${CFG.aviso ? `<br><span class="aviso">${esc(CFG.aviso)}</span>` : ''}</p>${lock(true)}</div>
  </div></div>`;
}
// Celular: as seções aparecem com 2 produtos por linha, em tamanho quase real
// (o PDF continua no formato A4 de 4 colunas).
const mq = window.matchMedia ? matchMedia('(max-width: 760px)') : { matches: false };
const isMob = () => !!mq.matches;
function mobileHTML(c) {
  const info = buildPages(c);
  const total = info.pages.length;
  const out = [capaHTML(c, info), introHTML(c, info, total)];
  const conf = CAT[c];
  info.sec.forEach(s => {
    const rc = s.src === 'chaves' ? 'k' : 'g';
    const count = s.groups.reduce((a, g) => a + g.itens.length, 0);
    const lp = precosOn(c) ? secPreco(c, s.nome) : null;
    const lote = lp !== null ? `<div class="lote"><span>Preço único</span><b>${esc(fmtPreco(lp))}</b></div>` : '';
    const head = `<div class="chead"><div class="secn">${pad2(s.si + 1)}</div><div class="tt"><h2>${esc(s.nome)}</h2><div class="ds">${esc(descOf(c, s.nome))} · ${count} ${count === 1 ? 'item' : 'itens'}</div></div>${lote}</div>`;
    const rows = items => { let h = ''; for (let i = 0; i < items.length; i += 2) h += `<div class="row ${rc}">${items.slice(i, i + 2).map(cardHTML).join('')}</div>`; return h; };
    const grouped = conf.grupos && !(s.groups.length === 1 && s.groups[0].marca === 'Outros');
    const body = grouped
      ? s.groups.map(g => `<div class="grp"><b>${esc(g.marca)}</b><span>${g.itens.length} ${g.itens.length === 1 ? 'item' : 'itens'}</span></div>${rows(g.itens)}`).join('')
      : rows(s.groups.flatMap(g => g.itens));
    out.push({ m: true, html: `<div class="mpage sec" id="p-${s.start}">${head}<div class="content">${body}</div></div>` });
  });
  out.push(contraHTML(c, total));
  return out;
}
function pageOfProduct(c, id) {
  const i = buildPages(c).pages.findIndex(pg => pg.t === 'sec' && pg.blocks.some(b => b.t === 'row' && b.itens.some(p => p.id === id)));
  return i + 1;
}
function pagesHTML(c, pdf) {
  const info = buildPages(c, pdf);
  const total = info.pages.length;
  const counts = {};
  info.sec.forEach(s => { counts[s.nome] = s.groups.reduce((a, g) => a + g.itens.length, 0); });
  return info.pages.map((pg, i) => {
    const n = i + 1;
    if (pg.t === 'capa') return capaHTML(c, info, pdf);
    if (pg.t === 'intro') return introHTML(c, info, total, pdf);
    if (pg.t === 'contra') return contraHTML(c, n, pdf);
    return secHTML(c, pg, n, total, counts[pg.nome], pdf);
  });
}

/* =========================================================
   Visualização
   ========================================================= */
const viewer = $('#viewer');
let busca = ''; // texto da busca (recurso "busca")
function render() {
  if (curCat === 'novos' && !prodsOf('novos').length) curCat = CATS[0];
  drawTabs();
  if (R.busca && busca.trim()) { viewer.innerHTML = resultadosHTML(busca); fit(); return; }
  const html = isMob() ? null : pagesHTML(curCat);
  const empty = !prodsOf(curCat).length;
  let top = '';
  if (empty && store && store.online) {
    top = canEdit()
      ? `<div class="empty-state"><h3>Catálogo vazio</h3><p>Nenhum produto cadastrado ainda. Você pode começar do zero ou importar o catálogo inicial (data/seed.json), com fotos e descrições, e editar a partir dele.</p><div class="acts"><button class="fbtn primary" type="button" data-act="import">Importar catálogo inicial</button><button class="fbtn" type="button" data-act="novo">Adicionar produto</button></div></div>`
      : `<div class="empty-state"><h3>Catálogo em preparação</h3><p>Os produtos ainda estão sendo cadastrados. Para pedidos, fale no WhatsApp ${esc(CONTATO.whats)}.</p></div>`;
  } else if (upd && canEdit() && store && store.online) {
    top = `<div class="empty-state upd"><h3>Catálogo inicial pronto para entrar</h3><p><b>${upd.novos} produtos novos</b> com foto e descrição${upd.secoes ? `, e ${upd.secoes} seções novas` : ''}, prontos para entrar no catálogo. O que você já cadastrou ou editou não muda.</p><div class="acts"><button class="fbtn primary" type="button" data-act="import">Adicionar ao catálogo</button><button class="fbtn" type="button" data-act="later">Agora não</button></div></div>`;
  }
  const list = isMob() ? mobileHTML(curCat) : html;
  viewer.innerHTML = top + list.map(h => h && h.m
    ? `<div class="sheet m">${h.html.replace(/ id="p-/g, ' data-p="')}</div>`
    : `<div class="sheet">${h.replace(/ id="p-/g, ' data-p="')}</div>`).join('');
  fit();
  encaixar(viewer);
}
// abas: um botão por catálogo ativo, mais "Lançamentos" quando há produtos NOVO
function drawTabs() {
  const nav = $('#seg');
  const vis = TABS.filter(c => c !== 'novos' || prodsOf('novos').length);
  nav.hidden = vis.length < 2;
  nav.classList.toggle('n3', vis.length > 2);
  // no celular, com 3 abas, o começo "Catálogo de" some para caber ("Geral", "Chaves", "Lançamentos")
  const rot = n => { const m = /^(cat[aá]logo\s+(?:de\s+|da\s+|do\s+)?)(.+)$/i.exec(n); return m ? `<span class="pre">${esc(m[1])}</span>${esc(m[2])}` : esc(n); };
  nav.innerHTML = vis.map(c => `<button id="t-${c}" role="tab" type="button" aria-selected="${c === curCat && !(R.busca && busca.trim())}" data-cat="${c}" title="${esc(CAT[c].nome)}"><span class="lb">${rot(CAT[c].nome)}</span> <small id="n-${c}">${prodsOf(c).length}</small></button>`).join('');
}
function fit() {
  const pw = 210 * MM, gap = 22;
  const cs = getComputedStyle(viewer);
  const avail = viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  // duas páginas lado a lado só quando cabem quase em tamanho real; senão uma por vez, maior
  const cols = !isMob() && avail >= 2 * pw * 0.92 + gap ? 2 : 1;
  const s = Math.max(0.2, Math.min(cols === 1 ? 1.2 : 1, (avail - (cols - 1) * gap) / cols / pw));
  viewer.style.setProperty('--s', s.toFixed(4));
  viewer.style.setProperty('--sm', Math.max(0.6, Math.min(1.3, avail / (100 * MM))).toFixed(4));
  // resultados da busca: folha de 200 mm (4 por linha) no computador, 100 mm no celular
  viewer.style.setProperty('--sr', Math.max(0.6, Math.min(isMob() ? 1.3 : 1.2, avail / ((isMob() ? 100 : 200) * MM))).toFixed(4));
  viewer.style.setProperty('--cols', cols);
}
window.addEventListener('resize', fit);
if (mq.addEventListener) mq.addEventListener('change', () => { if (ready) render(); });
viewer.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'import') importSeed(act); else if (a === 'later') { upd = null; render(); }
    else if (a === 'limpar-busca') limparBusca(true);
    else openForm();
    return;
  }
  const a = e.target.closest('a'); if (!a) return;
  const h = a.getAttribute('href') || '';
  if (h.startsWith('#p-')) {
    e.preventDefault();
    const el = viewer.querySelector(`[data-p="${+h.slice(3)}"]`);
    const t = el ? el.closest('.sheet') : viewer.querySelectorAll('.sheet')[+h.slice(3) - 1];
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const card = a.closest('.card');
  if (!card || !card.dataset.id || a.closest('.howto')) return;
  if (canEdit()) { e.preventDefault(); openForm(card.dataset.id); return; }
  // carrinho: o produto entra no pedido (o PDF continua abrindo o WhatsApp direto)
  if (R.carrinho) { e.preventDefault(); openAdd(card.dataset.id); }
  // sem carrinho e sem edição, o link segue normalmente e abre o WhatsApp
});
$('#seg').addEventListener('click', e => {
  const b = e.target.closest('button[data-cat]'); if (!b) return;
  curCat = b.dataset.cat; if (busca) limparBusca(false); render(); window.scrollTo({ top: 0 });
});

function refreshChrome() {
  const ed = canEdit();
  ['#b-lista', '#b-novo', '#m-lista', '#m-novo'].forEach(s => { $(s).hidden = !ed; });
  $('#b-precos').hidden = !ed || !R.precos;
  ['#b-pdf', '#m-pdf'].forEach(s => { $(s).hidden = !R.pdf; });
  ['#b-pedido', '#m-pedido'].forEach(s => { $(s).hidden = !R.carrinho || ed; });
  $('#busca').hidden = !R.busca;
  $('#b-login').hidden = !R.edicao || ed;
  ['#b-logout', '#b-logout-foot'].forEach(s => { $(s).hidden = !ed; });
  $('#pill-prev').hidden = !MARCA_PREVIA;
  document.body.classList.toggle('editando', ed);
  const t = $('#hint-t');
  const pedir = R.carrinho ? 'Toque nos produtos para montar o pedido e envie tudo de uma vez pelo WhatsApp' : 'Toque em um produto para pedir pelo WhatsApp';
  const achar = R.busca ? ' Use a busca para achar pelo código, carro ou marca.' : '';
  const pdfTxt = R.pdf ? ', ou baixe o catálogo em PDF' : '';
  if (!store || !store.online) {
    t.innerHTML = ed
      ? '<b>Demonstração · visão de quem edita.</b> Produtos, marcas e preços são fictícios. Toque em <b>Adicionar produto</b>, escolha a seção, coloque o código e a foto: o item entra na página certa, com índice e numeração atualizados. Toque em um produto para editar. As alterações ficam salvas só neste aparelho. Para voltar à visão do cliente, toque em <b>Sair</b>.'
      : `<b>Demonstração · visão do cliente.</b> Produtos, marcas e preços são fictícios. ${pedir}${pdfTxt}.${achar}${R.edicao ? ' Para ver o painel de edição, toque em <b>Entrar</b> no rodapé (na demonstração não pede senha).' : ''}`;
  } else if (ed) t.innerHTML = '<b>Você está editando o catálogo.</b> Toque em um produto para editar ou em <b>Adicionar produto</b>. As alterações ficam salvas online e aparecem para todos. Para sair, toque em <b>Sair</b> no topo.';
  else t.innerHTML = `<b>Catálogo ${esc(EMP.nome)}.</b> ${pedir}${pdfTxt}.${achar}`;
  contarPedido();
}

/* ---------- avisos ---------- */
let toastT;
function toast(msg, ms = 3400) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- painel lateral ---------- */
const drawer = $('#drawer'), scrim = $('#scrim');
let onClose = null;
function openDrawer(title, sub) {
  if (onClose) { const f = onClose; onClose = null; f(); }
  const body = $('#dr-body'); body.oninput = body.onchange = body.onclick = null; // cada painel registra os seus
  $('#dr-title').textContent = title; $('#dr-sub').textContent = sub || ''; drawer.hidden = false; scrim.hidden = false;
}
function closeDrawer() { drawer.hidden = true; scrim.hidden = true; if (onClose) { const f = onClose; onClose = null; f(); } }
$('#dr-close').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

/* =========================================================
   Busca (recurso "busca")
   ========================================================= */
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const junto = s => s.replace(/[\s.\-\/]+/g, '');
const textoBusca = p => norm([(p.codigos || []).map(x => x.c + ' ' + (x.obs || '')).join(' '), p.nome, p.marca, p.aplicacao, (p.tags || []).join(' '), p.equiv, p.categoria].join(' '));
function buscar(q) {
  const termos = norm(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return [];
  const q0 = junto(norm(q));
  const out = [];
  state.produtos.forEach((p, i) => {
    if (!CATS.includes(p.cat)) return;
    const t = textoBusca(p), tj = junto(t);
    if (!termos.every(x => t.includes(x) || tj.includes(junto(x)))) return;
    const cods = (p.codigos || []).map(x => junto(norm(x.c)));
    // código exato primeiro, depois código que começa com o que foi digitado
    const score = cods.includes(q0) ? 0 : cods.some(c => c.startsWith(q0)) ? 1 : 2;
    out.push({ p, score, i });
  });
  out.sort((a, b) => a.score - b.score || a.i - b.i);
  return out.map(x => x.p);
}
const MAX_RES = 120;
function resultadosHTML(q) {
  const res = buscar(q);
  const cols = isMob() ? 2 : 4;
  const grupos = [], idx = {};
  res.slice(0, MAX_RES).forEach(p => {
    const k = p.cat + '|' + p.categoria;
    if (!(k in idx)) { idx[k] = grupos.length; grupos.push({ cat: p.cat, nome: p.categoria, itens: [] }); }
    grupos[idx[k]].itens.push(p);
  });
  const rows = (items, rc) => { let h = ''; for (let i = 0; i < items.length; i += cols) h += `<div class="row ${rc}">${items.slice(i, i + cols).map(cardHTML).join('')}</div>`; return h; };
  const body = grupos.map(g => `<div class="grp"><b>${esc(g.nome)}</b><span>${CATS.length > 1 ? esc(CAT[g.cat].nome) + ' · ' : ''}${g.itens.length} ${g.itens.length === 1 ? 'item' : 'itens'}</span></div>${rows(g.itens, g.cat === 'chaves' ? 'k' : 'g')}`).join('');
  const n = res.length;
  const ex = state.produtos.find(p => CATS.includes(p.cat) && p.codigos && p.codigos[0]);
  const head = `<div class="rhead"><div><div class="ih">Busca no catálogo</div><h2>${n ? `${n} ${n === 1 ? 'produto' : 'produtos'}` : 'Nada encontrado'} para “${esc(q.trim())}”</h2>${n > MAX_RES ? `<p>Mostrando os ${MAX_RES} primeiros. Digite mais para refinar.</p>` : ''}${n ? '' : `<p>Tente o código${ex ? ` (ex.: ${esc(ex.codigos[0].c)})` : ''}, o modelo do carro ou a marca.</p>`}</div><button class="fbtn" type="button" data-act="limpar-busca">Voltar ao catálogo</button></div>`;
  return `<div class="sheet r"><div class="rpage${isMob() ? ' mob' : ''}">${head}<div class="content">${body}</div></div></div>`;
}
function limparBusca(redesenhar) {
  busca = ''; const f = $('#f-q'); if (f) f.value = '';
  if (redesenhar) { render(); window.scrollTo({ top: 0 }); }
}
let tBusca;
$('#f-q').addEventListener('input', e => {
  clearTimeout(tBusca);
  tBusca = setTimeout(() => { busca = e.target.value; render(); window.scrollTo({ top: 0 }); }, 180);
});
$('#f-q').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.blur(); limparBusca(true); }
  if (e.key === 'Enter') { clearTimeout(tBusca); busca = e.target.value; render(); e.target.blur(); }
});

/* =========================================================
   Carrinho (recurso "carrinho")
   Toque no produto -> escolhe versão e quantidade -> "Seu pedido" -> uma mensagem só no WhatsApp.
   ========================================================= */
const PKEY = 'catalogo-pedido-v1';
let pedido = { itens: [], nome: '', obs: '' };
try { const x = JSON.parse(localStorage.getItem(PKEY)); if (x && Array.isArray(x.itens)) pedido = Object.assign(pedido, x); } catch (e) {}
function salvarPedido() { try { localStorage.setItem(PKEY, JSON.stringify(pedido)); } catch (e) {} contarPedido(); }
// itens do pedido que ainda existem no catálogo, com o produto e a versão escolhida
function itensPedido() {
  return pedido.itens.map(it => {
    const p = state.produtos.find(q => q.id === it.id);
    if (!p || !CATS.includes(p.cat)) return null;
    const cods = p.codigos.filter(x => x.c);
    const i = cods.findIndex(x => x.c === it.c);
    return i < 0 ? null : { it, p, v: cods[i], i };
  }).filter(Boolean);
}
const precoDe = (p, i) => { if (!precosOn(p.cat)) return null; const pi = precoInfo(p); return pi && pi.vs[i] !== undefined ? pi.vs[i] : null; };
function contarPedido() {
  const n = itensPedido().reduce((a, x) => a + x.it.qtd, 0);
  ['#n-pedido', '#nm-pedido'].forEach(s => { const el = $(s); if (el) { el.textContent = n; el.hidden = !n; } });
}
const stepper = (id, v, min = 0) => `<div class="step"><button type="button" data-d="-1" data-for="${id}" aria-label="Diminuir">−</button><input type="number" id="${id}" inputmode="numeric" min="${min}" max="999" value="${v}" aria-label="Quantidade"><button type="button" data-d="1" data-for="${id}" aria-label="Aumentar">+</button></div>`;
const qtdVal = (el, min) => Math.max(min, Math.min(999, Math.round(+el.value) || 0));
function onStep(e, min, after) {
  const b = e.target.closest('[data-d]'); if (!b) return false;
  const inp = document.getElementById(b.dataset.for);
  inp.value = qtdVal({ value: (+inp.value || 0) + (+b.dataset.d) }, min);
  if (after) after(inp);
  return true;
}
function openAdd(id) {
  const p = state.produtos.find(q => q.id === id); if (!p) return;
  const cods = p.codigos.filter(x => x.c);
  const esg = selo(p, 'esgotado');
  openDrawer(esg ? 'Produto esgotado' : 'Adicionar ao pedido', CAT[p.cat].nome);
  const linhas = cods.map((x, i) => { const pr = precoDe(p, i); return `<div class="qrow"><div><b>${esc(x.c)}</b>${x.obs ? `<span>${esc(x.obs)}</span>` : ''}${pr !== null ? `<em>${esc(fmtPreco(pr))}</em>` : ''}</div>${stepper('q-' + i, cods.length === 1 ? 1 : 0)}</div>`; }).join('');
  $('#dr-body').innerHTML = `<div class="preview-box"><div class="pv${p.cat === 'chaves' ? ' k' : ''}"><div class="page" style="width:auto;height:auto;background:none;display:block;overflow:visible">${cardHTML(p)}</div></div><p><b>${esc(p.nome)}</b>${p.marca ? `<br>${esc(p.marca)}` : ''}${p.aplicacao ? ` · ${esc(p.aplicacao)}` : ''}</p></div>
    ${esg ? `<p class="aviso-esg">Este item está <b class="s-esg">ESGOTADO</b> no momento. Pergunte pelo WhatsApp se vai ter reposição.</p>`
      : `<div class="ih2">${cods.length > 1 ? 'Escolha as versões e as quantidades' : 'Quantidade'}</div><div class="qlist">${linhas}</div>`}`;
  $('#dr-foot').innerHTML = esg
    ? `<span class="grow"></span><button class="fbtn" id="b-cancel" type="button">Fechar</button><a class="fbtn primary" href="${waHref(p)}" target="_blank" rel="noopener">Perguntar pelo WhatsApp</a>`
    : `<a class="fbtn" href="${waHref(p)}" target="_blank" rel="noopener">Pedir só este</a><span class="grow"></span><button class="fbtn primary" id="b-add" type="button">Adicionar ao pedido</button>`;
  if (esg) { $('#b-cancel').addEventListener('click', closeDrawer); return; }
  $('#dr-body').onclick = e => onStep(e, 0);
  $('#b-add').addEventListener('click', () => {
    const add = cods.map((x, i) => ({ c: x.c, qtd: qtdVal($('#q-' + i), 0) })).filter(x => x.qtd > 0);
    if (!add.length) { toast('Escolha a quantidade de pelo menos uma versão.'); return; }
    add.forEach(a => {
      const it = pedido.itens.find(x => x.id === p.id && x.c === a.c);
      if (it) it.qtd = Math.min(999, it.qtd + a.qtd); else pedido.itens.push({ id: p.id, c: a.c, qtd: a.qtd });
    });
    salvarPedido(); closeDrawer();
    ['#b-pedido', '#m-pedido'].forEach(s => { const b = $(s); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); });
    toast(`Adicionado: ${add.map(a => a.qtd + '× ' + a.c).join(', ')}. Toque em “Pedido” para enviar.`, 3800);
  });
}
function msgPedido() {
  const its = itensPedido();
  let total = 0, comPreco = 0;
  const linhas = its.map(x => {
    const pr = precoDe(x.p, x.i);
    let l = `• ${x.it.qtd}x ${prodTxt(x.p, x.v.c + (x.v.obs ? ' ' + x.v.obs : ''))}`;
    if (pr !== null) { l += ` – ${fmtPreco(pr)} cada`; total += pr * x.it.qtd; comPreco++; }
    if (selo(x.p, 'esgotado')) l += ' (aparece como ESGOTADO: vai ter reposição?)';
    return l;
  });
  let t = `Olá! Quero fazer este pedido pelo catálogo ${EMP.nome}:\n\n${linhas.join('\n')}`;
  if (comPreco) t += `\n\n${comPreco < its.length ? 'Total dos itens com preço' : 'Total estimado'}: ${fmtPreco(total)}`;
  const extra = [pedido.nome ? 'Nome: ' + pedido.nome : '', pedido.obs ? 'Observação: ' + pedido.obs : ''].filter(Boolean);
  if (extra.length) t += '\n\n' + extra.join('\n');
  return t;
}
function openPedido() {
  openDrawer('Seu pedido', 'Enviado de uma vez pelo WhatsApp');
  const body = $('#dr-body');
  const draw = () => {
    const its = itensPedido();
    if (!its.length) {
      body.innerHTML = `<div class="empty">Seu pedido está vazio. Toque nos produtos do catálogo para adicionar.</div>`;
      $('#dr-foot').innerHTML = `<span class="grow"></span><button class="fbtn" id="b-fechar" type="button">Fechar</button>`;
      $('#b-fechar').addEventListener('click', closeDrawer);
      return;
    }
    let total = 0, sem = 0;
    const lis = its.map((x, k) => {
      const pr = precoDe(x.p, x.i);
      if (pr === null) sem++; else total += pr * x.it.qtd;
      return `<div class="citem"><span class="t">${x.p.foto ? imgTag(x.p.foto) : ''}</span><div class="ci"><div class="c">${esc(x.v.c)}${x.v.obs ? ` <i>${esc(x.v.obs)}</i>` : ''}${selo(x.p, 'esgotado') ? ' <span class="l-esg">ESGOTADO</span>' : ''}</div><div class="n">${esc(x.p.nome)}${x.p.marca ? ' · ' + esc(x.p.marca) : ''}</div>${pr !== null ? `<div class="pr">${esc(fmtPreco(pr))} cada · <b>${esc(fmtPreco(pr * x.it.qtd))}</b></div>` : ''}</div><div class="cact">${stepper('c-' + k, x.it.qtd, 1)}<button class="linkbtn rmv" type="button" data-rm="${k}">Remover</button></div></div>`;
    }).join('');
    const tot = its.length - sem > 0 ? `<div class="ctotal"><span>${sem ? 'Total dos itens com preço' : 'Total estimado'}</span><b>${esc(fmtPreco(total))}</b></div>${sem ? `<p class="help2">${sem} ${sem === 1 ? 'item está' : 'itens estão'} sem preço no catálogo: o valor vem na resposta da empresa.</p>` : ''}` : '';
    body.innerHTML = `<div class="clist">${lis}</div>${tot}
      <div class="field"><label for="f-pnome">Seu nome ou empresa (opcional)</label><input type="text" id="f-pnome" value="${esc(pedido.nome)}" autocomplete="organization"></div>
      <div class="field"><label for="f-pobs">Observação (opcional)</label><input type="text" id="f-pobs" value="${esc(pedido.obs)}" placeholder="Ex.: retirar na loja"></div>`;
    $('#dr-foot').innerHTML = `<button class="fbtn" id="b-limpar" type="button">Limpar pedido</button><span class="grow"></span><a class="fbtn primary" id="b-enviar" href="${waLink(msgPedido())}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>`;
    let armed = false;
    $('#b-limpar').addEventListener('click', e => {
      if (!armed) { armed = true; e.target.textContent = 'Toque de novo para limpar'; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = 'Limpar pedido'; }, 4000); return; }
      pedido.itens = []; salvarPedido(); draw();
    });
    $('#b-enviar').addEventListener('click', () => { setTimeout(() => toast('O pedido abriu no WhatsApp: é só enviar a mensagem por lá.', 4500), 300); });
  };
  const atualizarLink = () => { const a = $('#b-enviar'); if (a) a.href = waLink(msgPedido()); };
  body.onclick = e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { const x = itensPedido()[+rm.dataset.rm]; pedido.itens = pedido.itens.filter(i => i !== (x && x.it)); salvarPedido(); draw(); return; }
    onStep(e, 1, inp => { const x = itensPedido()[+inp.id.slice(2)]; if (x) { x.it.qtd = +inp.value; salvarPedido(); draw(); } });
  };
  body.onchange = e => {
    const t = e.target;
    if (/^c-\d+$/.test(t.id)) { const x = itensPedido()[+t.id.slice(2)]; if (x) { x.it.qtd = qtdVal(t, 1); salvarPedido(); draw(); } }
  };
  body.oninput = e => {
    if (e.target.id === 'f-pnome') pedido.nome = e.target.value.trim().slice(0, 80);
    else if (e.target.id === 'f-pobs') pedido.obs = e.target.value.trim().slice(0, 200);
    else return;
    salvarPedido(); atualizarLink();
  };
  draw();
}
['#b-pedido', '#m-pedido'].forEach(s => $(s).addEventListener('click', openPedido));

/* =========================================================
   Formulário de produto
   ========================================================= */
let draft = null;
function openForm(id) {
  if (!canEdit()) return;
  const ed = id ? state.produtos.find(p => p.id === id) : null;
  const c = ed ? ed.cat : realCat(curCat);
  // na aba Lançamentos e na busca, editar não troca de aba
  if (ed && c !== curCat && curCat !== 'novos' && !busca.trim()) { curCat = c; render(); }
  draft = ed ? clone(ed) : { id: '', cat: c, categoria: allCatsOf(c)[0] || '', marca: '', nome: '', codigos: [{ c: '', obs: '' }], aplicacao: '', tags: [], equiv: '', foto: '', novo: true, oferta: false, esgotado: false, preco: null };
  draft.fotoBlob = null;
  const conf = CAT[c];
  const cats = allCatsOf(c);
  const marcas = [...new Set(state.produtos.filter(p => p.cat === c).map(p => p.marca).filter(Boolean))];
  openDrawer(ed ? 'Editar produto' : 'Novo produto', conf.nome);
  $('#dr-body').innerHTML = `
    <div class="preview-box"><div class="pv${c === 'chaves' ? ' k' : ''}" id="pv"></div><p><b>Assim o produto aparece no catálogo.</b> Ao salvar, ele entra na seção escolhida e as páginas se reorganizam sozinhas.</p></div>
    <div class="field" id="fx-cat"><label for="f-cat">Seção do catálogo</label>
      <select id="f-cat">${cats.map(n => `<option${n === draft.categoria ? ' selected' : ''}>${esc(n)}</option>`).join('')}<option value="__nova"${cats.length ? '' : ' selected'}>+ Nova seção…</option></select>
      <input type="text" id="f-catnova" placeholder="Nome da nova seção"${cats.length ? ' hidden' : ''}></div>
    <div class="field"><label for="f-marca">${conf.marcaLbl}</label><input type="text" id="f-marca" list="dl-marcas" value="${esc(draft.marca)}" placeholder="${conf.marcaEx}" autocomplete="off">
      <datalist id="dl-marcas">${marcas.map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>
    <div class="field" id="fx-nome"><label for="f-nome">Descrição</label><input type="text" id="f-nome" value="${esc(draft.nome)}" placeholder="${c === 'chaves' ? 'Ex.: Papaiz fechadura LY' : 'Ex.: Carcaça canivete'}"></div>
    <div class="field" id="fx-cod"><span class="lbl">Código${c === 'geral' ? ' e versões' : ''}</span><div class="codes" id="codes"></div>
      <button class="linkbtn" id="add-cod" type="button">+ Adicionar versão (ex.: 2BT / 3BT)</button></div>
    <div class="field" id="fx-preco"${R.precos ? '' : ' hidden'}><label for="f-preco">Preço (R$)</label><input type="text" id="f-preco" inputmode="decimal" autocomplete="off" value="${esc(precoTxt(num(draft.preco)))}" placeholder="Ex.: 45,00"><div class="help" id="h-preco"></div></div>
    ${c === 'geral'
      ? `<div class="row2"><div class="field"><label for="f-apl">Aplicação</label><input type="text" id="f-apl" value="${esc(draft.aplicacao)}" placeholder="Ex.: Onix"></div>
         <div class="field"><label for="f-tags">Características</label><input type="text" id="f-tags" value="${esc((draft.tags || []).join(', '))}" placeholder="Ex.: ID46, 433 MHz"></div></div>`
      : `<div class="field"><label for="f-eq">Equivalências</label><input type="text" id="f-eq" value="${esc(draft.equiv)}" placeholder="Ex.: G 142 · D 142"></div>`}
    <div class="field"><span class="lbl">Foto</span><div class="photo"><div class="thumb" id="thumb">${draft.foto ? imgTag(draft.foto) : 'Sem foto'}</div>
      <div><label class="up" for="f-foto"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg>${draft.foto ? 'Trocar foto' : 'Escolher foto'}</label>
      <input type="file" id="f-foto" accept="image/*"><div class="help" style="margin-top:6px">Fundo branco fica melhor. A foto é ajustada automaticamente.</div></div></div></div>
    <div class="checks"${R.selos || R.lancamentos ? '' : ' hidden'}>
      <label class="check"><input type="checkbox" id="f-novo"${draft.novo ? ' checked' : ''}><span>${R.selos ? 'Mostrar selo <b class="s-novo">NOVO</b> (lançamento)' : 'Lançamento (entra na aba <b>' + esc(CAT.novos.nome) + '</b>)'}${R.selos && R.lancamentos ? '<small>Também entra na aba ' + esc(CAT.novos.nome) + ' e no PDF de lançamentos.</small>' : ''}</span></label>
      <label class="check"${R.selos ? '' : ' hidden'}><input type="checkbox" id="f-oferta"${draft.oferta ? ' checked' : ''}><span>Mostrar selo <b class="s-oferta">OFERTA</b></span></label>
      <label class="check"${R.selos ? '' : ' hidden'}><input type="checkbox" id="f-esgotado"${draft.esgotado ? ' checked' : ''}><span>Marcar como <b class="s-esg">ESGOTADO</b><small>O pedido pelo WhatsApp chega avisando que o item está esgotado.</small></span></label>
    </div>
    ${ed ? `<div class="field"><span class="lbl">Link do WhatsApp deste produto</span><a class="linkbtn" href="${waHref(ed)}" target="_blank" rel="noopener">Abrir mensagem de pedido ↗</a></div>` : ''}`;
  $('#dr-foot').innerHTML = `${ed ? '<button class="fbtn danger" id="b-del" type="button">Excluir</button>' : ''}<span class="grow"></span><button class="fbtn" id="b-cancel" type="button">Cancelar</button><button class="fbtn primary" id="b-save" type="button">${ed ? 'Salvar alterações' : 'Salvar produto'}</button>`;
  drawCodes(); updatePreview();
  const body = $('#dr-body');
  body.oninput = syncDraft;
  body.onchange = syncDraft;
  $('#f-cat').addEventListener('change', e => { const nv = e.target.value === '__nova'; $('#f-catnova').hidden = !nv; if (nv) $('#f-catnova').focus(); });
  $('#add-cod').addEventListener('click', () => { draft.codigos.push({ c: '', obs: '' }); drawCodes(); const ins = $('#codes').querySelectorAll('input[data-k="c"]'); ins[ins.length - 1].focus(); });
  $('#f-foto').addEventListener('change', onFoto);
  $('#b-cancel').addEventListener('click', closeDrawer);
  $('#b-save').addEventListener('click', () => save(!ed));
  if (ed) {
    const del = $('#b-del'); let armed = false, tm;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.classList.add('armed'); del.textContent = 'Toque de novo para excluir'; tm = setTimeout(() => { armed = false; del.classList.remove('armed'); del.textContent = 'Excluir'; }, 4000); return; }
      clearTimeout(tm); del.disabled = true;
      try { await store.deleteProduto(ed.id); }
      catch (e) { del.disabled = false; toast('Não foi possível excluir: ' + errMsg(e), 5000); return; }
      state.produtos = state.produtos.filter(p => p.id !== ed.id); store.afterChange(state); closeDrawer(); render();
      toast(`Produto ${ed.codigos[0] ? ed.codigos[0].c : ''} excluído do catálogo.`);
    });
  }
  if (!ed && window.matchMedia && matchMedia('(pointer: fine)').matches) setTimeout(() => { const el = $('#f-nome'); if (el) el.focus(); }, 60);
}
function drawCodes() {
  const wp = draft.codigos.length > 1 && R.precos;
  $('#codes').innerHTML = draft.codigos.map((x, i) => `<div class="code-row${wp ? ' wp' : ''}"><input type="text" id="f-cod-${i}" data-i="${i}" data-k="c" value="${esc(x.c)}" placeholder="Código" aria-label="Código ${i + 1}" autocapitalize="characters">
    <input type="text" id="f-obs-${i}" data-i="${i}" data-k="obs" value="${esc(x.obs)}" placeholder="${draft.cat === 'geral' ? 'Versão' : 'Obs.'}" aria-label="Versão do código ${i + 1}">
    ${wp ? `<input type="text" id="f-pv-${i}" data-i="${i}" data-k="pv" inputmode="decimal" value="${esc(precoTxt(num(x.preco)))}" placeholder="Preço" aria-label="Preço da versão ${i + 1}">` : ''}
    <button class="rm" type="button" data-rm="${i}" aria-label="Remover código"${draft.codigos.length === 1 ? ' disabled' : ''}>×</button></div>`).join('');
  $('#codes').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { draft.codigos.splice(+b.dataset.rm, 1); drawCodes(); updatePreview(); }));
  precoHelp();
}
function precoHelp() {
  const h = $('#h-preco'); if (!h) return;
  const lp = secPreco(draft.cat, draft.categoria);
  const multi = draft.codigos.length > 1;
  let t = lp !== null ? `Em branco, vale o preço único da seção: <b>${esc(fmtPreco(lp))}</b>.` : 'Opcional. Em branco, o produto aparece sem preço.';
  if (multi) t += ' Cada versão pode ter um preço próprio na coluna “Preço” acima.';
  if (!precosOn(draft.cat)) t += ' <span class="warn">Os preços deste catálogo estão ocultos. Para mostrar, use o botão Preços.</span>';
  h.innerHTML = t;
}
function syncDraft(e) {
  const t = e && e.target;
  if (t && t.dataset && t.dataset.i !== undefined && t.dataset.k) {
    const x = draft.codigos[+t.dataset.i];
    if (t.dataset.k === 'pv') { const v = parsePreco(t.value); if (v === null) delete x.preco; else x.preco = v; }
    else x[t.dataset.k] = t.dataset.k === 'c' ? t.value.toUpperCase() : t.value;
  }
  const sel = $('#f-cat').value;
  draft.categoria = sel === '__nova' ? $('#f-catnova').value.trim() : sel;
  draft.marca = $('#f-marca').value.trim();
  draft.nome = $('#f-nome').value.trim();
  if ($('#f-apl')) draft.aplicacao = $('#f-apl').value.trim();
  if ($('#f-tags')) draft.tags = $('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
  if ($('#f-eq')) draft.equiv = $('#f-eq').value.trim();
  draft.novo = $('#f-novo').checked;
  draft.oferta = $('#f-oferta').checked;
  draft.esgotado = $('#f-esgotado').checked;
  draft.preco = parsePreco($('#f-preco').value);
  precoHelp();
  updatePreview();
}
function updatePreview() {
  const p = Object.assign({}, draft, { nome: draft.nome || 'Descrição do produto', codigos: draft.codigos.some(x => x.c) ? draft.codigos : [{ c: draft.cat === 'chaves' ? '0000' : 'CÓDIGO', obs: '' }] });
  $('#pv').innerHTML = `<div class="page" style="width:auto;height:auto;background:none;display:block;overflow:visible">${cardHTML(p)}</div>`;
}
function onFoto(e) {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  const im = new Image();
  im.onload = () => {
    const m = 900, r = Math.min(1, m / Math.max(im.width, im.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(im.width * r); cv.height = Math.round(im.height * r);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    draft.foto = cv.toDataURL('image/jpeg', 0.85);
    cv.toBlob(b => { draft.fotoBlob = b; }, 'image/jpeg', 0.85);
    $('#thumb').innerHTML = `<img src="${draft.foto}" alt="">`;
    updatePreview();
  };
  im.onerror = () => { URL.revokeObjectURL(url); toast('Não consegui abrir essa imagem. Tente uma foto em JPG ou PNG.'); };
  im.src = url;
}
function fieldErr(id, msg) { const f = $(id); f.classList.add('err'); if (!f.querySelector('.errmsg')) f.insertAdjacentHTML('beforeend', `<div class="errmsg">${msg}</div>`); }
async function save(isNew) {
  syncDraft();
  document.querySelectorAll('.field.err').forEach(f => { f.classList.remove('err'); const m = f.querySelector('.errmsg'); if (m) m.remove(); });
  draft.codigos = draft.codigos.map(x => Object.assign({ c: (x.c || '').trim().toUpperCase(), obs: (x.obs || '').trim() }, draft.codigos.length > 1 && num(x.preco) !== null ? { preco: num(x.preco) } : {}));
  let ok = true;
  if (!draft.categoria) { fieldErr('#fx-cat', 'Dê um nome para a nova seção.'); ok = false; }
  if (!draft.nome) { fieldErr('#fx-nome', 'Escreva uma descrição curta do produto.'); ok = false; }
  if (!draft.codigos.some(x => x.c)) { fieldErr('#fx-cod', 'Informe pelo menos um código.'); ok = false; }
  if (!ok) return;
  const btn = $('#b-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  const c = draft.cat;
  const arr = state.produtos;
  try {
    if (!state.cats[c].some(x => x.nome === draft.categoria)) {
      await store.ensureSecao(c, draft.categoria, (state.cats[c].length + 1) * 10);
      state.cats[c].push({ nome: draft.categoria, desc: '' });
    }
    if (draft.fotoBlob || (draft.foto && draft.foto.startsWith('data:') && store.online)) {
      const blob = draft.fotoBlob || await (await fetch(draft.foto)).blob();
      draft.foto = await store.uploadFoto(blob, c, draft.foto);
    }
    const p = Object.assign({}, draft, { codigos: draft.codigos.filter(x => x.c) });
    delete p.fotoBlob;
    let at = -1;
    if (isNew) {
      arr.forEach((q, i) => { if (q.cat === c && q.categoria === p.categoria && (q.marca || '') === p.marca) at = i; });
      if (at < 0) arr.forEach((q, i) => { if (q.cat === c && q.categoria === p.categoria) at = i; });
      if (at < 0) { at = arr.length - 1; }
      const prev = arr[at] ? arr[at].ordem : 0, next = arr[at + 1] ? arr[at + 1].ordem : null;
      p.ordem = next == null ? prev + 10 : (prev + next) / 2;
    }
    const saved = await store.saveProduto(p, isNew);
    if (isNew) arr.splice(at + 1, 0, saved); else arr[arr.findIndex(q => q.id === saved.id)] = saved;
    const persisted = store.afterChange(state);
    closeDrawer(); render();
    const cod = saved.codigos[0].c;
    const card = viewer.querySelector(`.sec .card[data-id="${CSS.escape(saved.id)}"]`);
    if (card) {
      const n = pageOfProduct(c, saved.id);
      const r = card.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - innerHeight / 2 + r.height / 2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      toast(`${isNew ? 'Produto' : 'Alterações do'} ${cod} ${isNew ? 'adicionado' : 'salvas'} · página ${n}.${persisted ? '' : ' Atenção: não foi possível salvar neste aparelho (memória cheia).'}`, 4200);
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = isNew ? 'Salvar produto' : 'Salvar alterações';
    toast('Não foi possível salvar: ' + errMsg(e), 6000);
  }
}

/* =========================================================
   Lista de produtos
   ========================================================= */
function openList() {
  if (!canEdit()) return;
  const c = realCat(curCat);
  openDrawer('Produtos', CAT[c].nome);
  $('#dr-body').innerHTML = `<input class="search" id="f-busca" type="search" placeholder="Buscar por código, descrição ou marca" aria-label="Buscar produto"><div id="lst"></div>`;
  const bPrecos = R.precos ? '<button class="fbtn" id="b-l-precos" type="button">Preços</button>' : '';
  $('#dr-foot').innerHTML = store.online
    ? `<button class="fbtn" id="b-sair" type="button">Sair</button><span class="grow"></span>${bPrecos}<button class="fbtn primary" id="b-l-novo" type="button">+ Adicionar</button>`
    : `<button class="fbtn" id="b-reset" type="button">Restaurar exemplo</button><span class="grow"></span>${bPrecos}<button class="fbtn primary" id="b-l-novo" type="button">+ Adicionar</button>`;
  const draw = () => {
    const q = $('#f-busca').value.trim().toLowerCase();
    const html = allCatsOf(c).map(nome => {
      const items = state.produtos.filter(p => p.cat === c && p.categoria === nome && (!q || norm([p.nome, p.marca, p.aplicacao, ...p.codigos.map(x => x.c)].join(' ')).includes(norm(q))));
      if (!items.length) return '';
      return `<div class="lgroup"><h3><span>${esc(nome)}</span><span>${items.length}</span></h3>${items.map(p => `<button class="litem" type="button" data-id="${esc(p.id)}"><span class="t">${p.foto ? imgTag(p.foto) : ''}</span><div><div class="c">${esc(p.codigos.map(x => x.c).join(' / '))}</div><div class="n">${esc(p.nome)}${p.marca ? ' · ' + esc(p.marca) : ''}${num(p.preco) !== null ? ' · ' + esc(fmtPreco(num(p.preco))) : ''}</div></div><span class="lsel">${p.esgotado ? '<span class="l-esg">ESGOTADO</span>' : ''}${p.oferta ? '<span class="l-oferta">OFERTA</span>' : ''}${p.novo ? '<span class="new">NOVO</span>' : ''}</span></button>`).join('')}</div>`;
    }).join('');
    $('#lst').innerHTML = html || `<div class="empty">${q ? `Nenhum produto encontrado para “${esc(q)}”.` : 'Nenhum produto neste catálogo ainda.'}</div>`;
  };
  draw();
  $('#f-busca').addEventListener('input', draw);
  $('#lst').addEventListener('click', e => { const b = e.target.closest('.litem'); if (b) openForm(b.dataset.id); });
  $('#b-l-novo').addEventListener('click', () => openForm());
  if (R.precos) $('#b-l-precos').addEventListener('click', openPrecos);
  if (store.online) {
    $('#b-sair').addEventListener('click', logout);
  } else {
    let armed = false;
    $('#b-reset').addEventListener('click', e => {
      if (!armed) { armed = true; e.target.textContent = 'Toque de novo para restaurar'; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = 'Restaurar exemplo'; }, 4000); return; }
      store.reset(); seedData().then(sd => { state = sd; closeDrawer(); render(); toast('Catálogo de exemplo restaurado.'); }).catch(err => toast('Não foi possível restaurar: ' + errMsg(err)));
    });
  }
}

/* ---------- preços ---------- */
function openPrecos() {
  if (!canEdit() || !R.precos) return;
  const c = realCat(curCat);
  const secs = allCatsOf(c);
  const proprios = state.produtos.filter(p => p.cat === c && (num(p.preco) !== null || (p.codigos || []).some(x => num(x.preco) !== null))).length;
  openDrawer('Preços', CAT[c].nome);
  $('#dr-body').innerHTML = `
    <label class="switch"><input type="checkbox" id="f-mostrar"${precosOn(c) ? ' checked' : ''}><span class="sw" aria-hidden="true"></span><span><b>Mostrar preços neste catálogo</b><small>Desligado, ninguém vê preço: nem no site, nem no PDF. Você pode preencher antes e ligar quando quiser.</small></span></label>
    <div class="ih2">Preço único por seção (lote)</div>
    <p class="help2">Vale para todos os produtos da seção que não têm preço próprio. Use para Yale, Tetra, Plástica e outras linhas com preço igual para todas. Deixe em branco para não usar.</p>
    <div class="plist">${secs.map((n, i) => {
      const k = state.produtos.filter(p => p.cat === c && p.categoria === n).length;
      return `<div class="prow"><label for="f-sp-${i}"><b>${esc(n)}</b><small>${k} ${k === 1 ? 'item' : 'itens'}</small></label><div class="money"><span>R$</span><input type="text" id="f-sp-${i}" data-sec="${esc(n)}" inputmode="decimal" autocomplete="off" value="${esc(precoTxt(secPreco(c, n)))}" placeholder="—"></div></div>`;
    }).join('')}</div>
    <div class="ih2">Preço por produto</div>
    <p class="help2">Abra o produto e preencha <b>Preço</b> (e, se tiver versões como 2BT e 3BT, o preço de cada uma). O preço do produto vale mais que o da seção. ${proprios ? `Hoje <b>${proprios}</b> ${proprios === 1 ? 'produto tem' : 'produtos têm'} preço próprio neste catálogo.` : 'Nenhum produto tem preço próprio neste catálogo ainda.'}</p>`;
  $('#dr-foot').innerHTML = `<span class="grow"></span><button class="fbtn" id="b-cancel" type="button">Cancelar</button><button class="fbtn primary" id="b-psave" type="button">Salvar preços</button>`;
  $('#b-cancel').addEventListener('click', closeDrawer);
  $('#b-psave').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const mostrar = $('#f-mostrar').checked;
      const mud = [];
      $('#dr-body').querySelectorAll('[data-sec]').forEach(inp => {
        const nome = inp.dataset.sec, v = parsePreco(inp.value);
        if (v !== secPreco(c, nome)) {
          const i = (state.cats[c] || []).findIndex(x => x.nome === nome);
          mud.push({ cat: c, nome, preco: v, ordem: i >= 0 ? (state.cats[c][i].ordem ?? (i + 1) * 10) : ((state.cats[c] || []).length + 1) * 10 });
        }
      });
      if (mud.length) await store.saveSecoes(mud);
      mud.forEach(m => { const x = (state.cats[c] || []).find(y => y.nome === m.nome); if (x) x.preco = m.preco; else state.cats[c].push({ nome: m.nome, desc: '', preco: m.preco }); });
      if (mostrar !== precosOn(c)) {
        await store.saveConfig({ precos: { [c]: mostrar } });
        state.config.precos = Object.assign({}, state.config.precos, { [c]: mostrar });
      }
      store.afterChange(state);
      closeDrawer(); render();
      toast(mostrar ? 'Preços salvos e visíveis no catálogo.' : 'Preços salvos. Eles continuam ocultos até você ligar "Mostrar preços".', 4500);
    } catch (err) { btn.disabled = false; btn.textContent = 'Salvar preços'; toast('Não foi possível salvar: ' + errMsg(err), 6000); }
  });
}

/* ---------- login (modo online) ---------- */
function openLogin() {
  // demonstração: sem senha, só troca para a visão de quem edita
  if (!store.online) { store.signIn().then(() => { window.scrollTo({ top: 0 }); toast('Demonstração: agora você vê o painel de edição. Toque em um produto para editar.', 4500); }); return; }
  openDrawer('Entrar', 'Acesso para editar o catálogo');
  $('#dr-body').innerHTML = `<form id="f-login" novalidate>
    <div class="field" id="fx-senha"><label for="f-senha">Senha de administrador</label><input type="password" id="f-senha" autocomplete="current-password" style="width:100%;border:1px solid var(--line);background:var(--surface-2);border-radius:9px;padding:10px 11px;font-size:15px"></div>
    <p class="help" style="margin:0;color:var(--muted);font-size:13px">Só a sua empresa edita o catálogo. Os clientes veem os produtos sem precisar entrar. O acesso fica salvo neste aparelho por 30 dias.</p>
  </form>`;
  $('#dr-foot').innerHTML = `<span class="grow"></span><button class="fbtn" id="b-cancel" type="button">Cancelar</button><button class="fbtn primary" id="b-entrar" type="submit" form="f-login">Entrar</button>`;
  $('#b-cancel').addEventListener('click', closeDrawer);
  $('#f-login').addEventListener('submit', async e => {
    e.preventDefault();
    document.querySelectorAll('.field.err').forEach(f => { f.classList.remove('err'); const m = f.querySelector('.errmsg'); if (m) m.remove(); });
    const senha = $('#f-senha').value;
    if (!senha) { fieldErr('#fx-senha', 'Digite a senha.'); return; }
    const b = $('#b-entrar'); b.disabled = true; b.textContent = 'Entrando…';
    try {
      await store.signIn(senha);
      closeDrawer();
      state = await store.load(); state.produtos.sort((a, x) => a.ordem - x.ordem);
      await checkUpdate(); render();
      toast('Pronto! Toque em um produto para editar ou em Adicionar produto.', 4200);
    } catch (err) { b.disabled = false; b.textContent = 'Entrar'; fieldErr('#fx-senha', esc(errMsg(err))); }
  });
  setTimeout(() => { const el = $('#f-senha'); if (el) el.focus(); }, 60);
}
/* ---------- catálogo completo (data/seed.json) ---------- */
// Mostra o aviso para o administrador quando há produtos do catálogo completo que
// ainda não estão no Netlify. Nada é sobrescrito: só entram os que faltam.
async function checkUpdate() {
  upd = null;
  if (!canEdit() || !store || !store.online || !store.importar) return;
  let sd; try { sd = await loadSeed(); } catch (e) { return; }
  if ((state.config.seedVersao || 0) >= sd.versao) return;
  const ids = new Set(state.produtos.map(p => p.id));
  const novos = sd.produtos.filter(p => !ids.has(p.id)).length;
  const secoes = ['geral', 'chaves'].reduce((a, c) => a + sd.cats[c].filter(x => !(state.cats[c] || []).some(y => y.nome === x.nome)).length, 0);
  if (novos || secoes) upd = { novos, secoes };
}
async function importSeed(btn) {
  if (!canEdit() || !store.importar) return;
  btn.disabled = true;
  const say = t => { btn.textContent = t; };
  try {
    say('Carregando…');
    const sd = await loadSeed();
    const seedOrd = new Map(sd.produtos.map((p, i) => [p.id, (i + 1) * 10]));
    // 1) seções na ordem dos PDFs (mantém o preço único que já estiver definido)
    const secs = [];
    ['geral', 'chaves'].forEach(c => {
      const nomes = sd.cats[c].map(x => x.nome);
      sd.cats[c].forEach((x, i) => secs.push({ cat: c, nome: x.nome, desc: x.desc, ordem: (i + 1) * 10 }));
      // seções criadas pelo cliente ficam logo depois da seção que vinha antes delas
      let prev = 0;
      (state.cats[c] || []).forEach(x => {
        const j = nomes.indexOf(x.nome);
        if (j >= 0) prev = (j + 1) * 10; else secs.push({ cat: c, nome: x.nome, ordem: prev + 5 });
      });
    });
    say('Organizando seções…');
    await store.saveSecoes(secs);
    // 2) produtos que faltam
    const ids = new Set(state.produtos.map(p => p.id));
    const faltam = sd.produtos.filter(p => !ids.has(p.id)).map(p => Object.assign({}, p, { ordem: seedOrd.get(p.id) }));
    let feitos = 0;
    for (let i = 0; i < faltam.length; i += 120) {
      say(`Gravando produtos… ${Math.round(i / Math.max(1, faltam.length) * 100)}%`);
      const r = await store.importar(faltam.slice(i, i + 120));
      feitos += (r && r.importados) || 0;
    }
    // 3) nova ordem para os que já existiam: os do catálogo seguem a ordem dos PDFs e os
    //    cadastrados pelo cliente ficam logo depois do produto que vinha antes deles
    const itens = [];
    const cur = state.produtos.slice().sort((a, b) => a.ordem - b.ordem);
    const porSecao = {};
    cur.forEach(p => { (porSecao[p.cat + '|' + p.categoria] = porSecao[p.cat + '|' + p.categoria] || []).push(p); });
    Object.values(porSecao).forEach(lista => {
      let last = null, k = 0;
      const primeiro = Math.min(...lista.map(p => seedOrd.get(p.id) ?? Infinity));
      lista.forEach(p => {
        if (seedOrd.has(p.id)) { last = seedOrd.get(p.id); k = 0; itens.push({ id: p.id, ordem: last }); }
        else { k++; const base = last ?? (Number.isFinite(primeiro) ? primeiro - 5 : p.ordem); itens.push({ id: p.id, ordem: +(base + k * 0.01).toFixed(4) }); }
      });
    });
    for (let i = 0; i < itens.length; i += 200) { say('Ajustando a ordem…'); await store.reorder(itens.slice(i, i + 200)); }
    await store.saveConfig({ seedVersao: sd.versao });
    state = await store.load(); state.produtos.sort((a, b) => a.ordem - b.ordem);
    upd = null; render();
    toast(`Catálogo completo: ${feitos} produtos adicionados.`, 5000);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Tentar de novo';
    toast('Não foi possível terminar: ' + errMsg(e) + '. Pode tocar de novo: o que já entrou não se repete.', 7000);
  }
}

/* =========================================================
   PDF
   ========================================================= */
const stage = $('#stage');
function renderStage(c) { stage.innerHTML = pagesHTML(c, true).join('').replace(/ loading="lazy"/g, ''); stage.hidden = false; return stage; }
// Todas as fontes do catálogo, carregadas de propósito antes de fotografar as páginas
// (no documento e na cópia que o html2canvas monta); sem isso o PDF pode sair com a
// fonte padrão do aparelho, mais larga, e os títulos estouram.
const FONTES = ['500', '600', '700', '800'].map(w => `${w} 20px "Barlow Condensed"`)
  .concat(['400', '500', '600', '700'].map(w => `${w} 20px "Barlow"`), ['500', '600'].map(w => `${w} 20px "IBM Plex Mono"`));
async function carregarFontes(doc) {
  const fs = doc && doc.fonts; if (!fs || !fs.load) return true;
  const tudo = Promise.all(FONTES.map(f => fs.load(f, 'AÁÇÃ09').catch(() => null))).then(() => fs.ready);
  await Promise.race([tudo, new Promise(r => setTimeout(r, 12000))]);
  return FONTES.every(f => { try { return fs.check(f, 'AÁÇÃ09'); } catch (e) { return true; } });
}
// Rede de segurança: título ou item do sumário que não cabe na largura diminui até caber.
function encaixar(root) {
  root.querySelectorAll('.cover h1 .a, .cover h1 .b > span, .cover .toc > *, .page .chead h2, .page .grp b').forEach(el => {
    const caixa = el.matches('.grp b') ? el.parentElement : el;
    if (el.style.fontSize) el.style.fontSize = '';
    if (caixa.scrollWidth <= caixa.clientWidth + 1) return;
    let fs = parseFloat(getComputedStyle(el).fontSize);
    for (let i = 0; i < 16 && caixa.scrollWidth > caixa.clientWidth + 1; i++) { fs *= 0.95; el.style.fontSize = fs.toFixed(2) + 'px'; }
  });
}
async function settle(root) {
  await carregarFontes(document);
  try { await document.fonts.ready; } catch (e) {}
  await Promise.all([...root.querySelectorAll('img')].map(i => (i.complete && i.naturalWidth) ? null : new Promise(r => { i.onload = i.onerror = r; })));
  encaixar(root);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Não consegui carregar ' + src.split('/').pop())); document.head.appendChild(s);
  });
}
async function buildPdf(c, onProgress) {
  await loadScript(LIBS.h2c); await loadScript(LIBS.pdf);
  renderStage(c); await settle(stage);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const pages = [...stage.querySelectorAll('.page')];
  try {
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      if (onProgress) onProgress(i, pages.length);
      const canvas = await window.html2canvas(pg, { scale: 1.75, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollX: -window.scrollX, scrollY: -window.scrollY, windowWidth: document.documentElement.clientWidth, onclone: doc => carregarFontes(doc) });
      if (i) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.84), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      const pr = pg.getBoundingClientRect();
      pg.querySelectorAll('a[href]').forEach(a => {
        const r = a.getBoundingClientRect();
        const x = (r.left - pr.left) / MM, y = (r.top - pr.top) / MM, w = r.width / MM, h = r.height / MM;
        const href = a.getAttribute('href');
        if (href.startsWith('#p-')) pdf.link(x, y, w, h, { pageNumber: +href.slice(3) }); else pdf.link(x, y, w, h, { url: href });
      });
    }
  } finally { stage.hidden = true; stage.innerHTML = ''; }
  pdf.setProperties({ title: catConf(c, true).nome + ' ' + EMP.nome, author: EMP.nome, subject: 'Catálogo de produtos' });
  return { blob: pdf.output('blob'), pages: pages.length };
}
async function onPdf() {
  const busy = $('#busy'); busy.hidden = false; $('#busy-bar').style.width = '0'; $('#busy-t').textContent = 'Preparando páginas…';
  const longo = buildPages(curCat, true).pages.length > 20 ? ' · pode levar 1 a 2 minutos' : '';
  try {
    const out = await buildPdf(curCat, (i, n) => { $('#busy-t').textContent = `Página ${i + 1} de ${n}${longo}`; $('#busy-bar').style.width = Math.round((i + 1) / n * 100) + '%'; });
    busy.hidden = true;
    pdfReady(out.blob, out.pages);
  } catch (e) {
    busy.hidden = true;
    toast('Não foi possível gerar o PDF: ' + errMsg(e), 6000);
  }
}
function pdfReady(blob, pages) {
  const name = catConf(curCat, true).arquivo;
  const url = URL.createObjectURL(blob);
  let file = null;
  try { file = new File([blob], name, { type: 'application/pdf' }); } catch (e) {}
  const share = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  openDrawer('PDF pronto', catConf(curCat, true).nome);
  onClose = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
  $('#dr-body').innerHTML = `<div class="pdf-ready">
    <div class="file"><span class="ic">PDF</span><div><b>${esc(name)}</b><span>${pages} páginas · ${(blob.size / 1048576).toFixed(1).replace('.', ',')} MB · atualizado em ${hoje()}</span></div></div>
    <div class="acts">${share ? '<button class="fbtn primary" id="b-share" type="button">Enviar pelo WhatsApp ou outro app</button>' : ''}<a class="fbtn${share ? '' : ' primary'}" id="b-down" href="${url}" download="${esc(name)}">Baixar o arquivo</a></div>
    <p>Cada produto do PDF abre o WhatsApp ${esc(CONTATO.whats)} com o código já escrito.</p></div>`;
  $('#dr-foot').innerHTML = `<span class="grow"></span><button class="fbtn" id="b-fechar" type="button">Fechar</button>`;
  $('#b-fechar').addEventListener('click', closeDrawer);
  if (share) $('#b-share').addEventListener('click', () => {
    navigator.share({ files: [file], title: catConf(curCat, true).nome + ' ' + EMP.nome }).catch(e => { if (e && e.name !== 'AbortError') toast('Não foi possível compartilhar. Use "Baixar o arquivo".'); });
  });
}

/* =========================================================
   QR code do WhatsApp (gerado a partir do número do config)
   ========================================================= */
function makeQR() {
  if (!WA || typeof window.qrcode !== 'function') return;
  const q = window.qrcode(0, 'M'); q.addData('https://wa.me/' + WA); q.make();
  const n = q.getModuleCount(), cell = 10, m = 1;
  const cv = document.createElement('canvas'); cv.width = cv.height = (n + 2 * m) * cell;
  const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.fillStyle = COR.principal;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) x.fillRect((c + m) * cell, (r + m) * cell, cell, cell);
  QR = cv.toDataURL('image/png');
}

/* =========================================================
   Início
   ========================================================= */
['#b-novo', '#m-novo'].forEach(s => $(s).addEventListener('click', () => openForm()));
['#b-lista', '#m-lista'].forEach(s => $(s).addEventListener('click', openList));
$('#b-precos').addEventListener('click', openPrecos);
$('#b-login').addEventListener('click', openLogin);
async function logout() {
  try { await store.signOut(); closeDrawer(); window.scrollTo({ top: 0 }); toast('Você saiu do modo de edição.'); }
  catch (e) { toast('Não foi possível sair: ' + errMsg(e)); }
}
['#b-logout', '#b-logout-foot'].forEach(s => $(s).addEventListener('click', logout));
['#b-pdf', '#m-pdf'].forEach(s => $(s).addEventListener('click', onPdf));
$('#hint-x').addEventListener('click', () => { $('#hint').hidden = true; fit(); });

async function boot() {
  aplicarCores();
  try { makeQR(); } catch (e) { QR = ''; }
  document.title = `Catálogo ${EMP.nome}`;
  const md = document.querySelector('meta[name="description"]'); if (md) md.setAttribute('content', `Catálogo de produtos ${EMP.nome}. Peça pelo WhatsApp.`);
  document.querySelectorAll('img.logo').forEach(i => { i.alt = EMP.nome; });
  $('#sf-txt').textContent = `${EMP.nome} · ${EMP.ramo}`;
  try {
    if (ONLINE) {
      store = ApiStore();
    } else {
      store = LocalStore();
    }
    store.onAuth(() => { if (!canEdit()) upd = null; refreshChrome(); if (ready) render(); });
    const tinha = store.canEdit();
    if (store.checarSessao && tinha && !(await store.checarSessao())) setTimeout(() => toast('Seu acesso expirou (a senha foi alterada). Toque em Entrar e use a senha nova.', 6000), 400);
    state = await store.load();
    state.produtos.sort((a, b) => a.ordem - b.ordem);
    ['geral', 'chaves'].forEach(c => { if (!state.cats[c]) state.cats[c] = []; });
    if (!state.config) state.config = CONFIG0();
    await checkUpdate();
  } catch (e) {
    viewer.innerHTML = `<div class="empty-state"><h3>Não foi possível carregar o catálogo</h3><p>${esc(errMsg(e))}. Confira a conexão e recarregue a página.</p></div>`;
    return;
  }
  ready = true;
  refreshChrome();
  render();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { fit(); encaixar(viewer); });
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => encaixar(viewer));
  }
}
boot();
})();
