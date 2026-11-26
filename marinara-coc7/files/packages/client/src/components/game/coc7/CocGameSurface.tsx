import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUpdateChat } from "../../../hooks/use-chats";
import { api } from "../../../lib/api-client";
import { HTML_TAG_RE, sanitizeChatHtml } from "../../../lib/chat-html";
import { convertChatHtmlNewlines } from "../../../lib/chat-html-newlines";
import { applyInlineMarkdownHTML, renderMarkdownBlocks } from "../../../lib/markdown";
import { protectMarkdownCode } from "../../../lib/markdown-code";
import { handleRemoteImageClick, useRemoteImagePolicy } from "../../../lib/remote-image-policy";
import { mountCocGame, type HandoutDescriptionSlot } from "./runtime.mjs";
import "./workspace.css";

function HandoutDescription({ source }: { source: string }) {
  const remoteImages = useRemoteImagePolicy();
  const code = protectMarkdownCode(source);
  if (!HTML_TAG_RE.test(code.text)) return renderMarkdownBlocks(source);

  const formatted = applyInlineMarkdownHTML(convertChatHtmlNewlines(code.text));
  const html = sanitizeChatHtml(code.restoreHtml(formatted), { allowStyle: true, remoteImages });
  return <div onClick={handleRemoteImageClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function CocGameSurface({ chatId, title }: { chatId: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const initialTitle = useRef(title);
  const { mutateAsync: updateChat } = useUpdateChat();
  const [handoutDescriptions, setHandoutDescriptions] = useState<HandoutDescriptionSlot[]>([]);
  useEffect(() => {
    if (!host.current) return;
    return mountCocGame(host.current, chatId, initialTitle.current, api.raw, async (personaId) => {
      await updateChat({ id: chatId, personaId });
    }, setHandoutDescriptions);
  }, [chatId, updateChat]);

  return (
    <>
      <div ref={host} className="h-full min-h-0 w-full overflow-hidden" data-component="CocGameSurface" />
      {handoutDescriptions.map(({ id, host, source }) => createPortal(<HandoutDescription source={source} />, host, id))}
    </>
  );
}
