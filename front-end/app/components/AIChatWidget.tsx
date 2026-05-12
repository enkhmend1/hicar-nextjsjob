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
    text: "Сайн байна уу! 👋\nЯмар сэлбэг хайж байна вэ?",
  },
];

const MOCK_PRODUCTS: Record<string, any> = {
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
  return Object.entries(MOCK_PRODUCTS).find(([k]) =>
    lower.includes(k)
  )?.[1] || null;
}

export default function HiCarAIChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const idRef = useRef(10);
  const endRef = useRef<HTMLDivElement>(null);

  // scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // OPEN
  const openChat = () => {
    setIsOpen(true);
    setIsMinimized(false);
  };

  // MINIMIZE
  const minimizeChat = () => {
    setIsMinimized(true);
  };

  // CLOSE
  const closeChat = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  // SEND
  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: idRef.current++,
      role: "user",
      text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const product = findProduct(text);

      const aiMsg: Message = {
        id: idRef.current++,
        role: "ai",
        text: product
          ? `OEM олдлоо ✅\n${product.oem}`
          : "Олдсонгүй ❌ (тоормос, фар, амортизатор, inverter)",
        product,
      };

      setMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 800);
  }, [input, isTyping]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") sendMessage();
  };

  return (
    <>
      {/* FLOAT BUTTON (restore/open) */}
      {(!isOpen || isMinimized) && (
        <button
          onClick={openChat}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: "#7c3aed",
            color: "white",
            border: "none",
            fontWeight: 700,
            cursor: "pointer",
            zIndex: 9999,
          }}
        >
          AI
        </button>
      )}

      {/* CHAT WINDOW */}
      {isOpen && !isMinimized && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: 360,
            height: 600,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 16,
            display: "flex",
            flexDirection: "column",
            zIndex: 9999,
          }}
        >
          {/* HEADER */}
          <div
            style={{
              background: "#7c3aed",
              color: "white",
              padding: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <b>HiCar AI</b>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={minimizeChat} style={{ color: "white" }}>
                —
              </button>
              <button onClick={closeChat} style={{ color: "white" }}>
                ✕
              </button>
            </div>
          </div>

          {/* MESSAGES */}
          <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ textAlign: m.role === "user" ? "right" : "left" }}>
                <div
                  style={{
                    display: "inline-block",
                    margin: "6px 0",
                    padding: 10,
                    borderRadius: 10,
                    background: m.role === "user" ? "#7c3aed" : "#f3f4f6",
                    color: m.role === "user" ? "white" : "black",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {isTyping && <div>AI бичиж байна...</div>}
            <div ref={endRef} />
          </div>

          {/* INPUT */}
          <div style={{ display: "flex", padding: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Сэлбэг бич..."
              style={{
                flex: 1,
                padding: 10,
                border: "1px solid #ddd",
                borderRadius: 10,
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                marginLeft: 8,
                padding: "10px 14px",
                background: "#7c3aed",
                color: "white",
                border: "none",
                borderRadius: 10,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}