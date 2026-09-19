import { MODULE_ID, COR_PADRAO, COR_FONTE_PADRAO, COR_FONTE_SUCESSO, COR_FONTE_FALHA } from "./constants.js";
import { listarChecagensDisponiveis, personagensDisponiveis } from "./pf2e-data.js";
import { iniciarRolagemGrupo } from "./roll-runner.js";
import { criarMacroRolagem } from "./macro.js";

const chaveChecagem = (c) => `${c.kind}:${c.slug}`;

/**
 * Modal de configuração da Rolagem em Grupo (GM-only). Não usa FormApplication
 * porque a tela não é um formulário de submit único — é composta de ações
 * incrementais (adicionar/remover personagem, escolher checagem) que vão
 * montando `this.opcoes` até o clique em "Iniciar" ou "Salvar como Macro".
 */
export class GroupRollConfigApp extends Application {
  constructor(configAnterior = null, atoresSelecionados = null) {
    super();
    // Herda personagens/checagens/opções da última rolagem que esse GM
    // iniciou (ver Estado.salvarUltimaConfiguracao), pra não montar tudo de
    // novo do zero a cada vez que o modal abre.
    const { characters = [], checagens = [], ...opcoesAnteriores } = configAnterior ?? {};

    // Se houver tokens selecionados no canvas ao abrir o modal, eles têm
    // prioridade sobre os personagens da última rolagem — reflete a seleção
    // atual do GM em vez de repetir configuração antiga.
    const idsIniciais = atoresSelecionados?.length ? atoresSelecionados : characters.map((c) => c.actorId);

    this.selecionados = new Set(idsIniciais);
    this.checagensSelecionadas = new Map(checagens.map((c) => [chaveChecagem(c), c])); // chave "kind:slug" -> {slug,kind,label}
    this.buscaChecagem = "";
    this.opcoes = {
      nome: "",
      dc: 10,
      // "grupo": resultado único (sucessos/média), revelado só quando o
      // mestre clica em "Verificar". "individual": cada card mostra o
      // próprio sucesso/falha na hora, sem etapa de verificação — ao
      // fechar (X), sai um resumo no chat (ver roll-runner.js).
      modo: "grupo",
      showDC: true,
      useAverage: false,
      // null = segue a maioria (recalculada em `_sucessosNecessarios` a
      // partir da quantidade de personagens selecionados); só vira um número
      // fixo quando o mestre mexe no campo.
      sucessosNecessarios: null,
      showOutcomeText: true,
      blindRoll: false,
      hideNames: false,
      autoColor: true,
      color: COR_PADRAO,
      // Cores de fonte do resultado do modo "grupo" (título/detalhe e o
      // SUCESSO!/FALHA! do resultado agregado) — não têm efeito no modo
      // "individual" (ver getData/template).
      corFontePadrao: COR_FONTE_PADRAO,
      corFonteSucesso: COR_FONTE_SUCESSO,
      corFonteFalha: COR_FONTE_FALHA,
      ...opcoesAnteriores,
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mwrg-config",
      title: game.i18n.localize("MWRG.App.Title"),
      template: `modules/${MODULE_ID}/templates/config.hbs`,
      width: 820,
      height: 500,
      resizable: true,
      classes: ["mwrg-config"],
    });
  }

  /**
   * Quantos sucessos (dentre os personagens selecionados) o modo "grupo" sem
   * média exige pra dar sucesso geral. Sem valor escolhido pelo mestre, cai
   * pra maioria; sempre limitado entre 1 e o total de selecionados (que pode
   * ter mudado desde a última vez que o campo foi editado).
   */
  _sucessosNecessarios(totalSelecionados) {
    const max = Math.max(totalSelecionados, 1);
    const bruto = this.opcoes.sucessosNecessarios ?? Math.max(1, Math.ceil(totalSelecionados / 2));
    return Math.min(Math.max(Math.round(bruto), 1), max);
  }

  getData() {
    const idsSelecionados = this.selecionados;
    const todosPersonagens = personagensDisponiveis();

    const disponiveis = todosPersonagens
      .filter((ator) => !idsSelecionados.has(ator.id))
      .map((ator) => ({ id: ator.id, name: ator.name, img: ator.img }));

    const selecionados = todosPersonagens
      .filter((ator) => idsSelecionados.has(ator.id))
      .map((ator) => ({ id: ator.id, name: ator.name, img: ator.img }));

    const busca = this.buscaChecagem.trim().toLowerCase();
    const checagens = listarChecagensDisponiveis()
      .filter((c) => !busca || c.label.toLowerCase().includes(busca))
      .map((c) => ({
        ...c,
        selecionada: this.checagensSelecionadas.has(chaveChecagem(c)),
      }));

    return {
      disponiveis,
      semDisponiveis: disponiveis.length === 0,
      selecionados,
      semSelecionados: selecionados.length === 0,
      perception: checagens.find((c) => c.kind === "perception") ?? null,
      skills: checagens.filter((c) => c.kind === "skill"),
      saves: checagens.filter((c) => c.kind === "save"),
      buscaChecagem: this.buscaChecagem,
      ...this.opcoes,
      modoIndividual: (this.opcoes.modo ?? "grupo") === "individual",
      maxSucessos: Math.max(selecionados.length, 1),
      sucessosNecessarios: this._sucessosNecessarios(selecionados.length),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._restaurarScroll(html);

    html.find("[data-action='adicionar']").on("click", (ev) => {
      this.selecionados.add(ev.currentTarget.dataset.id);
      this._salvarScroll();
      this.render();
    });

    html.find("[data-action='remover']").on("click", (ev) => {
      this.selecionados.delete(ev.currentTarget.dataset.id);
      this._salvarScroll();
      this.render();
    });

    html.find("[data-action='adicionar-todos']").on("click", () => {
      for (const ator of personagensDisponiveis()) this.selecionados.add(ator.id);
      this._salvarScroll();
      this.render();
    });

    html.find("[data-action='escolher-checagem']").on("click", (ev) => {
      const { slug, kind, label } = ev.currentTarget.dataset;
      const chave = chaveChecagem({ kind, slug });
      if (ev.shiftKey) {
        // Segurando shift dá pra liberar mais de uma perícia/checagem pra
        // esse teste — cada jogador escolhe depois qual delas vai rolar.
        if (this.checagensSelecionadas.has(chave)) this.checagensSelecionadas.delete(chave);
        else this.checagensSelecionadas.set(chave, { slug, kind, label });
      } else {
        this.checagensSelecionadas.clear();
        this.checagensSelecionadas.set(chave, { slug, kind, label });
      }
      this._salvarScroll();
      this.render();
    });

    html.find("[data-action='todos-checagens']").on("click", (ev) => {
      const { kind } = ev.currentTarget.dataset;
      const busca = this.buscaChecagem.trim().toLowerCase();
      const todas = listarChecagensDisponiveis()
        .filter((c) => c.kind === kind)
        .filter((c) => !busca || c.label.toLowerCase().includes(busca));

      // Clicar de novo com esse mesmo grupo já 100% selecionado (e nada mais
      // selecionado além dele) desmarca tudo, em vez de ficar preso
      // selecionado pra sempre — mesma ideia de um toggle "Todos" comum.
      const jaTudoSelecionado =
        todas.length > 0 &&
        this.checagensSelecionadas.size === todas.length &&
        todas.every((c) => this.checagensSelecionadas.has(chaveChecagem(c)));

      this.checagensSelecionadas.clear();
      if (!jaTudoSelecionado) {
        for (const c of todas) this.checagensSelecionadas.set(chaveChecagem(c), c);
      }
      this._salvarScroll();
      this.render();
    });

    html.find("[data-role='busca-checagem']").on("input", (ev) => {
      this.buscaChecagem = ev.currentTarget.value;
      this._focoAposRender = "busca-checagem";
      this._salvarScroll();
      this.render();
    });

    html.find("[data-opcao]").on("change", (ev) => {
      const campo = ev.currentTarget;
      const chave = campo.dataset.opcao;
      const valor = campo.type === "checkbox" ? campo.checked : campo.type === "number" ? Number(campo.value) : campo.value;
      this.opcoes[chave] = valor;
      // "useAverage" também precisa re-renderizar: liga/desliga se o campo
      // de "Sucessos necessários" aparece na tela (só faz sentido fora do
      // modo média).
      if (chave === "autoColor" || chave === "modo" || chave === "useAverage") {
        this._salvarScroll();
        this.render();
      }
    });

    html.find("[data-action='iniciar']").on("click", async () => {
      const sucesso = await iniciarRolagemGrupo(this._construirConfig());
      if (sucesso) this.close();
    });

    html.find("[data-action='salvar-macro']").on("click", async () => {
      const config = this._construirConfig();
      if (config.checagens.length === 0 || config.characters.length === 0) {
        ui.notifications.warn(game.i18n.localize("MWRG.Notify.MacroFaltaDados"));
        return;
      }
      await criarMacroRolagem(config);
    });

    if (this._focoAposRender) {
      const campo = html.find(`[data-role='${this._focoAposRender}']`);
      campo.trigger("focus");
      // O input é recriado do zero a cada render — sem isso o cursor volta
      // pro início do texto, e a próxima letra digitada entra antes da
      // anterior (ex.: digitar "oi" resultava em "io").
      const elemento = campo[0];
      if (elemento) elemento.setSelectionRange(elemento.value.length, elemento.value.length);
      this._focoAposRender = null;
    }
  }

  /**
   * `render()` recria o HTML inteiro do modal, o que por padrão zera o
   * scroll das colunas (personagens/checagens) mesmo quando a mudança foi
   * só marcar/desmarcar um item nelas. Guardamos a posição antes de rerender
   * e devolvemos em `activateListeners` (chamado toda vez que o novo HTML
   * entra), pra quem tava rolado lá embaixo continuar lá.
   */
  _salvarScroll() {
    this._scrollPos = new Map();
    const colunas = this.element?.[0]?.querySelectorAll(".mwrg-config__col") ?? [];
    for (const coluna of colunas) this._scrollPos.set(coluna.className, coluna.scrollTop);
  }

  _restaurarScroll(html) {
    if (!this._scrollPos) return;
    for (const coluna of html[0].querySelectorAll(".mwrg-config__col")) {
      const valor = this._scrollPos.get(coluna.className);
      if (valor) coluna.scrollTop = valor;
    }
  }

  _construirConfig() {
    const todosPersonagens = personagensDisponiveis();
    const characters = todosPersonagens
      .filter((ator) => this.selecionados.has(ator.id))
      .map((ator) => ({ actorId: ator.id, name: ator.name, img: ator.img }));

    return {
      characters,
      checagens: [...this.checagensSelecionadas.values()],
      ...this.opcoes,
      sucessosNecessarios: this._sucessosNecessarios(characters.length),
    };
  }
}
