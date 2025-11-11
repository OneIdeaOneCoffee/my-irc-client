import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// Ícones simplificados
const Power = ({ size = 24 }) => <span style={{ fontWeight: "bold", fontSize: size }}>⏻</span>;
const Send = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>↑</span>;
const User = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>👤</span>;

// Configuração fixa para consultoria
const CONSULTANCY_CHANNEL = "#consultoria-privada";
const CONSULTANCY_SERVER = "wss://irc.ergo.chat:6697";

class BufferManager {
  constructor() { this.buffer = ""; }
  push(chunk) {
    this.buffer += chunk;
    const lines = [];
    while (this.buffer.includes("\r\n")) {
      const idx = this.buffer.indexOf("\r\n");
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 2);
    }
    return lines;
  }
  clear() { this.buffer = ""; }
}

class IRCParser {
  static parse(line) {
    let prefix = null, command = null, params = [], trailing = null, pos = 0;
    if (line[0] === ":") { 
      const spaceIdx = line.indexOf(" "); 
      prefix = line.slice(1, spaceIdx); 
      pos = spaceIdx + 1; 
    }
    const nextSpace = line.indexOf(" ", pos);
    if (nextSpace === -1) { 
      command = line.slice(pos).trim(); 
      return { raw: line, prefix, command, params, trailing }; 
    }
    command = line.slice(pos, nextSpace); 
    pos = nextSpace + 1;
    const rest = line.slice(pos);
    if (rest.includes(" :")) { 
      const trailingIdx = rest.indexOf(" :"); 
      const beforeTrailing = rest.slice(0, trailingIdx); 
      trailing = rest.slice(trailingIdx + 2); 
      params = beforeTrailing.split(" ").filter(Boolean); 
    }
    else if (rest[0] === ":") { 
      trailing = rest.slice(1); 
    } else { 
      params = rest.split(" ").filter(Boolean); 
    }
    return { raw: line, prefix, command, params, trailing };
  }
}

class IRCClient {
  constructor() {
    this.ws = null;
    this.buffer = new BufferManager();
    this.listeners = new Map();
    this.connectionState = "disconnected";
    this.heartbeatInterval = null;
    this.lastActivity = Date.now();
  }
  
  on(event, callback) {
    if (!this.listeners.has(event)) { this.listeners.set(event, []); }
    this.listeners.get(event).push(callback);
  }
  
  emit(event, data) {
    if (this.listeners.has(event)) { this.listeners.get(event).forEach((cb) => cb(data)); }
  }
  
  connect(url, nick, user, realname) {
    this.connectionState = "connecting";
    this.emit("state", { state: "connecting" });
    this.ws = new window.WebSocket(url);
    
    this.ws.addEventListener("open", () => {
      this.connectionState = "registering";
      this.emit("state", { state: "registering" });
      this.send(`NICK ${nick}`);
      this.send(`USER ${user} 0 * :${realname}`);
      this.startHeartbeat();
    });
    
    this.ws.addEventListener("message", (evt) => {
      this.lastActivity = Date.now();
      const lines = this.buffer.push(evt.data);
      lines.forEach((line) => {
        if (!line.trim()) return;
        
        const msg = IRCParser.parse(line);
        
        if (msg.command === "PING") { 
          this.send(`PONG ${msg.trailing || msg.params[0]}`); 
          return; 
        }
        
        if (msg.command === "001") { 
          this.connectionState = "connected"; 
          this.emit("state", { state: "connected" }); 
          this.emit("registered", msg); 
          return; 
        }
        
        if (msg.command === "PRIVMSG") {
          const target = msg.params[0];
          const sender = msg.prefix ? msg.prefix.split("!")[0] : "server";
          this.emit("message", { 
            from: sender, 
            to: target, 
            text: msg.trailing, 
            isChannel: target.startsWith("#"), 
            raw: msg 
          });
        } else if (msg.command === "JOIN") {
          const nick = msg.prefix ? msg.prefix.split("!")[0] : "";
          const channel = msg.trailing || msg.params[0];
          this.emit("join", { nick, channel, raw: msg });
        } else if (msg.command === "PART") {
          const nick = msg.prefix ? msg.prefix.split("!")[0] : "";
          const channel = msg.params[0];
          this.emit("part", { nick, channel, reason: msg.trailing, raw: msg });
        } else if (msg.command === "353") {
          const channel = msg.params[2];
          const users = msg.trailing ? msg.trailing.split(" ").filter(u => u) : [];
          this.emit("names", { channel, users, raw: msg });
        }
      });
    });
    
    this.ws.addEventListener("close", (evt) => { 
      this.connectionState = "disconnected"; 
      this.buffer.clear(); 
      this.stopHeartbeat();
      this.emit("state", { state: "disconnected", code: evt.code }); 
    });
    
    this.ws.addEventListener("error", (err) => {
      this.emit("error", { type: err.type });
    });
  }
  
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Date.now();
        if (now - this.lastActivity > 25000) {
          this.send(`PING ${now}`);
        }
      }
    }, 20000);
  }
  
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  send(line) { 
    if (this.ws && this.ws.readyState === window.WebSocket.OPEN) { 
      this.ws.send(line + "\r\n"); 
      this.lastActivity = Date.now();
    } 
  }
  
  disconnect() { 
    this.stopHeartbeat();
    if (this.ws) this.ws.close(); 
  }
  
  join(channel) { this.send(`JOIN ${channel}`); }
  part(channel) { this.send(`PART ${channel}`); }
  privmsg(target, text) { this.send(`PRIVMSG ${target} :${text}`); }
  quit() { this.send(`QUIT :Saindo da consultoria`); setTimeout(() => this.disconnect(), 500); }
}

const ACTION_BUTTONS = [
  { action: "clear", label: "Limpar", icon: "🗑️" },
  { action: "users", label: "Usuários", icon: "👥" },
  { action: "help", label: "Ajuda", icon: "❓" },
  { action: "leave", label: "Sair", icon: "🚪" }
];

export default function ConsultoriaIRC() {
  const [state, setState] = useState("disconnected");
  const [commandInput, setCommandInput] = useState("");
  const [channelUsers, setChannelUsers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [showUsers, setShowUsers] = useState(false);
  const [nick] = useState(() => `Cliente${Math.floor(Math.random() * 9999)}`);
  
  const clientRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll para baixo no chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Focar no input quando conectar
  useEffect(() => {
    if (state === "connected") {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [state]);

  const addToChat = (type, data, userAction = false) => {
    const newLog = { 
      time: new Date().toLocaleTimeString(), 
      type, 
      data,
      userAction
    };
    setChatMessages((prev) => [...prev, newLog].slice(-200));
  };

  const handleConnect = () => {
    const client = new IRCClient();
    clientRef.current = client;
    
    client.on("state", (data) => { 
      setState(data.state); 
    });
    
    client.on("registered", () => {
      // Entrar automaticamente no canal de consultoria
      client.join(CONSULTANCY_CHANNEL);
      addToChat("info", `Conectado à sala de consultoria ${CONSULTANCY_CHANNEL}`, true);
    });
    
    client.on("message", (msg) => {
      // APENAS mensagens do canal de consultoria
      if (msg.to === CONSULTANCY_CHANNEL) {
        addToChat("message", `<${msg.from}> ${msg.text}`);
      }
    });
    
    client.on("join", (data) => {
      if (data.channel === CONSULTANCY_CHANNEL) {
        addToChat("join", `→ ${data.nick} entrou na consultoria`);
        if (!channelUsers.includes(data.nick)) {
          setChannelUsers(prev => [...prev, data.nick].sort());
        }
      }
    });
    
    client.on("part", (data) => {
      if (data.channel === CONSULTANCY_CHANNEL) {
        addToChat("part", `← ${data.nick} saiu da consultoria`);
        setChannelUsers(prev => prev.filter(nick => nick !== data.nick));
      }
    });
    
    client.on("names", (data) => {
      if (data.channel === CONSULTANCY_CHANNEL) {
        setChannelUsers(data.users.sort());
      }
    });
    
    client.on("error", () => {
      addToChat("error", "Erro de conexão. Tente novamente.");
    });
    
    client.connect(CONSULTANCY_SERVER, nick, "consultoria", "Cliente de Consultoria");
  };

  const handleDisconnect = () => { 
    if (clientRef.current) {
      clientRef.current.quit();
    }
    setChatMessages([]);
    setChannelUsers([]);
    setShowUsers(false);
  };

  const handleAction = (action) => {
    switch (action) {
      case "clear":
        setChatMessages([]);
        break;
      case "users":
        setShowUsers(!showUsers);
        if (clientRef.current && !showUsers) {
          clientRef.current.names(CONSULTANCY_CHANNEL);
        }
        break;
      case "help":
        addToChat("info", "Digite sua mensagem e clique em ↑ para enviar. Use os botões para limpar ou ver usuários.", true);
        break;
      case "leave":
        handleDisconnect();
        break;
    }
  };

  const handleSendMessage = () => { 
    const text = commandInput.trim();
    if (!text) return;
    
    if (!clientRef.current || state !== "connected") {
      addToChat("error", "Não conectado!");
      return;
    }
    
    clientRef.current.privmsg(CONSULTANCY_CHANNEL, text);
    addToChat("message", `<${nick}> ${text}`, true);
    
    setCommandInput("");
    inputRef.current?.focus();
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  return (
    <div className="app-root consultoria-app">
      {/* Header Fixo */}
      <div className="header">
        <div className="header-content">
          <div className="header-info">
            <h1 className="app-title">Consultoria Online</h1>
            <div className="connection-status">
              <div className={`status-dot ${state === "connected" ? "connected" : state === "connecting" ? "connecting" : "disconnected"}`} />
              <span className="status-text">
                {state === "connected" ? "Conectado" : state === "connecting" ? "Conectando..." : "Desconectado"}
              </span>
            </div>
          </div>
          <div className="header-actions">
            {state === "disconnected" ? (
              <button 
                onClick={handleConnect}
                className="connect-btn primary"
              >
                <Power /> Conectar
              </button>
            ) : (
              <button 
                onClick={handleDisconnect}
                className="connect-btn secondary"
              >
                Sair
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="main-container">
        {/* Chat Principal */}
        <div className="chat-container">
          {/* Cabeçalho do Chat */}
          <div className="chat-header">
            <div className="channel-info">
              <span className="channel-name">Sala de Consultoria</span>
              <span className="user-count">{channelUsers.length} participantes</span>
            </div>
          </div>

          {/* Lista de Usuários (Acordeão) */}
          {showUsers && (
            <div className="users-panel">
              <div className="panel-header">
                <User /> Participantes Online
                <button className="close-panel" onClick={() => setShowUsers(false)}>×</button>
              </div>
              <div className="users-grid">
                {channelUsers.length === 0 ? (
                  <div className="no-users">Carregando participantes...</div>
                ) : (
                  channelUsers.map((user, i) => (
                    <div key={i} className="user-badge">{user}</div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Área de Mensagens */}
          <div className="messages-area">
            {chatMessages.length === 0 ? (
              <div className="welcome-message">
                <div className="welcome-icon">💬</div>
                <h3>Bem-vindo à Consultoria</h3>
                <p>Conecte-se para iniciar sua sessão de consultoria com nossos especialistas.</p>
                <button 
                  onClick={handleConnect}
                  className="primary-btn large-btn"
                  style={{marginTop: '20px'}}
                >
                  <Power size={20} /> Iniciar Consultoria
                </button>
              </div>
            ) : (
              <div className="messages-list">
                {chatMessages.map((log, i) => (
                  <div key={i} className={`message ${log.type} ${log.userAction ? "user-message" : ""}`}>
                    <span className="message-time">{log.time}</span>
                    <span className="message-content">{log.data}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Área de Input */}
          {state === "connected" && (
            <div className="input-area">
              <div className="input-group">
                <input
                  ref={inputRef}
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="message-input"
                  placeholder="Digite sua mensagem para o consultor..."
                  maxLength={500}
                />
                <button
                  onClick={handleSendMessage}
                  className="send-btn"
                  disabled={!commandInput.trim()}
                >
                  <Send />
                </button>
              </div>

              {/* Botões de Ação */}
              <div className="quick-actions">
                {ACTION_BUTTONS.map(({ action, label, icon }) => (
                  <button
                    key={action}
                    className="action-btn"
                    onClick={() => handleAction(action)}
                    title={label}
                  >
                    <span className="action-icon">{icon}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
