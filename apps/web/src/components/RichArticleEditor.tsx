import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, AlignLeft, AlignCenter, AlignRight, Link2, Image as ImageIcon,
  Video, Undo2, Redo2, Minus, Type,
} from "lucide-react";
import { toEmbedUrl } from "../utils/renderHelpHtml";

// ─── Nœud image (block, redimensionnable + alignable) ───────────────────────
// La largeur et l'alignement sont sérialisés en data-* pour pouvoir être
// relus tels quels à la réouverture de l'article dans l'éditeur, et appliqués
// en style inline pour le rendu côté lecteur.
const ImageBlock = TiptapNode.create({
  name: "imageBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      width: {
        default: "100%",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-width") || el.style.width || "100%",
      },
      align: {
        default: "center",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || "center",
      },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const a = HTMLAttributes as Record<string, string>;
    const width = a.width || "100%";
    const align = a.align || "center";
    const margin = align === "left" ? "14px 0" : align === "right" ? "14px 0 14px auto" : "14px auto";
    const style = `display:block;height:auto;max-width:100%;width:${width};margin:${margin};border-radius:8px`;
    return ["img", mergeAttributes({ src: a.src, alt: a.alt ?? "" }, { style, "data-width": width, "data-align": align })];
  },
});

// ─── Nœud vidéo (iframe embed YouTube/Vimeo, responsive 16:9) ───────────────
const VideoEmbed = TiptapNode.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: "iframe[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const a = HTMLAttributes as Record<string, string>;
    return ["iframe", mergeAttributes({ src: a.src }, {
      style: "display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:8px;margin:16px 0",
      allowfullscreen: "true",
      frameborder: "0",
      loading: "lazy",
    })];
  },
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ACCENT = "#4F46E5";

function Divider() {
  return <div style={{ width: 1, height: 18, background: "#E2E8F0", margin: "0 4px" }} />;
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, title: string) => (
    <button type="button" title={title} onClick={onClick}
      style={{ padding: "5px 7px", border: "none", borderRadius: 6, cursor: "pointer", background: active ? "#E0E7FF" : "transparent", color: active ? ACCENT : "#374151", display: "flex", alignItems: "center", lineHeight: 0 }}>
      {icon}
    </button>
  );

  const addImage = async (file: File) => {
    const src = await fileToDataUrl(file);
    editor.chain().focus().insertContent({ type: "imageBlock", attrs: { src, align: "center", width: "100%" } }).run();
  };

  const addVideo = () => {
    const raw = window.prompt("Collez le lien de la vidéo (YouTube ou Vimeo) :");
    if (!raw) return;
    const embed = toEmbedUrl(raw);
    if (!embed) {
      window.alert("Lien non reconnu. Formats acceptés : YouTube ou Vimeo.");
      return;
    }
    editor.chain().focus().insertContent({ type: "videoEmbed", attrs: { src: embed } }).run();
  };

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Adresse du lien (laisser vide pour retirer) :", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const imageActive = editor.isActive("imageBlock");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "8px 10px", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap", background: "#F8FAFC", position: "sticky", top: 0, zIndex: 5 }}>
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />, "Gras")}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />, "Italique")}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={15} />, "Souligné")}
      {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={15} />, "Barré")}
      <Divider />
      {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 size={15} />, "Titre 1")}
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={15} />, "Titre 2")}
      {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 size={15} />, "Titre 3")}
      {btn(editor.isActive("paragraph"), () => editor.chain().focus().setParagraph().run(), <Type size={15} />, "Paragraphe")}
      <Divider />
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={15} />, "Liste à puces")}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={15} />, "Liste numérotée")}
      {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={15} />, "Citation")}
      {btn(false, () => editor.chain().focus().setHorizontalRule().run(), <Minus size={15} />, "Séparateur")}
      <Divider />
      {btn(editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), <AlignLeft size={15} />, "Aligner à gauche")}
      {btn(editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), <AlignCenter size={15} />, "Centrer")}
      {btn(editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), <AlignRight size={15} />, "Aligner à droite")}
      <Divider />
      {btn(editor.isActive("link"), setLink, <Link2 size={15} />, "Lien")}
      {btn(false, () => fileRef.current?.click(), <ImageIcon size={15} />, "Insérer une image")}
      {btn(false, addVideo, <Video size={15} />, "Insérer une vidéo")}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ""; }} />
      <Divider />
      {btn(false, () => editor.chain().focus().undo().run(), <Undo2 size={15} />, "Annuler")}
      {btn(false, () => editor.chain().focus().redo().run(), <Redo2 size={15} />, "Rétablir")}

      {imageActive && (
        <>
          <Divider />
          <span style={{ fontSize: 11, color: "#94a3b8", marginRight: 2 }}>Image :</span>
          {(["25%", "50%", "75%", "100%"] as const).map((w) => (
            <button key={w} type="button" onClick={() => editor.chain().focus().updateAttributes("imageBlock", { width: w }).run()}
              style={{ padding: "3px 7px", border: "1px solid #E2E8F0", borderRadius: 6, background: editor.getAttributes("imageBlock").width === w ? "#E0E7FF" : "white", color: "#374151", fontSize: 11, cursor: "pointer" }}>
              {w}
            </button>
          ))}
          {([["left", <AlignLeft size={13} key="l" />], ["center", <AlignCenter size={13} key="c" />], ["right", <AlignRight size={13} key="r" />]] as const).map(([al, ic]) => (
            <button key={al} type="button" title={`Aligner ${al}`} onClick={() => editor.chain().focus().updateAttributes("imageBlock", { align: al }).run()}
              style={{ padding: "4px 6px", border: "1px solid #E2E8F0", borderRadius: 6, background: editor.getAttributes("imageBlock").align === al ? "#E0E7FF" : "white", color: "#374151", cursor: "pointer", display: "flex", lineHeight: 0 }}>
              {ic}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// Éditeur riche réutilisable. `content` est du HTML ; `onChange` reçoit le HTML
// mis à jour. Sortie destinée à être assainie (sanitizeHelpHtml) avant rendu.
export function RichArticleEditor({ content, onChange, placeholder, minHeight = 360 }: {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "Rédigez votre article…" }),
      ImageBlock,
      VideoEmbed,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Resynchronise si le contenu change de l'extérieur (changement d'article).
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "", { emitUpdate: false });
    }
  }, [content, editor]);

  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden", background: "white", display: "flex", flexDirection: "column" }}>
      <style>{`
        .rich-article .ProseMirror { padding: 18px 22px; min-height: ${minHeight}px; outline: none; font-size: 15px; line-height: 1.7; color: #1F2937; }
        .rich-article .ProseMirror:focus { outline: none; }
        .rich-article .ProseMirror > * + * { margin-top: 0.75em; }
        .rich-article .ProseMirror h1 { font-size: 1.7em; font-weight: 800; color: #0F172A; line-height: 1.25; }
        .rich-article .ProseMirror h2 { font-size: 1.35em; font-weight: 700; color: #0F172A; }
        .rich-article .ProseMirror h3 { font-size: 1.12em; font-weight: 700; color: #0F172A; }
        .rich-article .ProseMirror ul, .rich-article .ProseMirror ol { padding-left: 1.4em; }
        .rich-article .ProseMirror ul { list-style: disc; }
        .rich-article .ProseMirror ol { list-style: decimal; }
        .rich-article .ProseMirror blockquote { border-left: 3px solid #C7D2FE; padding-left: 14px; color: #475569; font-style: italic; }
        .rich-article .ProseMirror a { color: ${ACCENT}; text-decoration: underline; }
        .rich-article .ProseMirror hr { border: none; border-top: 1px solid #E2E8F0; }
        .rich-article .ProseMirror img.ProseMirror-selectednode, .rich-article .ProseMirror iframe.ProseMirror-selectednode { outline: 2px solid ${ACCENT}; }
        .rich-article .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: #94A3B8; pointer-events: none; height: 0; }
      `}</style>
      <Toolbar editor={editor} />
      <div className="rich-article" style={{ overflowY: "auto", maxHeight: "60vh" }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
