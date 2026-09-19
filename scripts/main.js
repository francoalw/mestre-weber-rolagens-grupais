import { MODULE_ID } from "./constants.js";
import { GroupRollConfigApp } from "./config-app.js";
import * as Overlay from "./overlay.js";
import * as Estado from "./state.js";
import { registrarSocket } from "./socket.js";
import {
  iniciarRolagemGrupo,
  executarRolagemJogador,
  encerrarRolagemGrupo,
  tentarRerollHeroico,
  escolherChecagemIndividual,
  verificarResultadoGrupo,
} from "./roll-runner.js";

Hooks.once("init", () => {
  Estado.registrarSettings();
});

Overlay.inicializarOverlay({
  onRolar: (actorId, event) => executarRolagemJogador(Overlay.rolagemAtivaId(), actorId, event),
  onFechar: () => encerrarRolagemGrupo(),
  onTentarReroll: (actorId) => tentarRerollHeroico(Overlay.rolagemAtivaId(), actorId),
  onEscolherChecagem: (chave) => {
    const rollId = Overlay.rolagemAtivaId();
    const estado = Overlay.estadoRolagemAtiva();
    if (!estado) return;
    // Aplica pra todos os personagens que esse jogador é dono e que ainda
    // não rolaram — cobre o caso normal (1 PJ por jogador) sem precisar
    // perguntar "pra qual personagem" quando alguém controla mais de um.
    const meusPersonagens = estado.characters.filter(
      (p) => game.actors.get(p.actorId)?.isOwner && !estado.resultados[p.actorId]?.revelado
    );
    for (const p of meusPersonagens) escolherChecagemIndividual(rollId, p.actorId, chave);
  },
  onVerificar: (rollId) => verificarResultadoGrupo(rollId),
});

Hooks.once("ready", () => {
  registrarSocket({
    start: (payload) => Overlay.mostrarRolagem(payload.roll),
    result: (payload) => {
      Overlay.aplicarResultado(payload);
      Estado.registrarResultado(payload.rollId, payload.actorId, payload.total, payload.grau, payload.messageId, payload.natural);
    },
    escolha: (payload) => {
      Overlay.aplicarEscolha(payload);
      Estado.registrarEscolha(payload.rollId, payload.actorId, payload.escolha);
    },
    verificar: (payload) => Overlay.liberarResultado(payload.rollId),
    end: (payload) => {
      if (Overlay.rolagemAtivaId() === payload.rollId) Overlay.esconderRolagem();
    },
  });

  // Recupera a rolagem em andamento pra quem entrar ou recarregar no meio dela.
  const ativa = Estado.obterRolagemAtiva();
  if (ativa) Overlay.mostrarRolagem(ativa);

  game.modules.get(MODULE_ID).api = { iniciarRolagemGrupo };

  console.log("Mestre Weber Rolagens Grupais | Pronto.");
});

// Mesmo padrão dos outros módulos mestre-weber-*: pendura o botão no grupo
// "Token Controls" já existente em vez de criar uma categoria própria.
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  const tokenControls = controls.tokens;
  if (!tokenControls) return;

  const ordemBase = Object.keys(tokenControls.tools).length;

  tokenControls.tools.mwrgAbrirConfig = {
    name: "mwrgAbrirConfig",
    title: game.i18n.localize("MWRG.SceneControl.Title"),
    icon: "fa-solid fa-people-group",
    button: true,
    order: ordemBase,
    onClick: () => {
      const existente = Object.values(ui.windows ?? {}).find((janela) => janela.constructor?.name === "GroupRollConfigApp");
      if (existente) existente.bringToFront?.() ?? existente.bringToTop?.();
      else {
        const atoresSelecionados = canvas.tokens.controlled.map((token) => token.actor?.id).filter((id) => id);
        new GroupRollConfigApp(Estado.obterUltimaConfiguracao(), atoresSelecionados).render(true);
      }
    },
  };
});
