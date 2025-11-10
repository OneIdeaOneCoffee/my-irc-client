import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// Ícones simplificados
const Radio = ({ className = "", size = 20 }) => <span className={`radio-icon ${className}`} style={{ width: size, height: size }} />;
const Power = ({ size = 16 }) => <span style={{ fontWeight: "bold", fontSize: size }}>⏻</span>;
const Send = ({ size = 16 }) => <span style={{ fontWeight: "bold", fontSize: size }}>✉️</span>;
const User = ({ size = 16 }) => <span style={{ fontWeight: "bold", fontSize: size }}>👤</span>;

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
    });
    
    this.ws.addEventListener("message", (evt) => {
      const lines = this.buffer.push(evt.data);
      lines.forEach((line) => {
        if (!line.trim()) return;
        
        const msg = IRCParser.parse(line);
        this.emit("raw", msg); // Sempre emite raw primeiro
        
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
          // RPL_NAMREPLY - lista de usuários
          const channel = msg.params[2];
          const users = msg.trailing ? msg.trailing.split(" ").filter(u => u) : [];
          this.emit("names", { channel, users, raw: msg });
        } else if (msg.command === "366") {
          // RPL_ENDOFNAMES - fim da lista
          this.emit("names_end", { channel: msg.params[1], raw: msg });
        }
      });
    });
    
    this.ws.addEventListener("close", (evt) => { 
      this.connectionState = "disconnected"; 
      this.buffer.clear(); 
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
  
  send(line) { 
    if (this.ws && this.ws.readyState === window.WebSocket.OPEN) { 
      this.ws.send(line + "\r\n"); 
    } 
  }
  
  disconnect() { if (this.ws) this.ws.close(); }
  join(channel) { this.send(`JOIN ${channel}`); }
  part(channel, reason = "") { this.send(`PART ${channel}${reason ? " :" + reason : ""}`); }
  privmsg(target, text) { this.send(`PRIVMSG ${target} :${text}`); }
  quit(reason = "Leaving") { this.send(`QUIT :${reason}`); setTimeout(() => this.disconnect(), 500); }
  names(channel) { this.send(`NAMES ${channel}`); }
}

const DEFAULT_COMMANDS = [
  { cmd: "JOIN #test", label: "Entrar #test" },
  { cmd: "JOIN #chat", label: "Entrar #chat" },
  { cmd: "PART #test", label: "Sair #test" },
  { cmd: "NAMES #test", label: "Listar usuários" },
  { cmd: "PRIVMSG #test Olá mundo!", label: "Dizer Olá" },
  { cmd: "LIST", label: "Listar canais" },
  { cmd: "WHO #test", label: "Quem está online" }
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
  
  const wsServers = [
    { name: "Ergo Chat", url: "wss://irc.ergo.chat:6697", note: "Servidor principal" },
    { name: "Libera Chat", url: "wss://irc.libera.chat:6697", note: "Pode requerer WEBIRC" },
    { name: "UnrealIRCd", url: "wss://irc.unrealircd.org:443", note: "Demo server" }
  ];
  
  const clientRef = useRef(null);
  const chatEndRef = useRef(null);

  // Auto-scroll para baixo no chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Função para adicionar ao CHAT (apenas mensagens do canal atual)
  const addToChat = (type, data, userAction = false) => {
    const newLog = { 
      time: new Date().toLocaleTimeString(), 
      type, 
      data,
      userAction // Se foi ação do usuário atual
    };
    setChatMessages((prev) => [...prev, newLog].slice(-100));
  };

  // Função para adicionar ao CONSOLE IRC (todos eventos técnicos)
  const addToConsole = (type, data) => {
    const newLog = { time: new Date().toLocaleTimeString(), type, data };
    setLogs((prev) => [...prev, newLog].slice(-200));
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
      addToConsole("success", "Registrado no servidor IRC!");
      addToChat("info", "Conectado ao servidor. Use JOIN #canal para entrar em um canal.", true);
    });
    
    client.on("ping", (data) => addToConsole("ping", `PING: ${data.trailing || data.params[0]}`));
    
    // MENSAGENS - LÓGICA CORRIGIDA
    client.on("message", (msg) => {
      const displayText = msg.isChannel 
        ? `<${msg.from}> ${msg.text}`
        : `[PM de ${msg.from}] ${msg.text}`;
      
      // Se for mensagem do canal atual, vai para o CHAT
      if (msg.isChannel && msg.to === currentChannel) {
        addToChat("message", displayText);
      } 
      // Se for mensagem privada OU de outro canal, vai para o CONSOLE
      else {
        addToConsole("message", `${msg.to}: ${displayText}`);
      }
    });
    
    // JOIN - LÓGICA CORRIGIDA
    client.on("join", (data) => {
      // Se for no canal atual, vai para o CHAT
      if (data.channel === currentChannel) {
        addToChat("join", `→ ${data.nick} entrou no canal`);
        if (!channelUsers.includes(data.nick)) {
          setChannelUsers(prev => [...prev, data.nick].sort());
        }
      }
      // Se for JOIN do usuário atual em qualquer canal
      if (data.nick === config.nick) {
        addToConsole("join", `Você entrou em ${data.channel}`);
      }
    });
    
    // PART - LÓGICA CORRIGIDA
    client.on("part", (data) => {
      // Se for do canal atual, vai para o CHAT
      if (data.channel === currentChannel) {
        addToChat("part", `← ${data.nick} saiu do canal`);
        setChannelUsers(prev => prev.filter(nick => nick !== data.nick));
      }
      // Se for PART do usuário atual
      if (data.nick === config.nick) {
        addToConsole("part", `Você saiu de ${data.channel}`);
      }
    });
    
    // NAMES - LÓGICA CORRIGIDA
    client.on("names", (data) => {
      if (data.channel === currentChannel) {
        addToConsole("names", `Usuários em ${data.channel}: ${data.users.join(", ")}`);
        setChannelUsers(data.users.sort());
      }
    });
    
    client.on("raw", (msg) => {
      // Não mostra PING/PONG no console para poluir menos
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
  };

  const handleCommand = (cmd) => {
    if (!clientRef.current || state !== "connected") {
      addToConsole("error", "Não conectado!");
      return;
    }
    
    const trimmedCmd = cmd.trim();
    
    // Comando JOIN - lógica especial
    if (trimmedCmd.toUpperCase().startsWith("JOIN ")) {
      const channel = trimmedCmd.split(" ")[1];
      if (channel && channel.startsWith("#")) {
        setCurrentChannel(channel);
        setChannelUsers([]);
        setChatMessages([]);
        addToChat("info", `Entrando no canal ${channel}...`, true);
        addToConsole("info", `Mudando para canal: ${channel}`);
      }
    }
    
    // Comando PART - lógica especial
    if (trimmedCmd.toUpperCase().startsWith("PART ")) {
      const channel = trimmedCmd.split(" ")[1];
      if (channel === currentChannel) {
        setCurrentChannel("");
        setChannelUsers([]);
        addToChat("info", "Saiu do canal", true);
      }
    }
    
    // Comando PRIVMSG para canal atual - mostra no chat
    if (trimmedCmd.toUpperCase().startsWith("PRIVMSG ")) {
      const parts = trimmedCmd.split(" ");
      if (parts.length >= 3 && parts[1] === currentChannel) {
        const message = parts.slice(2).join(" ").replace(/^:/, "");
        addToChat("message", `<${config.nick}> ${message}`, true);
      }
    }
    
    clientRef.current.send(trimmedCmd);
    addToConsole("sent", `→ ${trimmedCmd}`);
  };

  const handleSendMessage = () => { 
    if (!commandInput.trim()) return;
    
    if (!clientRef.current || state !== "connected") {
      addToConsole("error", "Não conectado!");
      return;
    }
    
    if (!currentChannel) {
      addToConsole("error", "Entre em um canal primeiro! Use JOIN #canal");
      return;
    }
    
    const text = commandInput.trim();
    
    // Se começar com /, é comando IRC
    if (text.startsWith("/")) {
      handleCommand(text.slice(1));
    } else {
      // Mensagem normal para o canal atual
      clientRef.current.privmsg(currentChannel, text);
      addToChat("message", `<${config.nick}> ${text}`, true);
    }
    
    setCommandInput(""); 
  };

  const handleQuickJoin = (channel) => {
    if (clientRef.current && state === "connected") {
      setCurrentChannel(channel);
      setChannelUsers([]);
      setChatMessages([]);
      addToChat("info", `Entrando no canal ${channel}...`, true);
      clientRef.current.join(channel);
      addToConsole("sent", `→ JOIN ${channel}`);
    }
  };

  return (
    <div className="app-root">
      <div className="container">
        {/* Header */}
        <div className="card header-card">
          <div>
            <h1 className="heading">IRC Engine (Stateless)</h1>
            <p className="subtitle">WebSocket + Parser + Event Emitter</p>
          </div>
          <div className="header-state">
            <Radio className={state === "connected" ? "st-green" : state === "connecting" ? "st-yellow" : state === "registering" ? "st-blue" : "st-gray"} size={22} />
            <span className="state-label">{state}</span>
          </div>
        </div>
        <div className="divider"></div>

        {/* Conexão */}
        <div className="card">
          <label className="label">Servidor WebSocket</label>
          <select value={config.url} onChange={e => setConfig({ ...config, url: e.target.value })} className="input"
            disabled={state !== "disconnected"}>
            {wsServers.map(srv => <option key={srv.url} value={srv.url}>{srv.name} - {srv.note}</option>)}
          </select>
          <div className="row">
            <div className="col">
              <label className="label">Nick</label>
              <input type="text" value={config.nick} onChange={e => setConfig({ ...config, nick: e.target.value })} className="input"
                disabled={state !== "disconnected"} />
            </div>
            <div className="col">
              <label className="label">Nome Real</label>
              <input type="text" value={config.realname} onChange={e => setConfig({ ...config, realname: e.target.value })} className="input"
                disabled={state !== "disconnected"} />
            </div>
          </div>
          <div className="row gap">
            <button onClick={handleConnect} disabled={state !== "disconnected"} className="button connect">
              <Power />Conectar
            </button>
            <button onClick={handleDisconnect} disabled={state === "disconnected"} className="button disconnect">
              Desconectar
            </button>
          </div>
        </div>

        {/* Main: Chat + Usuários + Comandos */}
        {state === "connected" && (
          <>
            <div className="chat-users-block">
              <div className="row chat-area">
                {/* Usuários */}
                {currentChannel && (
                  <div className="users-list">
                    <h4 className="userlist-title">
                      <User /> {currentChannel} ({channelUsers.length})
                    </h4>
                    <div className="userlist-list">
                      {channelUsers.length === 0 ? (
                        <div className="userlist-empty">Carregando usuários...</div>
                      ) : (
                        channelUsers.map((u, i) => (
                          <div key={i} className="userlist-item">
                            {u}
                          </div>
                        ))
                      )}
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <button 
                        className="button alt" 
                        onClick={() => handleCommand(`NAMES ${currentChannel}`)}
                        style={{ fontSize: '0.8em', padding: '4px 8px' }}
                      >
                        Atualizar lista
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Chat Principal */}
                <div className="chat-messages" style={{ flex: 1 }}>
                  <h4 className="chat-title">
                    Chat: <span style={{ color: "#54a0ff" }}>{currentChannel || "Nenhum canal selecionado"}</span>
                  </h4>
                  
                  <div className="console-list chat-console">
                    {chatMessages.length === 0 ? (
                      <div className="console-msg console-msg-default">
                        {currentChannel 
                          ? "Nenhuma mensagem ainda. Digite algo para começar!" 
                          : "Use os botões abaixo para entrar em um canal"}
                      </div>
                    ) : (
                      <>
                        {chatMessages.map((log, i) => (
                          <div key={i} className={`console-msg console-msg-${log.type} ${log.userAction ? 'user-action' : ''}`}>
                            <span className="console-time">{log.time}</span>
                            <span className="console-text">{log.data}</span>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </>
                    )}
                  </div>
                  
                  <div className="row">
                    <input 
                      type="text" 
                      value={commandInput} 
                      onChange={e => setCommandInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSendMessage()}
                      className="input" 
                      placeholder={currentChannel 
                        ? `Mensagem para ${currentChannel} (ou /comando)` 
                        : "Digite /JOIN #canal para entrar em um canal"} 
                      disabled={!currentChannel}
                    />
                    <button 
                      className="button connect" 
                      onClick={handleSendMessage}
                      disabled={!currentChannel}
                    >
                      <Send />
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Botões de ação rápida */}
              <div className="card cmd-btns-area">
                <div className="cmd-btns-row">
                  <button className="button alt" onClick={() => handleQuickJoin("#test")}>
                    Entrar #test
                  </button>
                  <button className="button alt" onClick={() => handleQuickJoin("#chat")}>
                    Entrar #chat
                  </button>
                  <button className="button alt" onClick={() => handleQuickJoin("#ergo")}>
                    Entrar #ergo
                  </button>
                  {currentChannel && (
                    <button 
                      className="button disconnect" 
                      onClick={() => handleCommand(`PART ${currentChannel}`)}
                    >
                      Sair do canal
                    </button>
                  )}
                </div>
                
                <div className="cmd-btns-row" style={{ marginTop: '10px' }}>
                  {DEFAULT_COMMANDS.map(({ cmd, label }, i) => (
                    <button key={i} className="button alt" onClick={() => handleCommand(cmd)} title={cmd}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Console IRC - TODOS os eventos técnicos */}
            <div className="irc-console-block">
              <div className="card console-card">
                <h3 className="console-heading">Console IRC (eventos técnicos)</h3>
                <div className="console-list irc-console-list">
                  {logs.length === 0 ? (
                    <div className="console-msg console-msg-default italic">
                      Aguardando eventos IRC...
                    </div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className={`console-msg console-msg-${log.type}`}>
                        <span className="console-time">{log.time}</span>
                        <span className="console-text">{log.data}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="divider"></div>
        
        {/* Instruções */}
        <div className="card info-card">
          <div className="row">
            <span style={{ fontWeight: "bold", fontSize: "1.4em", color: "#4091e1" }}>🛈</span>
            <div>
              <p className="info-title">Como usar:</p>
              <ol className="info-list">
                <li>Conecte-se a um servidor</li>
                <li>Clique em "Entrar #test" para entrar em um canal</li>
                <li>Digite mensagens no campo de texto</li>
                <li>Veja as conversas na janela principal do chat</li>
                <li>Eventos técnicos aparecem no console abaixo</li>
              </ol>
              <p className="warn">💡 Use /comando para comandos IRC ou texto normal para mensagens</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
