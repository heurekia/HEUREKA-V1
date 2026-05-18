import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/avatar";
import { Search, Send, MessageSquare, ChevronRight, Building2 } from "lucide-react";

const conversations = [
  { id: "1", name: "Dossier PC-2024-001", lastMsg: "Nouveau message du citoyen...", time: "Il y a 2h", unread: 2 },
  { id: "2", name: "Dossier DP-2024-042", lastMsg: "Demande de document complémentaire...", time: "Il y a 1j", unread: 0 },
  { id: "3", name: "Service Urbanisme", lastMsg: "Réunion commission jeudi prochain...", time: "Il y a 3j", unread: 0 },
];

const messages = [
  { from: "them", text: "Bonjour, j'ai bien reçu votre message concernant le dossier PC-2024-001.", time: "14:30" },
  { from: "me", text: "Parfait. Pouvez-vous me confirmer la réception des pièces complémentaires ?", time: "14:35" },
  { from: "them", text: "Oui, tout est en ordre. L'instruction pourra démarrer.", time: "14:40" },
];

export function MessagerieMairie() {
  const [activeConv, setActiveConv] = useState("1");
  const [messageText, setMessageText] = useState("");

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#000020]">Messagerie</h1>
            <p className="text-gray-500 text-sm mt-1">Communications avec les citoyens et services</p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="px-3 py-1.5 text-sm font-medium bg-white rounded-md shadow-sm text-[#000020]">Citoyens</span>
            <Link to="/mairie/messagerie/services" className="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-[#000020] rounded-md transition-colors">
              Services
            </Link>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-12rem)] rounded-xl overflow-hidden border border-gray-200/80 bg-white shadow-sm">
        <div className="w-80 border-r border-gray-200 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Rechercher..." className="pl-9 bg-gray-50 border-gray-200" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setActiveConv(conv.id)}
                className={`w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-start gap-3 ${
                  activeConv === conv.id ? "bg-heureka-50" : ""
                }`}
              >
                <Avatar fallback={conv.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-[#000020] truncate">{conv.name}</p>
                    <span className="text-xs text-gray-400 shrink-0">{conv.time}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{conv.lastMsg}</p>
                </div>
                {conv.unread > 0 && (
                  <span className="w-5 h-5 rounded-full bg-heureka-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                    {conv.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          {activeConv ? (
            <>
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <Avatar fallback={conversations.find((c) => c.id === activeConv)?.name ?? "?"} />
                <div>
                  <p className="text-sm font-semibold text-[#000020]">
                    {conversations.find((c) => c.id === activeConv)?.name}
                  </p>
                  <p className="text-xs text-green-500">En ligne</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.from === "me"
                          ? "bg-heureka-500 text-white rounded-br-md"
                          : "bg-gray-100 text-gray-800 rounded-bl-md"
                      }`}
                    >
                      <p>{msg.text}</p>
                      <p className={`text-[10px] mt-1 ${msg.from === "me" ? "text-white/60" : "text-gray-400"}`}>
                        {msg.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-gray-100">
                <div className="flex gap-3">
                  <Input
                    placeholder="Écrivez votre message..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="flex-1"
                  />
                  <Button size="icon" className="shrink-0">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>Sélectionnez une conversation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
