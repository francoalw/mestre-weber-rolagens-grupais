import { MODULE_ID } from "./constants.js";

const CHAVE = "rolagemAtiva";
const CHAVE_ULTIMA_CONFIG = "ultimaConfiguracao";

export function registrarSettings() {
  game.settings.register(MODULE_ID, CHAVE, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, CHAVE_ULTIMA_CONFIG, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
}

/**
 * Config (personagens, checagens liberadas e opções) da última rolagem em
 * grupo iniciada por este GM — usada pra pré-preencher o modal na próxima
 * vez que ele abrir, em vez de começar do zero toda vez.
 */
export function obterUltimaConfiguracao() {
  const valor = game.settings.get(MODULE_ID, CHAVE_ULTIMA_CONFIG);
  return valor && Object.keys(valor).length > 0 ? valor : null;
}

export async function salvarUltimaConfiguracao(config) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, CHAVE_ULTIMA_CONFIG, config);
}

/**
 * Só o GM escreve aqui (ver roll-runner.js) — serve pra um cliente que recarrega
 * a página no meio de uma rolagem em grupo recuperar a faixa/cards ao entrar.
 * Retorna null quando não há rolagem ativa (setting fica em `{}`, igual ao
 * padrão de "objeto vazio" já usado pelo mestre-weber-sync).
 */
export function obterRolagemAtiva() {
  const valor = game.settings.get(MODULE_ID, CHAVE);
  return valor?.id ? valor : null;
}

export async function salvarRolagemAtiva(estado) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, CHAVE, estado);
}

export async function limparRolagemAtiva() {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, CHAVE, {});
}

/**
 * Chamada nos dois lugares onde um resultado pode "chegar" no cliente do GM:
 * quando o próprio GM rola (roll-runner.js) e quando o socket avisa que outro
 * jogador rolou (main.js). Só o GM grava, pra recuperação após F5/reconexão.
 */
export async function registrarResultado(rollId, actorId, total, grau, messageId = null, natural = null) {
  if (!game.user.isGM) return;
  const atual = obterRolagemAtiva();
  if (atual?.id !== rollId) return;
  atual.resultados[actorId] = { total, grau, natural, revelado: true, messageId };
  await salvarRolagemAtiva(atual);
}

/** Mesmo padrão de `registrarResultado`, mas pra qual perícia cada jogador escolheu rolar. */
export async function registrarEscolha(rollId, actorId, escolha) {
  if (!game.user.isGM) return;
  const atual = obterRolagemAtiva();
  if (atual?.id !== rollId) return;
  atual.escolhas = atual.escolhas ?? {};
  atual.escolhas[actorId] = escolha;
  await salvarRolagemAtiva(atual);
}

/** Mesmo padrão de `registrarResultado`, mas pra lembrar que o mestre já
 * clicou em "Verificar" (senão o resultado voltaria a ficar escondido atrás
 * do botão depois de um F5). */
export async function registrarLiberacaoResultado(rollId) {
  if (!game.user.isGM) return;
  const atual = obterRolagemAtiva();
  if (atual?.id !== rollId) return;
  atual.resultadoLiberado = true;
  await salvarRolagemAtiva(atual);
}
