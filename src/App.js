import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// Ícones simplificados
const Radio = ({ className = "", size = 20 }) => <span className={`radio-icon ${className}`} style={{ width: size, height: size }} />;
const Power = ({ size = 24 }) => <span style={{ fontWeight: "bold", fontSize: size }}>⏻</span>;
const Send = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>↑</span>;
const User = ({ size = 20 }) => <span style={{ fontWeight: "bold", fontSize: size }}>👤</span>;
const ChevronDown = ({ size = 16 }) => <span style={{ fontSize: size }}>▾</span>;
const ChevronUp = ({ size = 16 }) => <span style={{ fontSize: size }}>▴</span>;

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
  
  connect(url, nick, user, realname, password = null) {
    this.connectionState = "connecting";
    this.emit("state", { state: "connecting" });
    this.ws = new window.WebSocket(url);
    
    this.ws.addEventListener("open", () => {
      this.connectionState = "registering";
      this.emit("state", { state: "registering" });
      this.emit("debug", { msg: "WebSocket aberto, iniciando handshake IRC" });
      if (password) this.send(`PASS ${password}`);
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
        this.emit("raw", msg);
        
        if (msg.command === "PING") { 
          this.send(`PONG ${msg.trailing || msg.params[0]}`); 
          this.emit("ping", msg); 
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
      this.emit("error", { 
        type: err.type, 
        timestamp: Date.now(), 
        readyState: this.ws.readyState, 
        url: url 
      });
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
  part(channel, reason = "") { this.send(`PART ${channel}${reason ? " :" + reason : ""}`); }
  privmsg(target, text) { this.send(`PRIVMSG ${target} :${text}`); }
  quit(reason = "Saindo") { this.send(`QUIT :${reason}`); setTimeout(() => this.disconnect(), 500); }
  names(channel) { this.send(`NAMES ${channel}`); }
}

const QUICK_COMMANDS = [
  { cmd: "JOIN #test", label: "#test", icon: "💬" },
  { cmd: "JOIN #chat", label: "#chat", icon: "👥" },
  { cmd: "JOIN #help", label: "#help", icon: "❓" },
  { cmd: "LIST", label: "Canais", icon: "📋" }
];

const ACTION_COMMANDS = [
  { cmd: "NAMES", label: "Usuários", icon: "👤" },
  { cmd: "WHO", label: "Online", icon: "🟢" },
  { cmd: "TOPIC", label: "Tópico", icon: "📝" },
  { cmd: "LEAVE", label: "Sair", icon: "🚪" }
];

export default function IRCEngineDemo() {
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState("disconnected");
  const [config, setConfig] = useState({
    url: "wss://irc.ergo.chat:6697",
    nick: "User" + Math.floor(Math.random() * 9999),
    user: "user",
    realname: "IRC User"
  });
  const [commandInput, setCommandInput] = useState("");
  const [channelUsers, setChannelUsers] = useState([]);
  const [currentChannel, setCurrentChannel] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [showUsers, setShowUsers] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  
  const wsServers = [
    { name: "Ergo Chat", url: "wss://irc.ergo.chat:6697", note: "Recomendado" },
    { name: "UnrealIRCd", url: "wss://irc.unrealircd.org:443", note: "Demo" }
  ];
  
  const clientRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll para baixo no chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Focar no input quando conectar
  useEffect(() => {
    if (state === "connected" && currentChannel) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [state, currentChannel]);

  const addToChat = (type, data, userAction = false) => {
    const newLog = { 
      time: new Date().toLocaleTimeString(), 
      type, 
      data,
      userAction
    };
    setChatMessages((prev) => [...prev, newLog].slice(-100));
  };

  const addToConsole = (type, data) => {
    const newLog = { time: new Date().toLocaleTimeString(), type, data };
    setLogs((prev) => [...prev, newLog].slice(-50));
  };

  const handleConnect = () => {
    const client = new IRCClient();
    clientRef.current = client;
    
    client.on("state", (data) => { 
      setState(data.state); 
      addToConsole("state", `Estado: ${data.state}`); 
    });
    
    client.on("debug", (data) => addToConsole("debug", data.msg));
    
    client.on("registered", () => {
      addToConsole("success", "Conectado ao servidor");
      addToChat("info", "Conectado! Use os botões para entrar em um canal.", true);
    });
    
    client.on("ping", (data) => addToConsole("ping", "Ping recebido"));
    
    client.on("message", (msg) => {
      const displayText = msg.isChannel 
        ? `<${msg.from}> ${msg.text}`
        : `[PM de ${msg.from}] ${msg.text}`;
      
      if (msg.isChannel && msg.to === currentChannel) {
        addToChat("message", displayText);
      } else {
        addToConsole("message", `${msg.to}: ${displayText}`);
      }
    });
    
    client.on("join", (data) => {
      if (data.channel === currentChannel) {
        addToChat("join", `→ ${data.nick} entrou`);
        if (!channelUsers.includes(data.nick)) {
          setChannelUsers(prev => [...prev, data.nick].sort());
        }
      }
    });
    
    client.on("part", (data) => {
      if (data.channel === currentChannel) {
        addToChat("part", `← ${data.nick} saiu`);
        setChannelUsers(prev => prev.filter(nick => nick !== data.nick));
      }
    });
    
    client.on("names", (data) => {
      if (data.channel === currentChannel) {
        setChannelUsers(data.users.sort());
        addToChat("info", `Lista de usuários atualizada: ${data.users.length} online`);
      }
    });
    
    client.on("raw", (msg) => {
      if (msg.command !== "PING" && msg.command !== "PONG") {
        addToConsole("raw", msg.raw);
      }
    });
    
    client.on("error", (data) => addToConsole("error", `Erro: ${data.type}`));
    
    client.connect(config.url, config.nick, config.user, config.realname);
  };

  const handleDisconnect = () => { 
    if (clientRef.current) {
      clientRef.current.quit("Saindo...");
    }
    setChatMessages([]);
    setChannelUsers([]);
    setCurrentChannel("");
    setShowUsers(false);
    setShowConsole(false);
  };

  const handleQuickCommand = (cmd) => {
    if (!clientRef.current || state !== "connected") {
      addToConsole("error", "Não conectado!");
      return;
    }

    if (cmd === "LEAVE") {
      handleDisconnect();
      return;
    }

    if (cmd.startsWith("JOIN ")) {
      const channel = cmd.split(" ")[1];
      setCurrentChannel(channel);
      setChannelUsers([]);
      setChatMessages([]);
      addToChat("info", `Entrando em ${channel}...`, true);
    }

    clientRef.current.send(cmd);
    addToConsole("sent", `→ ${cmd}`);
  };

  const handleSendMessage = () => { 
    const text = commandInput.trim();
    if (!text) return;
    
    if (!clientRef.current || state !== "connected") {
      addToConsole("error", "Não conectado!");
      return;
    }
    
    if (!currentChannel) {
      addToConsole("error", "Entre em um canal primeiro!");
      return;
    }
    
    if (text.startsWith("/")) {
      handleQuickCommand(text.slice(1));
    } else {
      clientRef.current.privmsg(currentChannel, text);
      addToChat("message", `<${config.nick}> ${text}`, true);
    }
    
    setCommandInput("");
    inputRef.current?.focus();
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  return (
    <div className="app-root">
      {/* Header Fixo */}
      <div className="header">
        <div className="header-content">
          <div className="header-info">
            <h1 className="app-title">IRC Mobile</h1>
            <div className="connection-status">
              <Radio className={state === "connected" ? "st-connected" : state === "connecting" ? "st-connecting" : "st-disconnected"} size={16} />
              <span className="status-text">{state}</span>
            </div>
          </div>
          <div className="header-actions">
            <button 
              onClick={handleConnect} 
              disabled={state !== "disconnected"}
              className={`connect-btn ${state !== "disconnected" ? "connected" : ""}`}
            >
              <Power />
            </button>
          </div>
        </div>
      </div>

      <div className="main-container">
        {/* Área de Conexão */}
        {state === "disconnected" && (
          <div className="connection-card">
            <div className="form-group">
              <label className="form-label">Servidor</label>
              <select 
                value={config.url} 
                onChange={e => setConfig({ ...config, url: e.target.value })} 
                className="form-input"
              >
                {wsServers.map(srv => (
                  <option key={srv.url} value={srv.url}>{srv.name} - {srv.note}</option>
                ))}
              </select>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nickname</label>
                <input 
                  type="text" 
                  value={config.nick} 
                  onChange={e => setConfig({ ...config, nick: e.target.value })} 
                  className="form-input"
                  placeholder="Seu nick"
                />
              </div>
            </div>

            <button 
              onClick={handleConnect}
              className="primary-btn large-btn"
            >
              <Power size={20} /> Conectar ao IRC
            </button>
          </div>
        )}

        {/* Chat Principal */}
        {state === "connected" && (
          <div className="chat-container">
            {/* Cabeçalho do Chat */}
            <div className="chat-header">
              <div className="channel-info">
                <span className="channel-name">
                  {currentChannel || "Selecione um canal"}
                </span>
                {currentChannel && (
                  <span className="user-count">{channelUsers.length} online</span>
                )}
              </div>
              <div className="chat-actions">
                <button 
                  className={`icon-btn ${showUsers ? "active" : ""}`}
                  onClick={() => setShowUsers(!showUsers)}
                >
                  <User />
                </button>
                <button 
                  className={`icon-btn ${showConsole ? "active" : ""}`}
                  onClick={() => setShowConsole(!showConsole)}
                >
                  ⚙️
                </button>
              </div>
            </div>

            {/* Lista de Usuários (Acordeão) */}
            {showUsers && currentChannel && (
              <div className="users-panel">
                <div className="panel-header">
                  <User /> Usuários em {currentChannel}
                  <button className="close-panel" onClick={() => setShowUsers(false)}>×</button>
                </div>
                <div className="users-grid">
                  {channelUsers.length === 0 ? (
                    <div className="no-users">Carregando usuários...</div>
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
                  <h3>Bem-vindo ao IRC Mobile</h3>
                  <p>Use os botões abaixo para entrar em um canal e começar a conversar!</p>
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

            {/* Botões Rápidos de Canais */}
            {!currentChannel && (
              <div className="quick-channels">
                <h4 className="section-title">Canais Populares</h4>
                <div className="channels-grid">
                  {QUICK_COMMANDS.map(({ cmd, label, icon }, i) => (
                    <button
                      key={i}
                      className="channel-btn"
                      onClick={() => handleQuickCommand(cmd)}
                    >
                      <span className="channel-icon">{icon}</span>
                      <span className="channel-label">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Área de Input */}
            {currentChannel && (
              <div className="input-area">
                <div className="input-group">
                  <input
                    ref={inputRef}
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="message-input"
                    placeholder={`Mensagem para ${currentChannel} (ou /comando)`}
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

                {/* Botões de Ação Rápida */}
                <div className="quick-actions">
                  {ACTION_COMMANDS.map(({ cmd, label, icon }, i) => (
                    <button
                      key={i}
                      className="action-btn"
                      onClick={() => handleQuickCommand(cmd + (currentChannel ? ` ${currentChannel}` : ""))}
                      title={label}
                    >
                      <span className="action-icon">{icon}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Console (Acordeão) */}
            {showConsole && (
              <div className="console-panel">
                <div className="panel-header">
                  <span>Console IRC</span>
                  <button className="close-panel" onClick={() => setShowConsole(false)}>×</button>
                </div>
                <div className="console-content">
                  {logs.length === 0 ? (
                    <div className="no-logs">Nenhum evento ainda</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className={`log-entry ${log.type}`}>
                        <span className="log-time">{log.time}</span>
                        <span className="log-message">{log.data}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer de Status */}
      {state === "connected" && (
        <div className="status-footer">
          <div className="footer-content">
            <span className="server-info">{new URL(config.url).hostname}</span>
            <span className="nick-info">{config.nick}</span>
            <button 
              onClick={handleDisconnect}
              className="disconnect-btn"
            >
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
