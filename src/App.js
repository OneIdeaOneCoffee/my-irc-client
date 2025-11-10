import React, { useState, useRef } from "react";
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
      const processedLines = lines.length > 0 ? lines : evt.data.trim() ? [evt.data.trim()] : [];
      processedLines.forEach((line) => {
        const msg = IRCParser.parse(line);
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
          const users = msg.trailing ? msg.trailing.split(" ") : [];
          this.emit("names", { channel, users, raw: msg });
        }
        this.emit("raw", msg);
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
  { cmd: "JOIN #test", label: "Entrar canal #test" },
  { cmd: "PART #test", label: "Sair canal #test" },
  { cmd: "LEAVE", label: "Desconectar" },
  { cmd: "NICK NovoNick", label: "Trocar nick" },
  { cmd: "WHO #test", label: "Quem está online" },
  { cmd: "TOPIC #test Novo tópico", label: "Alterar tópico" },
  { cmd: "AWAY Estou ausente", label: "Ausente" },
  { cmd: "INVITE Nick #test", label: "Convidar" },
  { cmd: "NOTICE Nick Olá!", label: "Aviso privado" },
  { cmd: "PRIVMSG Nick Olá!", label: "Mensagem privada" }
];

export default function IRCEngineDemo() {
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState("disconnected");
  const [config, setConfig] = useState({
    url: "wss://testnet.ergo.chat",
    nick: "TestBot" + Math.floor(Math.random() * 9999),
    user: "testuser",
    realname: "IRC Test Bot"
  });
  const [commandInput, setCommandInput] = useState("");
  const [channelUsers, setChannelUsers] = useState([]);
  const [currentChannel, setCurrentChannel] = useState("#test");
  const [chatMessages, setChatMessages] = useState([]);
  
  const wsServers = [
    { name: "UnrealIRCd Demo", url: "wss://irc.unrealircd.org:443", note: "WebSocket nativo funcionando ✅" },
    { name: "Ergo Testnet", url: "wss://testnet.ergo.chat", note: "Pode estar offline" }
  ];
  const clientRef = useRef(null);

  // Função separada para adicionar ao CHAT
  const addToChat = (type, data) => {
    const newLog = { time: new Date().toLocaleTimeString(), type, data };
    setChatMessages((prev) => [...prev, newLog].slice(-300));
  };

  // Função separada para adicionar ao CONSOLE IRC
  const addToConsole = (type, data) => {
    const newLog = { time: new Date().toLocaleTimeString(), type, data };
    setLogs((prev) => [...prev, newLog].slice(-300));
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
      addToConsole("success", "Conectado! Agora você pode enviar JOIN #canal");
      addToChat("info", "Conectado ao servidor IRC. Use JOIN #canal para entrar em um canal.");
    });
    client.on("ping", () => addToConsole("ping", "PING recebido e respondido automaticamente"));
    
    client.on("message", (msg) => {
      const prefix = msg.isChannel ? `[${msg.to}]` : `[PM]`;
      const messageText = `${prefix} <${msg.from}> ${msg.text}`;
      
      // Se for mensagem do canal atual, vai para o CHAT
      if (msg.to === currentChannel) {
        addToChat("message", messageText);
      }
      // Se for mensagem privada ou de outro canal, vai para o CONSOLE
      else {
        addToConsole("message", messageText);
      }
    });
    
    client.on("join", (data) => {
      // Se for no canal atual, vai para o CHAT
      if (data.channel === currentChannel) {
        addToChat("join", `${data.nick} entrou no canal`);
        if (!channelUsers.includes(data.nick)) {
          setChannelUsers((users) => Array.from(new Set([...users, data.nick])));
        }
      }
      // Se for em outro canal, vai para o CONSOLE
      else {
        addToConsole("join", `${data.nick} entrou em ${data.channel}`);
      }
    });
    
    client.on("part", (data) => {
      // Se for do canal atual, vai para o CHAT
      if (data.channel === currentChannel) {
        addToChat("part", `${data.nick} saiu do canal`);
        setChannelUsers((users) => users.filter(nick => nick !== data.nick));
      }
      // Se for de outro canal, vai para o CONSOLE
      else {
        addToConsole("part", `${data.nick} saiu de ${data.channel}`);
      }
    });
    
    client.on("names", (data) => {
      // Se for do canal atual, vai para o CHAT e atualiza usuários
      if (data.channel === currentChannel) {
        addToChat("names", `Usuários no canal: ${data.users.join(", ")}`);
        setChannelUsers(data.users);
      }
      // Se for de outro canal, vai para o CONSOLE
      else {
        addToConsole("names", `Usuários em ${data.channel}: ${data.users.join(", ")}`);
      }
    });
    
    client.on("raw", (msg) => addToConsole("raw", msg.raw));
    client.on("error", (data) => addToConsole("error", `WebSocket Error: ${data.type} | ReadyState: ${data.readyState} | URL: ${data.url}`));
    
    client.connect(config.url, config.nick, config.user, config.realname);
  };

  const handleDisconnect = () => { 
    if (clientRef.current) clientRef.current.disconnect(); 
    setChatMessages([]);
    setChannelUsers([]);
  };

  const handleCommand = (cmd) => {
    if (!clientRef.current || state !== "connected") {
      addToConsole("error", "Não conectado!");
      return;
    }
    
    // Handle special commands
    if (cmd === "LEAVE") {
      handleDisconnect();
      return;
    }
    
    clientRef.current.send(cmd);
    addToConsole("sent", `→ ${cmd}`);
    
    if (/^JOIN\s+[#\w]+/i.test(cmd)) {
      const ch = cmd.split(" ")[1];
      setCurrentChannel(ch);
      setChannelUsers([]);
      setChatMessages([]);
      addToChat("info", `Entrou no canal: ${ch}`);
      addToConsole("info", `Canal alterado para: ${ch}`);
    }
    
    if (/^PART\s+[#\w]+/i.test(cmd)) {
      const ch = cmd.split(" ")[1];
      if (ch === currentChannel) {
        setChannelUsers([]);
        setChatMessages([]);
        setCurrentChannel("");
        addToChat("info", "Saiu do canal");
      }
    }
  };

  const handleSendCommand = () => { 
    if (commandInput.trim()) { 
      // Se começar com /, é comando IRC, senão é mensagem para o canal
      if (commandInput.startsWith("/")) {
        handleCommand(commandInput.slice(1));
      } else {
        // Mensagem normal para o canal atual
        if (currentChannel && clientRef.current) {
          clientRef.current.privmsg(currentChannel, commandInput);
          addToChat("message", `[${currentChannel}] <${config.nick}> ${commandInput}`);
        } else {
          addToConsole("error", "Não está em nenhum canal!");
        }
      }
      setCommandInput(""); 
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
                <div className="users-list">
                  <h4 className="userlist-title"><User /> Usuários em {currentChannel} ({channelUsers.length}):</h4>
                  <div className="userlist-list">
                    {channelUsers.length === 0 && <div className="userlist-empty">Nenhum usuário listado</div>}
                    {channelUsers.map((u, i) => (
                      <div key={i} className="userlist-item">{u}</div>
                    ))}
                  </div>
                </div>
                
                {/* Chat Principal */}
                <div className="chat-messages">
                  <h4 className="chat-title">Chat: <span style={{ color: "#54a0ff" }}>{currentChannel || "Nenhum canal"}</span></h4>
                  <div className="console-list chat-console">
                    {chatMessages.length === 0 ? (
                      <div className="console-msg console-msg-default">
                        {currentChannel 
                          ? "Nenhuma mensagem ainda. Digite algo para começar a conversar!" 
                          : "Use 'JOIN #canal' para entrar em um canal de chat."}
                      </div>
                    ) : (
                      chatMessages.map((log, i) => (
                        <div key={i} className={`console-msg console-msg-${log.type}`}>
                          <span className="console-time">{log.time}</span>
                          <span className="console-text">{log.data}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="row">
                    <input 
                      type="text" 
                      value={commandInput} 
                      onChange={e => setCommandInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSendCommand()}
                      className="input" 
                      placeholder={currentChannel 
                        ? `Mensagem para ${currentChannel} (ou /comando)` 
                        : "Digite /JOIN #canal para entrar em um canal"} 
                    />
                    <button className="button connect" onClick={handleSendCommand}>
                      <Send />
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Botões comandos IRC */}
              <div className="card cmd-btns-area">
                <div className="cmd-btns-row">
                  {DEFAULT_COMMANDS.map(({ cmd, label }, i) => (
                    <button key={i} className={`button alt`} onClick={() => handleCommand(cmd)} title={cmd}>
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
              <p className="info-title">Como testar:</p>
              <ol className="info-list">
                <li>Servidor padrão (Ergo Testnet) já está selecionado</li>
                <li>Clique em "Conectar"</li>
                <li>Aguarde o estado mudar para "connected" (~2-3 segundos)</li>
                <li>Clique em "JOIN #test" para entrar no canal público</li>
                <li>Digite mensagens no campo de texto</li>
                <li>Veja as mensagens do chat na janela principal e eventos técnicos no console abaixo</li>
              </ol>
              <p className="warn">⚠️ Use /comando para comandos IRC (ex: /JOIN #test) ou texto normal para mensagens</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
