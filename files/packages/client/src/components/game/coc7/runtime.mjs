import { getGameAdapter } from './platform.mjs';
import { createWorkspace } from './ui.mjs';

export function mountCocGame(host, chatId, title, fetchApi, setPersona, setHandoutDescriptions) {
  const adapter = getGameAdapter(chatId,fetchApi);
  const workspace = createWorkspace(host,adapter,{ gameChatId:chatId, gameTitle:title, setPersona, setHandoutDescriptions });
  return () => { void workspace.cleanup(); };
}
