/*
 * Configuração do catálogo (white label)
 * ======================================
 * Tudo o que muda de um cliente para outro fica aqui: modo, recursos liberados,
 * nome da empresa, contatos, cores e catálogos. O logo e o ícone ficam em public/img/.
 * Veja o README.md para o passo a passo de um cliente novo.
 */
window.CATALOGO_CONFIG = {

  // 'demo'    -> tudo fica no navegador, sem servidor. Use só para apresentar.
  // 'netlify' -> produtos e fotos ficam no Netlify Blobs (cliente de verdade).
  backend: 'demo',

  // DEMONSTRAÇÃO PÚBLICA (GitHub Pages): dados fictícios, tudo fica no navegador de
  // quem visita (localStorage). false aqui só desliga a trava de "apenas no computador".
  demonstracao: false,

  // frase pequena na contracapa do PDF
  aviso: 'Demonstração: produtos, marcas, códigos e preços fictícios. Nomes de montadoras indicam apenas a aplicação.',

  /* ---------------- Plano e recursos ----------------
   * plano: 'essencial' | 'completo' | 'vendas'
   *   essencial e completo -> catálogo online, PDF, WhatsApp, preços, selos e painel
   *   vendas               -> tudo acima + busca, carrinho e lançamentos
   *
   * recursos: exceções só para este cliente. true libera, false bloqueia.
   * O que não estiver listado segue o plano.
   *   pdf          botão Baixar PDF
   *   precos       preços (por produto, versão e seção) e o botão Preços
   *   selos        selos NOVO, OFERTA e ESGOTADO
   *   edicao       painel de edição (botão Entrar no rodapé)
   *   busca        busca por código, carro ou marca
   *   carrinho     pedido com vários produtos numa só mensagem de WhatsApp
   *   lancamentos  aba e PDF só com os produtos marcados como NOVO
   */
  plano: 'vendas',
  recursos: {
    // busca: true,   // exemplo: liberar a busca para um cliente do plano Completo
  },

  /* ---------------- Empresa e contatos ---------------- */
  empresa: {
    nome: 'Sua Marca',
    ramo: 'Distribuidora de materiais para chaveiro',
    sobre: 'Linha completa para atender a necessidade do chaveiro, com atendimento direto pelo WhatsApp e televendas.',
    destaque: ['24h', 'pedidos pelo WhatsApp a qualquer hora']
  },

  // número que recebe os pedidos (DDI + DDD + número, só dígitos).
  // Vazio: o WhatsApp abre com a mensagem pronta e a pessoa escolhe para quem enviar.
  whatsapp: '',
  contato: {
    whats: '(00) 90000-0000',     // WhatsApp da empresa, como aparece escrito
    tele: '',                     // televendas (deixe '' para não mostrar)
    site: 'cardoso30s.github.io/catalogo-demo',  // endereço do catálogo online
    instagram: ''                 // sem @ (deixe '' para não mostrar)
  },

  /* ---------------- Cores ----------------
   * principal: barra do site, capas e títulos (cor escura)
   * destaque:  botões, selos e preços (cor viva; o texto sobre ela usa a principal)
   */
  cores: {
    principal: '#0F3D3E',
    destaque: '#FF7A1A'
  },

  /* ---------------- Catálogos ----------------
   * ativo:     false esconde o catálogo inteiro (site, aba e PDF)
   * nome:      nome da aba e do PDF
   * nomePdf:   opcional, outro nome só no PDF
   * chamada:   frase pequena acima do título da capa
   * destaques: códigos dos 4 produtos da capa (vazio = os primeiros com foto)
   * legenda:   siglas explicadas na página 2 (só no catálogo geral)
   */
  catalogos: {
    geral: {
      ativo: true,
      nome: 'Catálogo Geral',
      nomePdf: 'Chaves Automotivas e Ferragens',
      chamada: 'Distribuidora de materiais para chaveiro',
      destaques: ['CC1104', 'CHC3201', 'CPT6101', 'FE9201'],
      legenda: [['CC', 'Carcaça canivete'], ['CP', 'Carcaça presença'], ['CHC', 'Chave completa'], ['GV', 'Chave gaveta'], ['CPT', 'Controle de portão'], ['CAL', 'Controle de alarme']]
    },
    chaves: {
      ativo: true,
      nome: 'Catálogo de Chaves',
      chamada: 'Yale · Tetra · Gorja · Plástica',
      destaques: ['Y2101', 'T3101', 'P5201', 'G4101']
    },
    lancamentos: {
      nome: 'Lançamentos',
      chamada: 'Novidades do catálogo'
    }
  },

  // Selo "PRÉVIA" nas páginas, para mostrar um layout ainda em aprovação.
  marcaPrevia: false
};
