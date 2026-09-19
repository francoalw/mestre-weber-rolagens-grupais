import { MODULE_ID } from "./constants.js";

/**
 * Salva a configuração inteira do modal (personagens, checagem, opções) como
 * comando de uma macro — reabrir a macro dispara a mesma rolagem em grupo de
 * novo, sem passar pelo modal outra vez.
 */
export async function criarMacroRolagem(config) {
  const nome = `Rolagem: ${config.checagens.map((c) => c.label).join(" / ")} (CD ${config.dc})`;
  const comando = `game.modules.get("${MODULE_ID}").api.iniciarRolagemGrupo(${JSON.stringify(config)});`;
  const icone = config.characters[0]?.img ?? "icons/svg/d20-highlight.svg";

  await Macro.create({
    name: nome,
    type: "script",
    scope: "global",
    command: comando,
    img: icone,
  });

  ui.notifications.info(game.i18n.format("MWRG.Notify.MacroCriada", { nome }));
}
