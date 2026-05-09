"use client";

import { useEffect, useRef, useState } from "react";

export default function HiCarAIChatUI() {
  const [isOpen, setIsOpen] = useState(true);

  // chat position
  const [position, setPosition] = useState({
    x: 100,
    y: 80,
  });

  const isDragging = useRef(false);

  const offset = useRef({
    x: 0,
    y: 0,
  });

  // drag start
  const handleMouseDown = (
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    isDragging.current = true;

    offset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    console.log("[DRAG START]");
  };

  // drag move
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const newX = e.clientX - offset.current.x;
      const newY = e.clientY - offset.current.y;

      setPosition({
        x: newX,
        y: newY,
      });
    };

    const handleUp = () => {
      isDragging.current = false;
      console.log("[DRAG END]");
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#EEF2FF]">
      {/* FLOATING CHAT */}
      <div
        style={{
          left: position.x,
          top: position.y,
        }}
        className="fixed z-50"
      >
        {/* MINIMIZED BUBBLE */}
        {!isOpen && (
          <div
            onMouseDown={handleMouseDown}
            className="cursor-move"
          >
            <button
              onClick={() => {
                console.log("[OPEN CHAT]");
                setIsOpen(true);
              }}
              className="h-16 w-16 rounded-full bg-gradient-to-r bg-violet-600   text-white text-2xl flex items-center justify-center hover:scale-105 transition"
            >
              AI
            </button>
          </div>
        )}

        {/* FULL CHAT */}
        {isOpen && (
          <div className="w-97.5 h-180 bg-white rounded-[34px] shadow-2xl overflow-hidden border border-gray-200 flex flex-col">
            {/* HEADER */}
            <div
              onMouseDown={handleMouseDown}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-500 px-5 py-4 text-white flex items-center justify-between cursor-move select-none"
            >
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg">
                  AI
                </div>

                <div>
                  <h2 className="font-bold text-lg">
                    HiCar AI
                  </h2>

                  <p className="text-xs text-violet-100">
                    OEM Assistant • Online
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* MINIMIZE */}
                <button
                  onClick={() => {
                    console.log("[MINIMIZE]");
                    setIsOpen(false);
                  }}
                  className="h-9 w-9 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                >
                  ─
                </button>

                {/* CLOSE */}
                <button
                  onClick={() => {
                    console.log("[CLOSE]");
                    setIsOpen(false);
                  }}
                  className="h-9 w-9 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* CHAT BODY */}
            <div className="flex-1 overflow-y-auto bg-[#F5F7FB] p-5 space-y-5">
              {/* AI */}
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white flex items-center justify-center font-bold">
                  AI
                </div>

                <div className="bg-white rounded-3xl rounded-tl-md px-5 py-4 shadow-sm border border-gray-100 max-w-[260px]">
                  <p className="text-sm text-gray-800">
                    Сайн байна уу 👋
                    <br />
                    Ямар сэлбэг хайж байна?
                  </p>
                </div>
              </div>

              {/* USER */}
              <div className="flex justify-end">
                <div className="bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white rounded-3xl rounded-br-md px-5 py-4 shadow-xl max-w-[260px]">
                  <p className="text-sm">
                    Prius 30 inverter
                  </p>
                </div>
              </div>

              {/* PRODUCT */}
              <div className="bg-white rounded-3xl border border-gray-100 p-4 shadow-xl">
                <div className="h-40 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center text-6xl">
                  🚗
                </div>

                <div className="mt-4">
                  <h3 className="font-bold text-lg">
                    Prius 30 Inverter
                  </h3>

                  <p className="text-sm text-gray-500 mt-1">
                    Toyota Genuine OEM
                  </p>

                  <div className="grid grid-cols-2 gap-3 mt-5">
                    <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                      <p className="text-xs text-gray-500">
                        Japan
                      </p>

                      <h4 className="text-lg font-bold mt-1">
                        $320
                      </h4>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                      <p className="text-xs text-gray-500">
                        China
                      </p>

                      <h4 className="text-lg font-bold mt-1">
                        $180
                      </h4>
                    </div>
                  </div>

                  <button className="w-full mt-5 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-lg hover:opacity-90 transition">
                    Add to Cart
                  </button>
                </div>
              </div>
            </div>

            {/* INPUT */}
            <div className="border-t border-gray-100 bg-white p-4">
              <div className="flex items-center gap-3 bg-[#F5F7FB] rounded-full px-3 py-2 border border-gray-100 shadow-sm">
                <button className="h-11 w-11 rounded-full bg-white shadow hover:scale-105 transition flex items-center justify-center text-lg">
                  ➕
                </button>

                <input
                  placeholder="Сэлбэгээ бичнэ үү..."
                  className="flex-1 bg-transparent outline-none text-sm"
                />

                <button className="h-11 w-11 rounded-full bg-white shadow hover:scale-105 transition flex items-center justify-center text-lg">
                  🎙
                </button>

                <button className="h-11 w-11 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-lg hover:scale-105 transition flex items-center justify-center text-lg">
                  ➤
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}