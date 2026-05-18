import { useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/avatar";
import { Search, Send, MessageSquare, Building2 } from "lucide-react";

const conversations = [
  { id: "1", name: "DDT 37", lastMsg: "Transmission des pièces pour le dossier...", time: "10:32", unread: 1 },
  { id: "2", name: "CAUE", lastMsg: "Avis sur le projet paysager...", time: "Hier", unread: 0 },
  { id: "3", name: "ABF", lastMsg: "Prescriptions patrimoniales...", time: "Lun", unread: 0 },
];

export function MessagerieServices() {
  const [activeConv, setActiveConv] = useState("1");
  const [messageText, setMessageText] = useState("");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Messagerie — Services</h1>
        <p className="text-gray-500 text-sm mt-1">Échanges avec les services partenaires</p>
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
                className={`w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-start gap-3 ${activeConv === conv.id ? "bg-heureka-50" : ""}`}
              >
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-[#000020] truncate">{conv.name}</p>
                    <span className="text-xs text-gray-400 shrink-0">{conv.time}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{conv.lastMsg}</p>
                </div>
                {conv.unread > 0 && (
                  <span className="w-5 h-5 rounded-full bg-heureka-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{conv.unread}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          {activeConv ? (
            <>
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#000020]">{conversations.find(c => c.id === activeConv)?.name}</p>
                  <p className="text-xs text-green-500">En ligne</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-2xl px-4 py-2.5 text-sm bg-gray-100 text-gray-800 rounded-bl-md">
                    <p>Bonjour, nous avons bien reçu la demande de transmission.</p>
                    <p className="text-[10px] mt-1 text-gray-400">10:32</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[70%] rounded-2xl px-4 py-2.5 text-sm bg-heureka-500 text-white rounded-br-md">
                    <p>Parfait, merci de nous tenir informés.</p>
                    <p className="text-[10px] mt-1 text-white/60">10:35</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100">
                <div className="flex gap-3">
                  <Input placeholder="Écrivez votre message..." value={messageText} onChange={(e) => setMessageText(e.target.value)} className="flex-1" />
                  <Button size="icon" className="shrink-0"><Send className="w-4 h-4" /></Button>
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
