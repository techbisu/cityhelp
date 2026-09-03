"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/stores/app";
import { cn, timeAgo } from "@/lib/utils";
import { ArrowLeft, Send, MapPin, Mic, Camera, MoreVertical, Check, CheckCheck } from "lucide-react";

interface BotReply {
  kind: "text" | "buttons" | "list";
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  listTitle?: string;
  listButton?: string;
}

interface ChatMessage {
  id: string;
  from: "bot" | "me";
  reply?: BotReply;
  text?: string;
  timestamp: number;
  status?: "sent" | "delivered" | "read";
  attachment?: { type: "voice" | "image" | "location"; label: string };
}

export function BotApp() {
  const setView = useApp((s) => s.setView);
  const botTenantSlug = useApp((s) => s.botTenantSlug);
  const botPhone = useApp((s) => s.botPhone);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tenant, setTenant] = useState<{ name: string; waBusinessName: string | null; accentColor: string } | null>(null);
  const [listOpen, setListOpen] = useState<{ rows: Array<{ id: string; title: string; description?: string }>; title: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  // Fetch tenant info
  useEffect(() => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((d) => {
        const t = d.tenants?.find((t: { slug: string }) => t.slug === botTenantSlug);
        if (t) setTenant(t);
      });
  }, [botTenantSlug]);

  // Init conversation — send /start
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    sendBot({ message: "hi" });
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function sendBot(payload: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await fetch("/api/bot/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug: botTenantSlug, phone: botPhone, ...payload }),
      });
      const data = await res.json();
      // Append bot replies
      for (const reply of data.replies || []) {
        await new Promise((r) => setTimeout(r, 250));
        setMessages((m) => [
          ...m,
          {
            id: Math.random().toString(36).slice(2),
            from: "bot",
            reply,
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [
      ...m,
      { id: Math.random().toString(36).slice(2), from: "me", text, timestamp: Date.now(), status: "sent" },
    ]);
    await sendBot({ message: text });
  }

  async function handleButton(buttonId: string, label: string) {
    setMessages((m) => [
      ...m,
      { id: Math.random().toString(36).slice(2), from: "me", text: label, timestamp: Date.now(), status: "sent" },
    ]);
    await sendBot({ button: buttonId });
  }

  async function handleLocation() {
    setMessages((m) => [
      ...m,
      {
        id: Math.random().toString(36).slice(2),
        from: "me",
        timestamp: Date.now(),
        status: "sent",
        attachment: { type: "location", label: "📍 Jawahar Nagar, Delhi" },
      },
    ]);
    await sendBot({ location: { lat: 28.6862, lng: 77.2072 } });
  }

  async function handleVoice() {
    setMessages((m) => [
      ...m,
      {
        id: Math.random().toString(36).slice(2),
        from: "me",
        timestamp: Date.now(),
        status: "sent",
        attachment: { type: "voice", label: "🎙️ Voice note · 0:08" },
      },
    ]);
    await sendBot({ mediaType: "voice", message: "[voice note]" });
  }

  async function handleCamera() {
    setMessages((m) => [
      ...m,
      {
        id: Math.random().toString(36).slice(2),
        from: "me",
        timestamp: Date.now(),
        status: "sent",
        attachment: { type: "image", label: "📸 Photo · grocery_list.jpg" },
      },
    ]);
    await sendBot({ mediaType: "image", message: "[photo]" });
  }

  async function handlePhoto() {
    setMessages((m) => [
      ...m,
      {
        id: Math.random().toString(36).slice(2),
        from: "me",
        timestamp: Date.now(),
        status: "sent",
        attachment: { type: "image", label: "📸 Photo · handwritten_list.jpg" },
      },
    ]);
    await sendBot({ mediaType: "image", message: "[photo]" });
  }

  function handleListTap(rowId: string, title: string) {
    setListOpen(null);
    handleButton(rowId, title);
  }

  return (
    <div className="min-h-screen bg-background flex justify-center">
      {/* Phone frame */}
      <div className="w-full max-w-[420px] flex flex-col bg-zinc-950 relative">
        {/* Status bar */}
        <div className="bg-zinc-900 px-4 py-1 flex items-center justify-between text-[10px] text-zinc-400">
          <span className="font-medium">{new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="flex items-center gap-1">
            <span>•••</span>
            <span>5G</span>
            <span>96%</span>
          </span>
        </div>

        {/* Chat header */}
        <header className="bg-zinc-900 border-b border-zinc-800 px-3 py-2 flex items-center gap-3">
          <button
            onClick={() => setView("home")}
            className="text-zinc-400 hover:text-white transition-colors p-1"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-emerald-300 font-semibold text-sm">
            {(tenant?.waBusinessName || tenant?.name || "C").charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-white truncate">
              {tenant?.waBusinessName || tenant?.name || "CityHelp"}
            </h3>
            <p className="text-[11px] text-emerald-400 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400" />
              online
            </p>
          </div>
          <button className="text-zinc-400 hover:text-white p-1">
            <MoreVertical className="w-5 h-5" />
          </button>
        </header>

        {/* Chat body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 py-4 space-y-2 bg-[#0b141a]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 25%, oklch(0.69 0.17 162 / 0.04) 0, transparent 50%), radial-gradient(circle at 75% 75%, oklch(0.65 0.18 264 / 0.04) 0, transparent 50%)",
          }}
        >
          <div className="text-center my-2">
            <span className="text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-full">
              Today · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </span>
          </div>

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onButton={handleButton} onListOpen={(rows, title) => setListOpen({ rows, title })} />
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-3 py-2 flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "120ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "240ms" }} />
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="bg-zinc-900 border-t border-zinc-800 px-2 py-2 flex items-end gap-1.5">
          <div className="flex gap-0.5">
            <button
              onClick={handleCamera}
              disabled={loading}
              className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
              aria-label="Camera"
            >
              <Camera className="w-5 h-5" />
            </button>
            <button
              onClick={handleVoice}
              disabled={loading}
              className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
              aria-label="Voice"
            >
              <Mic className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 bg-zinc-800 rounded-3xl px-4 py-2 flex items-center">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Message"
              disabled={loading}
              className="bg-transparent outline-none flex-1 text-sm text-white placeholder:text-zinc-500 disabled:opacity-50"
            />
            <button
              onClick={handleLocation}
              disabled={loading}
              className="text-zinc-400 hover:text-emerald-400 ml-2 disabled:opacity-40"
              aria-label="Share location"
            >
              <MapPin className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:opacity-50 flex items-center justify-center text-zinc-950 transition-colors"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {/* List picker overlay */}
        {listOpen && (
          <div className="absolute inset-0 bg-black/50 z-20 flex items-end" onClick={() => setListOpen(null)}>
            <div
              className="bg-zinc-900 w-full rounded-t-2xl p-4 animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-white">{listOpen.title}</h4>
                <button onClick={() => setListOpen(null)} className="text-zinc-400 text-xs">Close</button>
              </div>
              <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                {listOpen.rows.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => handleListTap(row.id, row.title)}
                    className="w-full text-left p-3 rounded-xl hover:bg-zinc-800 transition-colors flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{row.title}</p>
                      {row.description && <p className="text-xs text-zinc-400">{row.description}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onButton,
  onListOpen,
}: {
  message: ChatMessage;
  onButton: (id: string, label: string) => void;
  onListOpen: (rows: Array<{ id: string; title: string; description?: string }>, title: string) => void;
}) {
  const isMe = message.from === "me";
  return (
    <div className={cn("flex animate-message-in", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2",
          isMe
            ? "bg-emerald-600 text-white rounded-tr-sm"
            : "bg-zinc-800 text-zinc-100 rounded-tl-sm"
        )}
      >
        {message.text && <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>}

        {message.attachment && (
          <div className="flex items-center gap-2 py-1">
            <span className="text-sm">{message.attachment.label}</span>
          </div>
        )}

        {message.reply && (
          <div className="space-y-2">
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.reply.text}</p>
            {message.reply.buttons && (
              <div className="flex flex-col gap-1 mt-2">
                {message.reply.buttons.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => onButton(b.id, b.label)}
                    className="text-left text-sm px-3 py-2 rounded-lg bg-zinc-700/50 hover:bg-zinc-700 text-emerald-300 transition-colors border border-zinc-600/50"
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            {message.reply.kind === "list" && message.reply.sections && (
              <button
                onClick={() => onListOpen(message.reply!.sections![0].rows, message.reply!.listTitle || "Menu")}
                className="w-full text-left text-sm px-3 py-2 rounded-lg bg-zinc-700/50 hover:bg-zinc-700 text-emerald-300 transition-colors border border-zinc-600/50 mt-1"
              >
                {message.reply.listButton || "📋 View Menu"}
              </button>
            )}
          </div>
        )}

        <div className={cn("flex items-center gap-1 mt-0.5 text-[10px]", isMe ? "text-emerald-100/70 justify-end" : "text-zinc-400")}>
          <span>{new Date(message.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          {isMe && (message.status === "read" ? <CheckCheck className="w-3 h-3 text-sky-300" /> : <Check className="w-3 h-3" />)}
        </div>
      </div>
    </div>
  );
}
