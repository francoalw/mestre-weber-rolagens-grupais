/**
 * Lista de checagens disponíveis (perícias + testes de resistência + percepção)
 * a partir do CONFIG.PF2E do próprio sistema, já localizada no idioma ativo.
 * Lida direto na config do sistema em vez de manter uma lista fixa aqui, pra
 * acompanhar automaticamente qualquer mudança do pf2e (novas perícias, etc.).
 */
export function listarChecagensDisponiveis() {
  const skills = Object.entries(CONFIG.PF2E.skills ?? {}).map(([slug, dados]) => ({
    slug,
    kind: "skill",
    label: game.i18n.localize(dados.label ?? dados),
  }));

  const saves = Object.entries(CONFIG.PF2E.saves ?? {}).map(([slug, locKey]) => ({
    slug,
    kind: "save",
    label: game.i18n.localize(locKey),
  }));

  const perception = [
    {
      slug: "perception",
      kind: "perception",
      label: game.i18n.localize("PF2E.PerceptionLabel"),
    },
  ];

  return [...skills, ...saves, ...perception].sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

/** Retorna o Statistic do pf2e (skill, save ou perception) responsável pela rolagem. */
export function obterStatistic(actor, checagem) {
  if (checagem.kind === "skill") return actor.skills?.[checagem.slug] ?? null;
  if (checagem.kind === "save") return actor.saves?.[checagem.slug] ?? null;
  if (checagem.kind === "perception") return actor.perception ?? null;
  return null;
}

export function personagensDisponiveis() {
  return game.actors.filter((ator) => ator.type === "character" && ator.hasPlayerOwner);
}
