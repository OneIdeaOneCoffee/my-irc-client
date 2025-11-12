// App.js
import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// Ícones simplificados
const Power = ({ size = 24 }) => <span style={{ fontWeight: "bold", fontSize: size }}>⏻</span>;
const Send = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>↑</span>;
const User = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>👤</span>;

function App() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const clientRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Inicializa cliente WebSocket
    clientRef.current = new WebSocket("wss://your-irc-server.com");
    clientRef.current.onopen = () => setConnected(true);
    clientRef.current.onclose = () => setConnected(false);
    clientRef.current.onmessage = (event) => {
      const data = event.data;
      setMessages((prev) => [...prev, { content: data, type: "info" }]);
    };
    clientRef.current.onerror = (err) => console.error("WebSocket error:", err);

    return () => {
      if (clientRef.current) clientRef.current.close();
    };
  }, []);

  const handleSendMessage = () => {
    if (!inputValue || !clientRef.current) return;
    try {
      clientRef.current.send(inputValue);
      setMessages([...messages, { content: inputValue, type: "user" }]);
      setInputValue("");
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
    }
  };

  const handleConnect = () => {
    if (!clientRef.current) return;
    try {
      clientRef.current = new WebSocket("wss://your-irc-server.com");
    } catch (err) {
      console.error("Falha ao conectar:", err);
    }
  };

  return (
    <div className="consultoria-app">
      <header className="header">
        <div className="header-content">
          <div className="app-title">Meu IRC Client</div>
          <div className="connection-status">
            <span
              className={`status-dot ${connected ? "connected" : "disconnected"}`}
            />
            <span className="status-text">{connected ? "Conectado" : "Desconectado"}</span>
          </div>
          <button className="connect-btn primary" onClick={handleConnect}>
            <Power /> {connected ? "Reconectar" : "Conectar"}
          </button>
        </div>
      </header>

      <main className="main-container">
        <div className="chat-container">
          <div className="chat-header">
            <div className="channel-info">
              <div className="channel-name">Canal Geral</div>
              <div className="user-count">{messages.length} mensagens</div>
            </div>
          </div>

          <div className="messages-area">
            <div className="messages-list">
              {messages.length === 0 && (
                <div className="welcome-message">
                  <div className="welcome-icon">💬</div>
                  <h3>Bem-vindo ao Chat</h3>
                  <p>Digite uma mensagem abaixo e pressione Enter para enviar.</p>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.type}-message`}>
                  <div className="message-content">{msg.content}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="input-area">
            <div className="input-group">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                ref={inputRef}
                className="message-input"
              />
              <button
                className="send-btn"
                onClick={handleSendMessage}
                disabled={!inputValue}
              >
                <Send />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
