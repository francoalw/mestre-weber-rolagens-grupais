import { calcularGrauDeSucesso, GRAUS_SUCESSO, LABEL_GRAU_RESUMO } from "./constants.js";
import { obterStatistic } from "./pf2e-data.js";
import { emitir } from "./socket.js";
import * as Estado from "./state.js";
import * as Overlay from "./overlay.js";

function dadoNaturalDoRoll(roll) {
  return roll.dice?.[0]?.results?.find((r) => r.active && !r.discarded)?.result ?? null;
}

function grauDoRoll(roll, dc) {
  const dadoNatural = dadoNaturalDoRoll(roll);
  return typeof roll.options?.degreeOfSuccess === "number"
    ? roll.options.degreeOfSuccess
    : calcularGrauDeSucesso(roll.total, dadoNatural, dc);
}

/**
 * Monta o estado da rolagem em grupo a partir da configuração escolhida no
 * modal e dispara pros outros clientes. Só o GM deve chamar isto (o botão de
 * Token Controls e o modal já são GM-only).
 */
export async function iniciarRolagemGrupo(config) {
  if (!game.user.isGM) return false;
  if (config.characters.length === 0) {
    ui.notifications.warn(game.i18n.localize("MWRG.Notify.SelecionePersonagem"));
    return false;
  }
  if (!config.checagens?.length) {
    ui.notifications.warn(game.i18n.localize("MWRG.Notify.SelecioneChecagem"));
    return false;
  }

  const rollState = {
    id: foundry.utils.randomID(),
    nome: config.nome?.trim() || null,
    checagens: config.checagens,
    // label/kind/slug seguem sendo a checagem "padrão" (a 1ª escolhida) —
    // usada na faixa e por quem não trocar de perícia via dropdown.
    label: config.checagens[0].label,
    kind: config.checagens[0].kind,
    slug: config.checagens[0].slug,
    escolhas: {},
    dc: config.dc,
    modo: config.modo ?? "grupo",
    sucessosNecessarios: config.sucessosNecessarios,
    showDC: config.showDC,
    useAverage: config.useAverage,
    showOutcomeText: config.showOutcomeText,
    blindRoll: config.blindRoll,
    hideNames: config.hideNames,
    color: config.color,
    corFontePadrao: config.corFontePadrao,
    corFonteSucesso: config.corFonteSucesso,
    corFonteFalha: config.corFonteFalha,
    characters: config.characters,
    resultados: {},
  };

  await Estado.salvarRolagemAtiva(rollState);
  await Estado.salvarUltimaConfiguracao(config);
  emitir({ type: "start", roll: rollState });
  Overlay.mostrarRolagem(rollState);
  return true;
}

/**
 * Executa a rolagem de verdade no cliente do dono do personagem (ou do GM
 * rolando por ele) e propaga o resultado pra todo mundo.
 */
export async function executarRolagemJogador(rollId, actorId, event) {
  const ator = game.actors.get(actorId);
  if (!ator) return;
  if (!game.user.isGM && !ator.isOwner) return;

  const estado = Overlay.estadoRolagemAtiva();
  if (!estado || estado.id !== rollId) return;

  const jaRolou = estado.resultados[actorId]?.revelado;
  if (jaRolou) return;

  const escolha = estado.escolhas?.[actorId] ?? estado.checagens?.[0] ?? { kind: estado.kind, slug: estado.slug, label: estado.label };
  const statistic = obterStatistic(ator, { kind: escolha.kind, slug: escolha.slug });
  if (!statistic) {
    ui.notifications.error(game.i18n.format("MWRG.Notify.SemChecagem", { nome: ator.name, label: escolha.label }));
    return;
  }

  // Mesma lógica do pf2e pros links de chat: mostra o diálogo de modificadores
  // por padrão se a preferência pessoal do jogador ("Show Check Roll Dialogs")
  // estiver ligada; se estiver desligada, segurar Shift ao clicar no d20 do
  // overlay revela o diálogo mesmo assim.
  const pulaPorPadrao = !game.user.settings.showCheckDialogs;
  const skipDialog = event?.shiftKey ? !pulaPorPadrao : pulaPorPadrao;

  // Com "Mostrar CD" desligado, não passamos a CD pro pf2e — senão o próprio
  // card de chat que ele cria mostra "Sucesso"/"Falha" coloridos, entregando
  // o resultado mesmo com a CD escondida no painel. Sem a CD aqui, o pf2e só
  // registra o total puro; o grau pro painel continua calculado à parte por
  // `grauDoRoll` (cai no fallback `calcularGrauDeSucesso` usando estado.dc).
  const roll = await statistic.roll({
    dc: estado.showDC ? { value: estado.dc } : undefined,
    skipDialog,
    messageMode: estado.blindRoll ? "blind" : "public",
  });
  if (!roll) {
    // Jogador cancelou o diálogo (ex.: clicou no X) — o botão já tinha sido
    // desabilitado no clique, então precisa de um re-render pra voltar a
    // ficar clicável.
    Overlay.reabilitarBotao();
    return;
  }

  const grau = grauDoRoll(roll, estado.dc);
  const natural = dadoNaturalDoRoll(roll);

  // A rolagem acabou de criar uma ChatMessage do pf2e; guardamos o id dela pra
  // reconhecer com certeza, mais tarde, se ESSA mensagem específica (e não
  // outro teste da mesma perícia feito por fora) foi rerolada com ponto
  // heroico — ver hook de "preDeleteChatMessage" mais abaixo.
  const ultimaMensagem = game.messages.contents.at(-1);
  const messageId =
    ultimaMensagem?.rolls?.[0] === roll || ultimaMensagem?.rolls?.[0]?.total === roll.total
      ? ultimaMensagem.id
      : null;

  const payload = { type: "result", rollId, actorId, total: roll.total, grau, natural, messageId };
  Overlay.aplicarResultado(payload);
  emitir(payload);
  await Estado.registrarResultado(rollId, actorId, roll.total, grau, messageId, natural);
}

/**
 * Troca qual perícia/checagem (dentre as liberadas pelo mestre) um jogador
 * vai usar pra rolar o seu personagem. Só é possível antes de revelar o
 * resultado — depois disso a escolha fica travada.
 */
export async function escolherChecagemIndividual(rollId, actorId, chave) {
  const ator = game.actors.get(actorId);
  if (!ator) return;
  if (!game.user.isGM && !ator.isOwner) return;

  const estado = Overlay.estadoRolagemAtiva();
  if (!estado || estado.id !== rollId) return;
  if (estado.resultados[actorId]?.revelado) return;

  const escolha = estado.checagens?.find((c) => `${c.kind}:${c.slug}` === chave);
  if (!escolha) return;

  const payload = { rollId, actorId, escolha };
  Overlay.aplicarEscolha(payload);
  emitir({ type: "escolha", ...payload });
  await Estado.registrarEscolha(rollId, actorId, escolha);
}

/**
 * Reroll com ponto heroico, disparado ao clicar no próprio card revelado (em
 * vez de precisar ir até o chat). Só chama a mesma API que o pf2e usa no
 * menu de contexto da mensagem — ele já cuida de checar/gastar o ponto
 * heroico e avisar se não tiver nenhum sobrando.
 */
export async function tentarRerollHeroico(rollId, actorId) {
  const ator = game.actors.get(actorId);
  if (!ator) return;
  if (!game.user.isGM && !ator.isOwner) return;

  const estado = Overlay.estadoRolagemAtiva();
  if (!estado || estado.id !== rollId) return;

  const messageId = estado.resultados[actorId]?.messageId;
  const mensagem = messageId ? game.messages.get(messageId) : null;
  if (!mensagem) {
    ui.notifications.warn(game.i18n.localize("MWRG.Notify.SemMensagemParaReroll"));
    return;
  }

  // Nome do recurso vem do próprio pf2e (`getResource`) em vez de fixo aqui,
  // pra acompanhar o termo usado nessa mesa (idioma/tradução ativa).
  const recurso = ator.getResource?.("hero-points");
  const nomeRecurso = recurso?.label ?? game.i18n.localize("PF2E.Actor.Resource.HeroPoints");

  if (!recurso || recurso.value <= 0) {
    ui.notifications.warn(game.i18n.format("MWRG.RerollHeroico.SemPontos", { nome: ator.name, recurso: nomeRecurso }));
    return;
  }

  const confirmar = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("MWRG.RerollHeroico.Titulo") },
    content: `<p>${game.i18n.format("MWRG.RerollHeroico.Pergunta", { recurso: nomeRecurso })}</p>`,
    rejectClose: false,
  });
  if (!confirmar) return;

  // Marcamos que ESTE clique já vai tratar o resultado direto (ver abaixo),
  // pra não competir com o fallback via preDeleteChatMessage/createChatMessage
  // logo mais embaixo. Esse fallback dependia de "message.isAuthor" bater no
  // cliente de quem recebeu o hook — o que só acontecia de forma confiável
  // quando era o próprio mestre quem clicava (dono de tudo); quando era o
  // jogador, o card ficava travado no valor antigo até alguém mais recarregar.
  rerollEmProgresso.add(actorId);
  try {
    await game.pf2e.Check.rerollFromMessage(mensagem, { resource: "hero-points" });
  } finally {
    rerollEmProgresso.delete(actorId);
  }

  const novaMensagem = game.messages.contents.at(-1);
  const novoRoll = novaMensagem?.rolls?.[0];
  if (!novaMensagem || !novoRoll) return;

  const grau = grauDoRoll(novoRoll, estado.dc);
  const natural = dadoNaturalDoRoll(novoRoll);
  const payload = { type: "result", rollId, actorId, total: novoRoll.total, grau, natural, messageId: novaMensagem.id };
  Overlay.aplicarResultado(payload);
  emitir(payload);
  await Estado.registrarResultado(rollId, actorId, novoRoll.total, grau, novaMensagem.id, natural);
}

/**
 * Fallback pra reroll disparado pelo menu de contexto do chat (em vez do
 * clique no card) — o clique no card já trata o resultado direto em
 * `tentarRerollHeroico`, então aqui a gente ignora os actorId que já estão
 * em `rerollEmProgresso` pra não emitir o mesmo resultado duas vezes.
 *
 * O pf2e implementa reroll apagando a mensagem original e criando uma nova
 * (ver `Check.rerollFromMessage` no sistema), então: quando uma mensagem que
 * sabemos ser de uma rolagem do grupo ativo está prestes a ser apagada,
 * guardamos de quem era; a PRÓXIMA mensagem criada em seguida é, com
 * certeza, o resultado do reroll dela — e não de algum outro teste da mesma
 * perícia feito por fora do grupo.
 */
let rerollPendente = null;
const rerollEmProgresso = new Set();

Hooks.on("preDeleteChatMessage", (message) => {
  const estado = Overlay.estadoRolagemAtiva();
  if (!estado) return;
  const entrada = Object.entries(estado.resultados).find(([, r]) => r.messageId === message.id);
  if (!entrada) return;
  rerollPendente = { rollId: estado.id, actorId: entrada[0] };
});

Hooks.on("createChatMessage", async (message) => {
  const pendente = rerollPendente;
  rerollPendente = null;
  if (!pendente || !message.isAuthor || rerollEmProgresso.has(pendente.actorId)) return;

  const estado = Overlay.estadoRolagemAtiva();
  if (!estado || estado.id !== pendente.rollId) return;

  const roll = message.rolls?.[0];
  if (!roll) return;

  const grau = grauDoRoll(roll, estado.dc);
  const natural = dadoNaturalDoRoll(roll);
  const payload = { type: "result", rollId: estado.id, actorId: pendente.actorId, total: roll.total, grau, natural, messageId: message.id };
  Overlay.aplicarResultado(payload);
  emitir(payload);
  await Estado.registrarResultado(estado.id, pendente.actorId, roll.total, grau, message.id, natural);
});

/**
 * Libera o resultado geral que já estava pronto (todo mundo revelou, mas
 * escondido atrás do botão "Verificar") — só o GM pode chamar.
 */
export async function verificarResultadoGrupo(rollId) {
  if (!game.user.isGM) return;
  Overlay.liberarResultado(rollId);
  emitir({ type: "verificar", rollId });
  await Estado.registrarLiberacaoResultado(rollId);
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const ICONE_GRAU = {
  sucessoCritico: "fa-solid fa-star",
  sucesso: "fa-solid fa-check",
  falha: "fa-solid fa-xmark",
  falhaCritica: "fa-solid fa-skull",
};

/**
 * Monta o card de chat impresso ao encerrar uma rolagem em modo "individual"
 * — agrupa cada personagem pelo grau que tirou (quem não chegou a rolar
 * entra à parte, em "Não testaram") em vez de reaproveitar o cálculo de
 * `calcularResultadoGeral` do overlay, que é específico do modo "grupo"
 * (resultado único por sucessos/média).
 */
function montarConteudoResumoIndividual(estado) {
  const grupos = { sucessoCritico: [], sucesso: [], falha: [], falhaCritica: [] };
  const semTeste = [];

  for (const personagem of estado.characters) {
    const resultado = estado.resultados[personagem.actorId];
    if (!resultado?.revelado || resultado.grau == null) {
      semTeste.push(personagem.name);
      continue;
    }
    grupos[GRAUS_SUCESSO[resultado.grau]].push(personagem.name);
  }

  const linhas = ["sucessoCritico", "sucesso", "falha", "falhaCritica"]
    .filter((chave) => grupos[chave].length)
    .map(
      (chave) => `
        <div class="mwrg-chat-resumo__grupo mwrg-chat-resumo__grupo--${chave}">
          <span class="mwrg-chat-resumo__rotulo"><i class="${ICONE_GRAU[chave]}"></i> ${LABEL_GRAU_RESUMO[chave]}</span>
          <span class="mwrg-chat-resumo__nomes">${grupos[chave].map(escaparHtml).join(", ")}</span>
        </div>`
    )
    .join("");

  const semTesteHtml = semTeste.length
    ? `
        <div class="mwrg-chat-resumo__grupo mwrg-chat-resumo__grupo--semTeste">
          <span class="mwrg-chat-resumo__rotulo"><i class="fa-solid fa-minus"></i> Não testaram</span>
          <span class="mwrg-chat-resumo__nomes">${semTeste.map(escaparHtml).join(", ")}</span>
        </div>`
    : "";

  const titulo = escaparHtml(estado.nome || estado.label);
  const cor = Overlay.corDaFaixa(estado);

  return `
    <div class="mwrg-chat-resumo">
      <header class="mwrg-chat-resumo__header" style="background-color:${cor}">
        <span>${titulo}</span>
        ${estado.showDC ? `<span class="mwrg-chat-resumo__cd">CD ${estado.dc}</span>` : ""}
      </header>
      <div class="mwrg-chat-resumo__corpo">${linhas}${semTesteHtml}</div>
    </div>`;
}

export async function encerrarRolagemGrupo() {
  if (!game.user.isGM) return;
  const rollId = Overlay.rolagemAtivaId();
  const estado = Overlay.estadoRolagemAtiva();

  if (estado?.modo === "individual" && Object.keys(estado.resultados ?? {}).length > 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("MWRG.SceneControl.Title") }),
      content: montarConteudoResumoIndividual(estado),
    });
  }

  Overlay.esconderRolagem();
  await Estado.limparRolagemAtiva();
  if (rollId) emitir({ type: "end", rollId });
}
