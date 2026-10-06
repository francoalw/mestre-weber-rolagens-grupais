import {
  COR_PADRAO,
  COR_FONTE_PADRAO,
  COR_FONTE_SUCESSO,
  COR_FONTE_FALHA,
  GRAUS_SUCESSO,
  LABEL_GRAU,
} from "./constants.js";

let estadoAtual = null;
let raiz = null;
let vinheta = null;
let aoRolar = null;
let aoFechar = null;
let aoTentarReroll = null;
let aoEscolherChecagem = null;
let aoVerificar = null;

// Id da rolagem que já disparou (ou terminou de mostrar) a sequência de
// fade-out + resultado final — evita repetir a animação a cada re-render
// (ex.: um reroll com ponto heroico depois que todo mundo já revelou).
let sequenciaFinalId = null;

const DURACAO_INTRO_MS = 2600;
const DURACAO_FADE_PAINEL_MS = 600;
const PAUSA_ANTES_RESULTADO_MS = 1000;

function garantirVinheta() {
  if (vinheta) return;
  vinheta = el("div", { class: "mwrg-vinheta" });
  document.body.appendChild(vinheta);
  requestAnimationFrame(() => vinheta?.classList.add("mwrg-vinheta--visivel"));
}

function removerVinheta() {
  if (!vinheta) return;
  const alvo = vinheta;
  vinheta = null;
  alvo.classList.remove("mwrg-vinheta--visivel");
  setTimeout(() => alvo.remove(), 600);
}

/** Texto "Rolagem em Grupo!" com fade in/out antes do painel aparecer. */
function mostrarIntroELogoPainel() {
  const intro = el("div", { class: "mwrg-intro", text: game.i18n.localize("MWRG.Overlay.IntroTitulo") });
  document.body.appendChild(intro);
  setTimeout(() => {
    intro.remove();
    renderizar();
  }, DURACAO_INTRO_MS);
}

/**
 * Some as barras laterais (controles de cena à esquerda, abas da sidebar à
 * direita) do HUD dos JOGADORES enquanto a rolagem em grupo está em tela —
 * o GM mantém a própria UI intacta pra continuar navegando normalmente.
 */
function ocultarHudLateral() {
  if (game.user.isGM) return;
  document.body.classList.add("mwrg-hud-oculto");
}

function mostrarHudLateral() {
  document.body.classList.remove("mwrg-hud-oculto");
}

function el(tag, opts = {}, filhos = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.disabled) node.disabled = true;
  for (const filho of filhos) if (filho) node.appendChild(filho);
  return node;
}

export function corDaFaixa(estado) {
  return estado.color || COR_PADRAO;
}

// Cores de fonte configuráveis (só valem pro modo "grupo" — ver
// config-app.js/config.hbs, os campos somem no modo "individual").
function corFontePadrao(estado) {
  return estado.corFontePadrao || COR_FONTE_PADRAO;
}
function corFonteResultado(estado, sucesso) {
  return (sucesso ? estado.corFonteSucesso : estado.corFonteFalha) || (sucesso ? COR_FONTE_SUCESSO : COR_FONTE_FALHA);
}

function podeRolar(estado, actorId) {
  const ator = game.actors.get(actorId);
  if (!ator) return false;
  if (!game.user.isGM && !ator.isOwner) return false;
  return !estado.resultados[actorId]?.revelado;
}

function nomeVisivel(estado, personagem) {
  const ator = game.actors.get(personagem.actorId);
  const ehDono = game.user.isGM || ator?.isOwner;
  if (estado.hideNames && !ehDono) return "???";
  return personagem.name;
}

function montarCard(estado, personagem) {
  const resultado = estado.resultados[personagem.actorId] ?? null;
  const ator = game.actors.get(personagem.actorId);
  const ehDono = game.user.isGM || ator?.isOwner;

  const retrato = el("img", { class: "mwrg-card__retrato", attrs: { src: personagem.img, alt: "" } });
  const nome = el("div", { class: "mwrg-card__nome", text: nomeVisivel(estado, personagem) });

  const corpo = [retrato, nome];

  if ((estado.checagens?.length ?? 0) > 1) {
    const escolhaAtual = estado.escolhas?.[personagem.actorId] ?? estado.checagens[0];
    corpo.push(el("div", { class: "mwrg-card__checagem", text: escolhaAtual.label }));
  }

  const ocultarNumero = estado.blindRoll && !ehDono;
  // "useAverage" só faz sentido pro resultado agregado do modo "grupo" — no
  // modo "individual" cada card sempre mostra o próprio grau na hora,
  // independente do valor (possivelmente obsoleto) que esse campo tenha.
  const suprimirPorMedia = estado.modo !== "individual" && estado.useAverage;
  // No modo "individual" o grau (sucesso/falha/crítico) É o ponto central do
  // painel — sempre aparece assim que revela, sem depender do toggle
  // "Mostrar texto de resultado" (que continua opcional só no modo "grupo",
  // onde o suspense do resultado agregado pode ser o que importa). Pode
  // mudar de novo depois se a pessoa reroller com ponto heroico — ver
  // tentarRerollHeroico em roll-runner.js, que reemite o resultado inteiro.
  const podeMostrarGrau = estado.modo === "individual" || estado.showOutcomeText;
  const revelarGrau = !!resultado?.revelado && podeMostrarGrau && !suprimirPorMedia && !ocultarNumero && resultado.grau != null;

  if (resultado?.revelado) {
    if (revelarGrau) {
      const chaveGrau = GRAUS_SUCESSO[resultado.grau];
      const label = el("div", {
        class: `mwrg-card__grau mwrg-card__grau--${chaveGrau}`,
        text: LABEL_GRAU[chaveGrau],
      });
      corpo.push(label);
    } else if (ocultarNumero) {
      corpo.push(el("div", { class: "mwrg-card__grau", text: "Revelado" }));
    }
  }

  const habilitado = podeRolar(estado, personagem.actorId);
  const podeTentarReroll = !!resultado?.revelado && ehDono;
  const classeNatural =
    !ocultarNumero && resultado?.natural === 1
      ? " mwrg-card__dado-valor--nat1"
      : !ocultarNumero && resultado?.natural === 20
      ? " mwrg-card__dado-valor--nat20"
      : "";
  const conteudoBotao = resultado?.revelado
    ? [el("span", { class: `mwrg-card__dado-valor${classeNatural}`, text: ocultarNumero ? "••" : String(resultado.total) })]
    : [el("i", { class: "fa-solid fa-dice-d20" })];
  const tituloBotao = resultado?.revelado
    ? game.i18n.localize(podeTentarReroll ? "MWRG.Overlay.RerolarPontoHeroico" : "MWRG.Overlay.Aguardando")
    : game.i18n.localize(habilitado ? "MWRG.Overlay.Rolar" : "MWRG.Overlay.Aguardando");
  const botao = el(
    "button",
    {
      class: `mwrg-card__dado${resultado?.revelado ? " mwrg-card__dado--rerolar" : ""}`,
      attrs: { type: "button", title: tituloBotao },
    },
    conteudoBotao
  );
  botao.disabled = !(habilitado || podeTentarReroll);
  if (habilitado) {
    botao.addEventListener("click", (ev) => {
      botao.disabled = true;
      aoRolar?.(personagem.actorId, ev);
    });
  } else if (podeTentarReroll) {
    botao.addEventListener("click", () => aoTentarReroll?.(personagem.actorId));
  }
  corpo.push(botao);

  // Tingir o card inteiro (não só o textinho do grau) deixa o resultado
  // visível de relance no painel — importante no modo "individual", onde não
  // tem tela de resultado agregado separada pra chamar atenção.
  const classeGrau = revelarGrau ? ` mwrg-card--${GRAUS_SUCESSO[resultado.grau]}` : "";
  return el("div", { class: `mwrg-card${classeGrau}` }, corpo);
}

function abrirDropdownChecagens(faixaEl) {
  const existente = faixaEl.querySelector(".mwrg-checagem-dropdown");
  if (existente) {
    existente.remove();
    return;
  }

  const itens = estadoAtual.checagens.map((c) => {
    const chave = `${c.kind}:${c.slug}`;
    const item = el("li", { class: "mwrg-checagem-dropdown__item", text: c.label });
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      aoEscolherChecagem?.(chave);
    });
    return item;
  });

  const menu = el("ul", { class: "mwrg-checagem-dropdown" }, itens);
  faixaEl.appendChild(menu);

  const fecharAoClicarFora = (ev) => {
    if (menu.isConnected && !menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("click", fecharAoClicarFora);
    }
  };
  setTimeout(() => document.addEventListener("click", fecharAoClicarFora), 0);
}

function calcularResultadoGeral(estado) {
  const totalPersonagens = estado.characters.length;
  const revelados = estado.characters.filter((p) => estado.resultados[p.actorId]?.revelado);
  if (revelados.length < totalPersonagens) return null;

  if (estado.useAverage) {
    const soma = revelados.reduce((acc, p) => acc + estado.resultados[p.actorId].total, 0);
    const media = Math.round((soma / revelados.length) * 10) / 10;
    const sucesso = media >= estado.dc;
    return { sucesso, texto: sucesso ? "Sucesso!" : "Falha!", detalhe: `(média ${media})` };
  }

  const sucessos = revelados.filter((p) => estado.resultados[p.actorId].grau >= 2).length;
  // Config antiga (macro salva antes desse campo existir) não tem
  // `sucessosNecessarios` — cai de volta pra maioria, que era o comportamento
  // fixo anterior.
  const necessarios = estado.sucessosNecessarios ?? Math.ceil(totalPersonagens / 2);
  const sucesso = sucessos >= necessarios;
  return {
    sucesso,
    texto: sucesso ? "Sucesso!" : "Falha!",
    detalhe: `(${sucessos}/${totalPersonagens} sucessos — precisa de ${necessarios})`,
  };
}

/** Botão de fechar do GM — fica encostado no canto da faixa colorida
 * (resultado, ou o banner de título/CD quando ainda não há resultado). Se
 * não houver nenhuma faixa em tela (pausa em branco entre o fade-out e o
 * resultado final), cai pro canto da própria tela como último recurso. */
function montarBotaoFechar(alvo = raiz) {
  if (!game.user.isGM) return;
  if (raiz.querySelector(".mwrg-fechar-flutuante")) return;
  const fechar = el(
    "button",
    { class: "mwrg-fechar-flutuante", attrs: { type: "button", title: game.i18n.localize("MWRG.Overlay.Encerrar") } },
    [el("i", { class: "fa-solid fa-x" })]
  );
  fechar.addEventListener("click", () => aoFechar?.());
  alvo.appendChild(fechar);
}

function desenharPainel(estado, { comResultado = false, podeVerificar = false } = {}) {
  raiz.innerHTML = "";

  const cor = corDaFaixa(estado);

  const mostrarCD = estado.showDC || game.user.isGM;
  // GM ainda vê a CD mesmo com "Mostrar CD" desligado, mas com uma borda
  // pontilhada avisando que os jogadores não estão vendo esse número.
  const cdOcultaDosJogadores = !estado.showDC && game.user.isGM;

  function montarTitulo(classe) {
    const filhos = [el("span", { text: mostrarCD ? `${estado.label} ` : estado.label })];
    if (mostrarCD) {
      filhos.push(
        el("span", {
          class: `mwrg-banner__cd${cdOcultaDosJogadores ? " mwrg-banner__cd--oculta" : ""}`,
          text: `CD ${estado.dc}`,
        })
      );
    }
    return el("div", { class: classe, attrs: { style: `color:${corFontePadrao(estado)}` } }, filhos);
  }

  const textosFaixa = estado.nome
    ? [
        el("div", { class: "mwrg-banner__nome", text: estado.nome, attrs: { style: `color:${corFontePadrao(estado)}` } }),
        montarTitulo("mwrg-banner__titulo mwrg-banner__titulo--sub"),
      ]
    : [montarTitulo("mwrg-banner__titulo")];

  // Com mais de uma checagem liberada, cada jogador pode clicar no título pra
  // trocar qual delas VAI ROLAR — só afeta os personagens que ele é dono e
  // que ainda não rolaram (não muda nada pra ninguém mais).
  const podeEscolherChecagem =
    !game.user.isGM &&
    (estado.checagens?.length ?? 0) > 1 &&
    estado.characters.some((p) => game.actors.get(p.actorId)?.isOwner && !estado.resultados[p.actorId]?.revelado);

  if (podeEscolherChecagem) {
    textosFaixa.push(el("i", { class: "fa-solid fa-chevron-down mwrg-banner__seta" }));
  }

  const wrapTextos = el("div", { class: `mwrg-banner__textos${podeEscolherChecagem ? " mwrg-banner__textos--clicavel" : ""}` }, textosFaixa);
  if (podeEscolherChecagem) {
    wrapTextos.title = game.i18n.localize("MWRG.Overlay.TrocarChecagem");
    wrapTextos.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const faixaEl = ev.currentTarget.closest(".mwrg-banner");
      if (faixaEl) abrirDropdownChecagens(faixaEl);
    });
  }

  const faixa = el("div", { class: "mwrg-banner", attrs: { style: `background-color:${cor}` } }, [wrapTextos]);

  const cards = el(
    "div",
    { class: "mwrg-cards" },
    estado.characters.map((p) => montarCard(estado, p))
  );

  const painel = el("div", { class: "mwrg-painel" }, [faixa, cards]);

  // Todo mundo já revelou, mas o mestre ainda não conferiu — mostra um botão
  // discreto (opacidade baixa, pra não brigar com o resto da tela) só pro GM;
  // o resultado geral fica escondido até ele clicar.
  if (podeVerificar && game.user.isGM) {
    const botaoVerificar = el("button", {
      class: "mwrg-botao-verificar",
      attrs: { type: "button" },
      text: game.i18n.localize("MWRG.Overlay.Verificar"),
    });
    botaoVerificar.addEventListener("click", () => aoVerificar?.(estado.id));
    painel.append(botaoVerificar);
  }

  raiz.append(painel);

  // O X vai encostado na faixa de resultado quando ela existir (é a que o
  // GM está olhando nesse momento); sem resultado ainda, fica no banner.
  let faixaParaBotao = faixa;

  // Fora do modo "média", o resultado geral aparece direto embaixo dos cards
  // assim que todo mundo revela E o mestre confirma — sem o suspense do
  // fade-out/pausa do modo média, mas com um fade in rápido (ver
  // mwrg-resultado--entrando/--visivel) em vez de aparecer num corte seco.
  // Fica dentro do painel (não em raiz) pra herdar o posicionamento absolute
  // dele em vez de empurrar os cards pra cima.
  if (comResultado) {
    const geral = calcularResultadoGeral(estado);
    if (geral) {
      const faixaGeral = el(
        "div",
        {
          class: `mwrg-resultado mwrg-resultado--entrando ${geral.sucesso ? "mwrg-resultado--sucesso" : "mwrg-resultado--falha"}`,
          attrs: { style: `background-color:${cor}` },
        },
        [
          el("div", {
            class: "mwrg-resultado__texto",
            text: geral.texto,
            attrs: { style: `color:${corFonteResultado(estado, geral.sucesso)}` },
          }),
          el("div", {
            class: "mwrg-resultado__detalhe",
            text: geral.detalhe,
            attrs: { style: `color:${corFontePadrao(estado)}` },
          }),
        ]
      );
      painel.append(faixaGeral);
      requestAnimationFrame(() => faixaGeral.classList.add("mwrg-resultado--visivel"));
      faixaParaBotao = faixaGeral;
    }
  }

  montarBotaoFechar(faixaParaBotao);
}

/** Dispara a troca de tela: fade-out do painel (faixa + cards), pausa em
 * branco, e só então o resultado final aparece — chamada uma única vez, na
 * primeira renderização em que todo mundo já revelou. */
function iniciarSequenciaResultado(estado) {
  const painel = raiz.querySelector(".mwrg-painel");
  painel?.classList.add("mwrg-painel--saindo");

  setTimeout(() => {
    if (estadoAtual?.id !== estado.id) return; // rolagem foi encerrada/trocada no meio do fade
    raiz.innerHTML = "";
    montarBotaoFechar();

    setTimeout(() => {
      if (estadoAtual?.id !== estado.id) return;
      mostrarResultadoFinal(estado);
    }, PAUSA_ANTES_RESULTADO_MS);
  }, DURACAO_FADE_PAINEL_MS);
}

function mostrarResultadoFinal(estado) {
  const geral = calcularResultadoGeral(estado);
  if (!geral) return;

  raiz.innerHTML = "";

  const cor = corDaFaixa(estado);
  const faixaGeral = el(
    "div",
    {
      class: `mwrg-resultado mwrg-resultado--entrando ${geral.sucesso ? "mwrg-resultado--sucesso" : "mwrg-resultado--falha"}`,
      attrs: { style: `background-color:${cor}` },
    },
    [
      el("div", {
        class: "mwrg-resultado__texto",
        text: geral.texto,
        attrs: { style: `color:${corFonteResultado(estado, geral.sucesso)}` },
      }),
      el("div", {
        class: "mwrg-resultado__detalhe",
        text: geral.detalhe,
        attrs: { style: `color:${corFontePadrao(estado)}` },
      }),
    ]
  );
  raiz.appendChild(faixaGeral);
  montarBotaoFechar(faixaGeral);
  requestAnimationFrame(() => faixaGeral.classList.add("mwrg-resultado--visivel"));
}

/** Reroll com ponto heroico depois que o resultado final já apareceu muda o
 * total/grau — atualiza o texto no lugar, sem repetir a animação. Se ainda
 * estiver no meio do fade/pausa (faixaGeral não existe na tela ainda), não
 * faz nada: a etapa seguinte já vai calcular o resultado atualizado. */
function atualizarTextoResultado(estado) {
  const faixaGeral = raiz.querySelector(".mwrg-resultado");
  if (!faixaGeral) return;

  const geral = calcularResultadoGeral(estado);
  if (!geral) return;

  const elTexto = faixaGeral.querySelector(".mwrg-resultado__texto");
  elTexto.textContent = geral.texto;
  elTexto.style.color = corFonteResultado(estado, geral.sucesso);
  faixaGeral.querySelector(".mwrg-resultado__detalhe").textContent = geral.detalhe;
  faixaGeral.classList.toggle("mwrg-resultado--sucesso", geral.sucesso);
  faixaGeral.classList.toggle("mwrg-resultado--falha", !geral.sucesso);
}

function renderizar() {
  if (!raiz || !estadoAtual) return;

  // Modo "individual": cada card já mostra seu próprio grau assim que revela
  // (ver montarCard) — nunca há resultado agregado nem botão "Verificar"
  // aqui; o resumo só sai no chat quando o mestre fecha (ver roll-runner.js).
  if (estadoAtual.modo === "individual") {
    sequenciaFinalId = null;
    desenharPainel(estadoAtual, { comResultado: false, podeVerificar: false });
    return;
  }

  const todosRevelados = !!calcularResultadoGeral(estadoAtual);
  // Mesmo com todo mundo revelado, o resultado só aparece depois que o
  // mestre clica em "Verificar" — até lá, mostra o botão em vez da faixa.
  const podeMostrarResultado = todosRevelados && !!estadoAtual.resultadoLiberado;

  // O suspense (fade-out + pausa + revelação) só faz sentido quando o
  // resultado é uma média — nos outros modos (contagem de sucessos) o
  // resultado geral segue aparecendo direto embaixo dos cards, como antes.
  if (!podeMostrarResultado || !estadoAtual.useAverage) {
    sequenciaFinalId = null;
    desenharPainel(estadoAtual, {
      comResultado: podeMostrarResultado,
      podeVerificar: todosRevelados && !estadoAtual.resultadoLiberado,
    });
    return;
  }

  if (sequenciaFinalId !== estadoAtual.id) {
    sequenciaFinalId = estadoAtual.id;
    iniciarSequenciaResultado(estadoAtual);
    return;
  }

  atualizarTextoResultado(estadoAtual);
}

export function inicializarOverlay({ onRolar, onFechar, onTentarReroll, onEscolherChecagem, onVerificar }) {
  aoRolar = onRolar;
  aoFechar = onFechar;
  aoTentarReroll = onTentarReroll;
  aoEscolherChecagem = onEscolherChecagem;
  aoVerificar = onVerificar;
}

export function mostrarRolagem(estado) {
  const primeiraVez = !raiz;
  estadoAtual = estado;
  garantirVinheta();
  ocultarHudLateral();
  if (primeiraVez) {
    raiz = el("div", { class: "mwrg-overlay", attrs: { id: "mwrg-overlay" } });
    document.body.appendChild(raiz);
    mostrarIntroELogoPainel();
  } else {
    renderizar();
  }
}

/** Re-renderiza os cards do zero, recalculando quem pode rolar — usado pra
 * destravar o botão do d20 quando o jogador cancela o diálogo de pré-rolagem
 * (o clique original já tinha desabilitado o botão na hora). */
export function reabilitarBotao() {
  renderizar();
}

export function aplicarResultado({ rollId, actorId, total, grau, natural, messageId }) {
  if (!estadoAtual || estadoAtual.id !== rollId) return;
  estadoAtual.resultados[actorId] = { total, grau, natural: natural ?? null, revelado: true, messageId: messageId ?? null };
  renderizar();
}

export function aplicarEscolha({ rollId, actorId, escolha }) {
  if (!estadoAtual || estadoAtual.id !== rollId) return;
  estadoAtual.escolhas = estadoAtual.escolhas ?? {};
  estadoAtual.escolhas[actorId] = escolha;
  renderizar();
}

/** Chamada quando o mestre clica em "Verificar" (localmente e via socket nos
 * outros clientes) — libera a exibição do resultado geral que já estava pronto. */
export function liberarResultado(rollId) {
  if (!estadoAtual || estadoAtual.id !== rollId) return;
  estadoAtual.resultadoLiberado = true;
  renderizar();
}

export function esconderRolagem() {
  estadoAtual = null;
  sequenciaFinalId = null;
  const raizAtual = raiz;
  raiz = null;
  if (raizAtual) {
    raizAtual.classList.add("mwrg-overlay--saindo");
    setTimeout(() => raizAtual.remove(), DURACAO_FADE_PAINEL_MS);
  }
  removerVinheta();
  mostrarHudLateral();
}

export function rolagemAtivaId() {
  return estadoAtual?.id ?? null;
}

export function estadoRolagemAtiva() {
  return estadoAtual;
}
