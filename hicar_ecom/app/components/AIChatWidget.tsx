"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Message {
  id: number;
  role: "ai" | "user";
  text: string;
  product?: {
    name: string;
    oem: string;
    jpPrice: string;
    cnPrice: string;
    icon: string;
  };
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: 1,
    role: "ai",
    text: "Сайн байна уу! 👋\nЯмар сэлбэг хайж байна вэ? Машины марк, загвар, онтой хамт бичнэ үү.",
  },
];

const MOCK_PRODUCTS: Record<
  string,
  { name: string; oem: string; jpPrice: string; cnPrice: string; icon: string }
> = {
  inverter: {
    name: "Prius 30 Inverter",
    oem: "G9200-47140",
    jpPrice: "₮ 1,120,000",
    cnPrice: "₮ 630,000",
    icon: "⚡",
  },
  тоормос: {
    name: "Урд тоормосны диск",
    oem: "43512-47060",
    jpPrice: "₮ 48,000",
    cnPrice: "₮ 24,000",
    icon: "🔧",
  },
  амортизатор: {
    name: "Урд амортизатор",
    oem: "48510-80695",
    jpPrice: "₮ 128,000",
    cnPrice: "₮ 65,000",
    icon: "🔩",
  },
  фар: {
    name: "Урд зүүн фар",
    oem: "81150-47180",
    jpPrice: "₮ 145,000",
    cnPrice: "₮ 72,000",
    icon: "💡",
  },
};

function findProduct(text: string) {
  const lower = text.toLowerCase();
  for (const [key, val] of Object.entries(MOCK_PRODUCTS)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

export default function HiCarAIChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [nextId, setNextId] = useState(10);

  // Drag state
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const posRef = useRef(pos);
  const hasDragged = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Init position — bottom right
  useEffect(() => {
    const initPos = {
      x: Math.max(16, window.innerWidth - 400 - 24),
      y: Math.max(16, window.innerHeight - 700 - 24),
    };
    setPos(initPos);
    posRef.current = initPos;
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMobile) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMobile]);

  // Drag handlers (mouse)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input, textarea")) return;
      e.preventDefault();
      hasDragged.current = false;
      dragOffset.current = {
        x: e.clientX - posRef.current.x,
        y: e.clientY - posRef.current.y,
      };
      setDragging(true);
    },
    []
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      hasDragged.current = true;
      const chatW = isMobile ? window.innerWidth : 380;
      const chatH = isOpen ? (isMobile ? window.innerHeight : 640) : 64;
      const newX = Math.min(
        Math.max(0, e.clientX - dragOffset.current.x),
        window.innerWidth - chatW
      );
      const newY = Math.min(
        Math.max(0, e.clientY - dragOffset.current.y),
        window.innerHeight - chatH
      );
      setPos({ x: newX, y: newY });
      posRef.current = { x: newX, y: newY };
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, isOpen, isMobile]);

  // Touch drag
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    const t = e.touches[0];
    hasDragged.current = false;
    dragOffset.current = {
      x: t.clientX - posRef.current.x,
      y: t.clientY - posRef.current.y,
    };
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      hasDragged.current = true;
      const t = e.touches[0];
      const chatW = isMobile ? window.innerWidth : 380;
      const chatH = isOpen ? (isMobile ? window.innerHeight : 640) : 64;
      const newX = Math.min(
        Math.max(0, t.clientX - dragOffset.current.x),
        window.innerWidth - chatW
      );
      const newY = Math.min(
        Math.max(0, t.clientY - dragOffset.current.y),
        window.innerHeight - chatH
      );
      setPos({ x: newX, y: newY });
      posRef.current = { x: newX, y: newY };
    };
    const onEnd = () => setDragging(false);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [dragging, isOpen, isMobile]);

  // Send message
  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    const userMsg: Message = { id: nextId, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setNextId((n) => n + 1);
    setIsTyping(true);

    setTimeout(() => {
      const product = findProduct(text);
      const aiMsg: Message = {
        id: nextId + 1,
        role: "ai",
        text: product
          ? `OEM дугаар олдлоо ✅\n${product.oem}`
          : "Уучлаарай, тухайн сэлбэгийг олсонгүй. 'тоормос', 'амортизатор', 'фар', 'inverter' гэх мэт бичнэ үү.",
        product: product || undefined,
      };
      setMessages((m) => [...m, aiMsg]);
      setIsTyping(false);
      setNextId((n) => n + 2);
    }, 1200);
  }, [input, nextId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Chat dimensions
  const chatWidth = isMobile ? "100vw" : "380px";
  const chatHeight = isMobile ? "100dvh" : "640px";
  const chatLeft = isMobile ? 0 : pos.x;
  const chatTop = isMobile ? 0 : pos.y;
  const borderRadius = isMobile ? "0" : "24px";

  return (
    <>
      {/* BUBBLE (closed state) */}
      {!isOpen && (
        <div
          style={{
            position: "fixed",
            left: isMobile ? "auto" : pos.x,
            right: isMobile ? "20px" : "auto",
            top: isMobile ? "auto" : pos.y,
            bottom: isMobile ? "20px" : "auto",
            zIndex: 9999,
            cursor: dragging ? "grabbing" : "grab",
          }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        >
          <button
            onClick={() => {
              if (!hasDragged.current) setIsOpen(true);
            }}
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              border: "none",
              color: "white",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 20px rgba(124,58,237,0.4)",
              transition: "transform 0.15s, box-shadow 0.15s",
              letterSpacing: 0.5,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                "0 6px 28px rgba(124,58,237,0.5)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                "0 4px 20px rgba(124,58,237,0.4)";
            }}
            aria-label="AI чат нээх"
          >
            AI
          </button>
          {/* Unread dot */}
          <div
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#ef4444",
              border: "2px solid white",
            }}
          />
        </div>
      )}

      {/* CHAT WINDOW */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            left: chatLeft,
            top: chatTop,
            width: chatWidth,
            height: chatHeight,
            zIndex: 9999,
            borderRadius,
            background: "white",
            boxShadow: isMobile
              ? "none"
              : "0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)",
            border: isMobile ? "none" : "0.5px solid rgba(0,0,0,0.1)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            cursor: dragging ? "grabbing" : "default",
          }}
        >
          {/* HEADER — draggable */}
          <div
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: dragging ? "grabbing" : "grab",
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Avatar */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "white",
                  flexShrink: 0,
                  border: "1.5px solid rgba(255,255,255,0.3)",
                }}
              >
                AI
              </div>
              <div>
                <div
                  style={{
                    color: "white",
                    fontWeight: 600,
                    fontSize: 15,
                    lineHeight: 1.2,
                  }}
                >
                  HiCar AI
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.75)",
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#4ade80",
                      display: "inline-block",
                    }}
                  />
                  OEM Assistant · Online
                </div>
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(255,255,255,0.25)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(255,255,255,0.15)")
                }
                title="Багасгах"
                aria-label="Чат хаах"
              >
                —
              </button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(255,0,0,0.35)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(255,255,255,0.15)")
                }
                title="Хаах"
                aria-label="Цонх хаах"
              >
                ✕
              </button>
            </div>
          </div>

          {/* MESSAGES */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              background: "#f5f7fb",
              padding: "16px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.role === "ai" ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    {/* AI avatar */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "white",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      AI
                    </div>
                    <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Text bubble */}
                      <div
                        style={{
                          background: "white",
                          borderRadius: "4px 16px 16px 16px",
                          padding: "10px 14px",
                          fontSize: 13,
                          lineHeight: 1.55,
                          color: "#1f2937",
                          border: "0.5px solid #e5e7eb",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {msg.text}
                      </div>
                      {/* Product card */}
                      {msg.product && (
                        <div
                          style={{
                            background: "white",
                            borderRadius: 16,
                            border: "0.5px solid #e5e7eb",
                            overflow: "hidden",
                            boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                            width: 260,
                          }}
                        >
                          {/* Product image */}
                          <div
                            style={{
                              height: 100,
                              background:
                                "linear-gradient(135deg,#ede9fe 0%,#f3e8ff 100%)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 40,
                            }}
                          >
                            {msg.product.icon}
                          </div>
                          <div style={{ padding: "12px 14px" }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 14,
                                color: "#111827",
                                marginBottom: 2,
                              }}
                            >
                              {msg.product.name}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#6b7280",
                                fontFamily: "monospace",
                                marginBottom: 10,
                              }}
                            >
                              {msg.product.oem}
                            </div>
                            {/* Price comparison */}
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                                marginBottom: 10,
                              }}
                            >
                              <div
                                style={{
                                  background: "#f0fdf4",
                                  border: "0.5px solid #bbf7d0",
                                  borderRadius: 10,
                                  padding: "8px 10px",
                                }}
                              >
                                <div style={{ fontSize: 10, color: "#16a34a", marginBottom: 2, fontWeight: 500 }}>
                                  🇯🇵 Japan OEM
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d" }}>
                                  {msg.product.jpPrice}
                                </div>
                              </div>
                              <div
                                style={{
                                  background: "#fffbeb",
                                  border: "0.5px solid #fde68a",
                                  borderRadius: 10,
                                  padding: "8px 10px",
                                }}
                              >
                                <div style={{ fontSize: 10, color: "#d97706", marginBottom: 2, fontWeight: 500 }}>
                                  🇨🇳 Aftermarket
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#b45309" }}>
                                  {msg.product.cnPrice}
                                </div>
                              </div>
                            </div>
                            <button
                              style={{
                                width: "100%",
                                padding: "9px 0",
                                borderRadius: 10,
                                background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                                border: "none",
                                color: "white",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "opacity 0.15s",
                              }}
                              onMouseEnter={(e) =>
                                ((e.currentTarget as HTMLButtonElement).style.opacity = "0.9")
                              }
                              onMouseLeave={(e) =>
                                ((e.currentTarget as HTMLButtonElement).style.opacity = "1")
                              }
                            >
                              Сагсанд нэмэх 🛒
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // USER message
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div
                      style={{
                        background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                        color: "white",
                        borderRadius: "16px 4px 16px 16px",
                        padding: "10px 14px",
                        fontSize: 13,
                        lineHeight: 1.5,
                        maxWidth: "78%",
                        boxShadow: "0 2px 8px rgba(124,58,237,0.3)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "white",
                    flexShrink: 0,
                  }}
                >
                  AI
                </div>
                <div
                  style={{
                    background: "white",
                    borderRadius: "4px 16px 16px 16px",
                    padding: "12px 16px",
                    border: "0.5px solid #e5e7eb",
                    display: "flex",
                    gap: 5,
                    alignItems: "center",
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#a78bfa",
                        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* QUICK REPLIES */}
          <div
            style={{
              background: "#f5f7fb",
              padding: "6px 14px 8px",
              display: "flex",
              gap: 6,
              overflowX: "auto",
              flexShrink: 0,
              borderTop: "0.5px solid #e5e7eb",
            }}
          >
            {["Тоормос", "Амортизатор", "Фар", "Inverter"].map((q) => (
              <button
                key={q}
                onClick={() => {
                  setInput(q);
                  setTimeout(() => sendMessage(), 0);
                  setInput(q);
                }}
                style={{
                  padding: "5px 12px",
                  borderRadius: 20,
                  border: "0.5px solid #ddd6fe",
                  background: "white",
                  color: "#7c3aed",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "#7c3aed";
                  el.style.color = "white";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "white";
                  el.style.color = "#7c3aed";
                }}
              >
                {q}
              </button>
            ))}
          </div>

          {/* INPUT */}
          <div
            style={{
              background: "white",
              borderTop: "0.5px solid #e5e7eb",
              padding: "10px 12px",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#f5f7fb",
                borderRadius: 24,
                border: "0.5px solid #e5e7eb",
                padding: "6px 8px 6px 16px",
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Сэлбэгээ бичнэ үү..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  color: "#1f2937",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isTyping}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background:
                    input.trim() && !isTyping
                      ? "linear-gradient(135deg,#7c3aed,#a855f7)"
                      : "#e5e7eb",
                  border: "none",
                  color: input.trim() && !isTyping ? "white" : "#9ca3af",
                  cursor: input.trim() && !isTyping ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  transition: "all 0.2s",
                  flexShrink: 0,
                }}
                aria-label="Илгээх"
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bounce animation */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </>
  );
}
