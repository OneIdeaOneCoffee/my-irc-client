import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// Ícones simples em texto
const Power = ({ size = 24 }) => <span style={{ fontWeight: "bold", fontSize: size }}>⏻</span>;
const Send = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>↑</span>;
const User = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>👤</span>;

function App() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const heartbeatRef = useRef(null);

  // Scroll automático ao final do chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Conexão WebSocket
  const connectWebSocket = () => {
    if (!serverUrl || !nickname) {
      addLog("error", "Preencha servidor e apelido antes de conectar.");
      return;
    }

    try {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        addLog("system", `Conectado a ${serverUrl}`);
        sendMessage(`NICK ${nickname}`);
        sendMessage(`USER ${nickname} 0 * :${nickname}`);
        heartbeatRef.current = setInterval(() => sendMessage("PING :heartbeat"), 30000);
      };

      ws.onmessage = (event) => {
        addLog("server", event.data);
      };

      ws.onerror = (error) => {
        addLog("error", `Erro WebSocket: ${error.message || error}`);
      };

      ws.onclose = () => {
        setConnected(false);
        addLog("system", "Desconectado do servidor.");
        clearInterval(heartbeatRef.current);
      };
    } catch (err) {
      addLog("error", `Falha na conexão: ${err.message}`);
    }
  };

  // Envio de mensagens
  const sendMessage = (msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
      addLog("client", msg);
    } else {
      addLog("error", "Conexão WebSocket não está aberta.");
    }
  };

  const handleSendMessage = () => {
    if (input.trim()) {
      sendMessage(input);
      setInput("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
      e.preventDefault();
    }
  };

  const addLog = (type, text) => {
    setMessages((prev) => [...prev, { type, text }]);
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      setConnected(false);
    }
  };

  return (
    <div className="app">
      <h1>IRC Web Client</h1>

      <div className="connection">
        <input
          type="text"
          placeholder="Servidor (ex: wss://irc-ws.chat)"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="Apelido"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button onClick={connected ? disconnect : connectWebSocket}>
          <Power /> {connected ? "Desconectar" : "Conectar"}
        </button>
      </div>

      <div className="chat">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.type}`}>
              <span>
                {m.type === "client" && <User />} {m.text}
              </span>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <input
            type="text"
            placeholder="Digite sua mensagem..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={handleSendMessage}>
            <Send />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
