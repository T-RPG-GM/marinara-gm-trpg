export interface HandoutDescriptionSlot {
  id: string;
  host: HTMLDivElement;
  source: string;
}

export function mountCocGame(
  host: HTMLDivElement,
  chatId: string,
  title: string,
  fetchApi: (path: string, init?: RequestInit) => Promise<Response>,
  setPersona: (personaId: string | null) => Promise<void>,
  setHandoutDescriptions: (slots: HandoutDescriptionSlot[]) => void,
): () => void;
