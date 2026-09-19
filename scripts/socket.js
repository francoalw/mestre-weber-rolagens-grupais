import { SOCKET_NAME } from "./constants.js";

/**
 * `game.socket.emit` nunca chama o próprio handler de quem envia — por isso
 * cada função que emite (ver roll-runner.js) também aplica o efeito
 * localmente antes/depois de emitir, em vez de depender só deste listener.
 */
export function registrarSocket(handlers) {
  game.socket.on(SOCKET_NAME, (payload) => {
    const handler = handlers[payload?.type];
    if (handler) handler(payload);
  });
}

export function emitir(payload) {
  game.socket.emit(SOCKET_NAME, payload);
}
