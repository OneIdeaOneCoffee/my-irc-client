// App.js CORRIGIDO
import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// Ícones simplificados
const Power = ({ size = 24 }) => <span style={{ fontWeight: "bold", fontSize: size }}>⏻</span>;
const Send = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>↑</span>;

function App() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [nickname, setNickname] = useState("user" + Math.floor(Math.random() * 1000));
  const clientRef = useRef(null);

  const CONSULTANCY_SERVER = "wss://irc.unrealircd.org:443";

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (clientRef.current) {
        clientRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    try {
      console.log("Conectando ao:", CONSULTANCY_SERVER);
      const ws = new WebSocket(CONSULTANCY_SERVER);
      
      ws.onopen = () => {
        console.log("WebSocket conectado, autenticando...");
        setConnected(true);
        
        // ✅ Comandos IRC necessários para autenticação
        sendIRCMessage(ws, "NICK", nickname);
        sendIRCMessage(ws, "USER", `${nickname} 0 * :React IRC Client`);
        
        setMessages(prev => [...prev, { 
          content: `Conectado como ${nickname}`, 
          type: "info" 
        }]);
      };
      
      ws.onclose = (event) => {
        console.log("Conexão fechada:", event.code, event.reason);
        setConnected(false);
        setMessages(prev => [...prev, { 
          content: `Desconectado: ${event.reason || "Conexão fechada"}`, 
          type: "info" 
        }]);
      };
      
      ws.onmessage = (event) => {
        const data = event.data;
        console.log("Mensagem recebida:", data);
        
        // Processa mensagens do servidor IRC
        handleIRCMessage(data);
      };
      
      ws.onerror = (error) => {
        console.error("Erro WebSocket:", error);
        setConnected(false);
        setMessages(prev => [...prev, { 
          content: "Erro de conexão com o servidor", 
          type: "error" 
        }]);
      };
      
      clientRef.current = ws;
    } catch (error) {
      console.error("Falha ao conectar:", error);
      setMessages(prev => [...prev, { 
        content: `Falha na conexão: ${error.message}`, 
        type: "error" 
      }]);
    }
  };

  const sendIRCMessage = (ws, command, message = "") => {
    if (ws.readyState === WebSocket.OPEN) {
      const fullMessage = message ? `${command} ${message}` : command;
      console.log("Enviando:", fullMessage);
      ws.send(fullMessage + "\r\n"); // ✅ IRC requer \r\n no final
    }
  };

  const handleIRCMessage = (rawMessage) => {
    const lines = rawMessage.split('\n');
    
    lines.forEach(line => {
      if (!line.trim()) return;
      
      console.log("Processando linha:", line);
      
      // Mensagem PING do servidor (requer PONG)
      if (line.startsWith('PING')) {
        const pingId = line.split(' ')[1];
        sendIRCMessage(clientRef.current, "PONG", pingId);
        return;
      }
      
      // Mensagens regulares do IRC
      setMessages(prev => [...prev, { 
        content: line, 
        type: "server",
        timestamp: new Date().toLocaleTimeString()
      }]);
    });
  };

  const handleConnect = () => {
    if (clientRef.current) {
      clientRef.current.close();
    }
    setMessages([]);
    connectWebSocket();
  };

  const handleSendMessage = () => {
    if (!inputValue.trim() || !clientRef.current || clientRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      // Se começar com /, é comando IRC
      if (inputValue.startsWith('/')) {
        const parts = inputValue.slice(1).split(' ');
        const command = parts[0].toUpperCase();
        const args = parts.slice(1).join(' ');
        sendIRCMessage(clientRef.current, command, args);
      } else {
        // Mensagem normal para o canal
        sendIRCMessage(clientRef.current, "PRIVMSG", `#teste :${inputValue}`);
      }
      
      // Mostra no chat local
      setMessages(prev => [...prev, { 
        content: `[${nickname}] ${inputValue}`, 
        type: "user",
        timestamp: new Date().toLocaleTimeString()
      }]);
      
      setInputValue("");
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      setMessages(prev => [...prev, { 
        content: "Erro ao enviar mensagem", 
        type: "error" 
      }]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="consultoria-app">
      <header className="header">
        <div className="header-content">
          <div className="app-title">IRC Client - {nickname}</div>
          <div className="connection-status">
            <span
              className={`status-dot ${connected ? "connected" : "disconnected"}`}
            />
            <span className="status-text">
              {connected ? `Conectado como ${nickname}` : "Desconectado"}
            </span>
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
              <div className="channel-name">
                {connected ? "IRC UnrealIRCd" : "Desconectado"}
              </div>
              <div className="user-count">{messages.length} mensagens</div>
            </div>
          </div>

          <div className="messages-area">
            <div className="messages-list">
              {messages.length === 0 && (
                <div className="welcome-message">
                  <div className="welcome-icon">💬</div>
                  <h3>Bem-vindo ao IRC Client</h3>
                  <p>Use /join #canal para entrar em um canal</p>
                  <p>Digite mensagens abaixo e pressione Enter</p>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.type}-message`}>
                  {msg.timestamp && (
                    <span className="timestamp">[{msg.timestamp}] </span>
                  )}
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
                onKeyDown={handleKeyDown}
                placeholder={connected ? "Digite mensagem ou comando IRC..." : "Conecte-se primeiro..."}
                disabled={!connected}
                className="message-input"
              />
              <button
                className="send-btn"
                onClick={handleSendMessage}
                disabled={!inputValue || !connected}
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
