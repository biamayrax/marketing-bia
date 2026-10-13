/* Conteúdo editorial e configurações do calendário.
   Para mudar posts, stories, aprovadores, prazos ou cores de status, edite este arquivo. */
const H = '#FranciosiSementes #ConstruindoLegado';
const PILLARS = {
  campo: { name: 'Campo & safra', bg: 'var(--green-700)', fg: '#fff' },
  tecnico: { name: 'Autoridade técnica', bg: 'var(--blue-600)', fg: '#fff' },
  pessoas: { name: 'Pessoas', bg: 'var(--terracotta-600)', fg: '#fff' },
  comercial: { name: 'Comercial', bg: 'var(--blue-900)', fg: '#fff' },
  legado: { name: 'Legado', bg: 'var(--brown-900)', fg: '#fff' },
  data: { name: 'Data comemorativa', bg: 'var(--green-300)', fg: 'var(--blue-900)' },
};
const STORIES = {
  campo: p => ['Repost do post do feed com o sticker "Novo post".', 'Foto ou vídeo de 5 a 10s do campo, feito no celular no dia, com uma frase curta.'],
  tecnico: p => ['Repost do post do feed com o sticker "Novo post".', 'Foto do consultor em campo com o texto "Dúvidas? Fale com o nosso time técnico" e o link do WhatsApp.'],
  pessoas: p => ['Repost do post do feed, marcando quem aparece.', 'Uma foto de bastidor do dia, sem edição.'],
  comercial: p => ['Repost do post do feed com o sticker "Novo post".', 'Sticker de link para o WhatsApp do consultor: "Fale com a gente".'],
  legado: p => ['Repost do post do feed com o sticker "Novo post".', 'Uma foto de arquivo ou de bastidor ligada ao tema.'],
  data: p => ['A arte da data adaptada para 9:16.', 'Repost das menções recebidas no dia.'],
};
/* Posts e dias só de stories: no modo online vêm do banco (protegidos por login).
   No modo de demonstração vêm de js/conteudo.js. */
let STORY_DAYS = {};
const FLOW_KEY = 'franciosi-cal-flow-v1';
const SESSION_KEY = 'franciosi-cal-session';
const CONTENT_DAYS = 7;
const ART_DAYS = 3;
const APPROVERS = [
  { id: 'gm', name: 'Gerente de Marketing', role: 'Aprovação principal', main: true },
  { id: 'daniel', name: 'Daniel', role: 'Presidente · análise', main: false },
  { id: 'lucas', name: 'Lucas', role: 'Diretor · análise', main: false },
];
/* Cores de status (psicologia das cores, só com a paleta da marca):
   neutro quente = esperando · azuis = em análise · amarelo = atenção, corrigir
   verdes = liberado (verde-limão = pronto para publicar) · cinza = inativo · vermelho = atrasado */
const STATUS = {
  pendente: { label: 'Conteúdo aguardando aprovação', short: 'aguardando', bg: 'var(--sand-200)', fg: 'var(--brown-900)' },
  pre: { label: 'Em análise da diretoria', short: 'em análise', bg: 'var(--blue-300)', fg: 'var(--blue-900)' },
  ajustes: { label: 'Ajustes solicitados', short: 'ajustes', bg: '#FBE38A', fg: 'var(--brown-900)' },
  aprovado: { label: 'Aprovado', short: 'aprovado', bg: 'var(--green-700)', fg: '#fff' },
  substituida: { label: 'Substituída por nova versão', short: 'substituída', bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
  semArte: { label: 'Aguardando envio da arte', short: 'aguardando envio', bg: 'var(--taupe-400)', fg: 'var(--brown-900)' },
  fixed: { label: 'Ajuste feito, aguardando conferência', short: 'ajuste feito', bg: 'var(--green-500)', fg: 'var(--blue-900)' },
  bloqueada: { label: 'Bloqueada', short: 'bloqueada', bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
  artePendente: { label: 'Arte em aprovação', short: 'em aprovação', bg: 'var(--blue-600)', fg: '#fff' },
  pronto: { label: 'Pronto para publicar', short: 'pronto', bg: 'var(--green-300)', fg: 'var(--blue-900)' },
  atrasado: { label: 'Atrasado', short: 'atrasado', bg: '#C62828', fg: '#fff' },
};
const STATUS_LEGEND = [
  ['pendente', 'Conteúdo aguardando'],
  ['pre', 'Em análise da diretoria'],
  ['ajustes', 'Ajuste pedido'],
  ['fixed', 'Ajuste feito'],
  ['semArte', 'Aguardando arte'],
  ['artePendente', 'Arte em aprovação'],
  ['pronto', 'Pronto para publicar'],
  ['atrasado', 'Atrasado'],
];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const HTYPES = {
  aprovado: { tag: 'Aprovação final', color: 'var(--green-700)', fg: '#fff' },
  pre: { tag: 'Análise da diretoria', color: 'var(--blue-300)', fg: 'var(--blue-900)' },
  ajustes: { tag: 'Ajuste pedido', color: '#FBE38A', fg: 'var(--brown-900)' },
  revisado: { tag: 'Ajuste feito', color: 'var(--green-300)', fg: 'var(--blue-900)' },
  envio: { tag: 'Arte enviada', color: 'var(--blue-600)', fg: '#fff' },
  outro: { tag: 'Atualização', color: 'var(--taupe-400)', fg: 'var(--brown-900)' },
};
const WD = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

let MONTHS = [];
