export const MODULE_ID = "mestre-weber-rolagens-grupais";

export const SOCKET_NAME = `module.${MODULE_ID}`;

// Mesma ordem de índice usada pelo sistema pf2e em `roll.options.degreeOfSuccess`
// (0 = falha crítica ... 3 = sucesso crítico). Recalculamos aqui em vez de ler o
// texto do pf2e porque só precisamos do índice pra escolher cor/rótulo em pt-BR.
export const GRAUS_SUCESSO = ["falhaCritica", "falha", "sucesso", "sucessoCritico"];

export const COR_PADRAO = "#8B1E1E";

// Cores de fonte do painel (título/detalhe, texto SUCESSO!/FALHA! do
// resultado agregado e grau/fundo de cada card) — ver campos "Cor da
// fonte..." no modal de configuração. Valem nos dois modos.
export const COR_FONTE_PADRAO = "#ffffff";
export const COR_FONTE_SUCESSO = "#39ff6a";
export const COR_FONTE_FALHA = "#ff2e2e";

/**
 * Recalcula o grau de sucesso (índice 0-3, mesma escala de GRAUS_SUCESSO) a
 * partir do total, do d20 natural e da CD — usado só como rede de segurança
 * caso `roll.options.degreeOfSuccess` não venha preenchido pelo pf2e.
 */
export function calcularGrauDeSucesso(total, natural, dc) {
  if (typeof dc !== "number") return null;
  let grau = total >= dc ? (total >= dc + 10 ? 3 : 2) : total <= dc - 10 ? 0 : 1;
  if (natural === 20) grau = Math.min(3, grau + 1);
  if (natural === 1) grau = Math.max(0, grau - 1);
  return grau;
}

export const LABEL_GRAU = {
  falhaCritica: "Falha Crítica!",
  falha: "Falha!",
  sucesso: "Sucesso!",
  sucessoCritico: "Sucesso Crítico!",
};

// Mesmos graus, mas sem o "!" — usado no resumo de chat da rolagem
// individual (título de seção, não card animado).
export const LABEL_GRAU_RESUMO = {
  falhaCritica: "Falha Crítica",
  falha: "Falha",
  sucesso: "Sucesso",
  sucessoCritico: "Sucesso Crítico",
};
